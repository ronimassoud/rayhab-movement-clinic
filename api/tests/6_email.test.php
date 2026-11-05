<?php
// Phase 1: cash only, and patients hear from the clinic by email
// (PATIENT_CHANNEL=email, WHISH_DRIVER=disabled).
declare(strict_types=1);

use Rayhab\Messaging;
use Rayhab\PatientMail;
use Rayhab\Worker;

$app = fresh(['PATIENT_CHANNEL' => 'email', 'WHISH_DRIVER' => 'disabled', 'CLINIC_EMAIL' => 'rayan@clinic.test']);
$staff = signIn($app);

// A sender that keeps what it would have sent, to read the real text.
$sent = new class(config()) extends Messaging {
    public array $mail = [];
    public function whatsapp(string $to, string $template, array $params, ?string $linkToken): array { throw new LogicException('no WhatsApp in email mode'); }
    public function email(string $to, string $subject, string $text, ?string $replyTo = null): array {
        $this->mail[] = compact('to', 'subject', 'text', 'replyTo');
        return ['id' => 'm.' . count($this->mail), 'skipped' => false];
    }
};
$deliver = fn() => (new Worker($app, $sent))->deliver(100);
$emailBooking = fn(array $over = []) => booking($over + ['consents' => ['storage' => true, 'email' => true, 'version' => '2026-11-05'],
                                                          'email' => 'patient@example.com', 'note' => 'Thoracic curve']);
$outbox = fn(string $id, string $template) => $app->db->one('select channel, recipient, payload, status from rayhab.notification_outbox
                                                              where appointment_id = ? and template = ? order by id desc limit 1', [$id, $template]);

test('the booking form is told to ask for email', function () use ($app) {
    eq('email', call($app, 'GET', '/api/services')->data()['contact']);
});

test('in email mode a request needs an email address and the email consent', function () use ($app, $emailBooking) {
    $noEmail = call($app, 'POST', '/api/appointments', $emailBooking(['email' => null, 'time' => '09:00', 'phone' => '+96173000001']));
    eq(422, $noEmail->status);
    ok(isset($noEmail->data()['errors']['email']), 'email is required');
    $waOnly = call($app, 'POST', '/api/appointments', booking(['email' => 'patient@example.com', 'time' => '09:00', 'phone' => '+96173000002']));
    eq(422, $waOnly->status, 'the WhatsApp tick alone is not enough');
});

test('phase 1 end to end: request, approve, confirm by email link, record cash, receipt', function () use ($app, $staff, $emailBooking, $outbox, $deliver, $sent) {
    $r = call($app, 'POST', '/api/appointments', $emailBooking(['time' => '10:00', 'phone' => '+96173000003']));
    eq(201, $r->status, $r->body);
    $id = $r->data()['id'];
    $row = $app->db->one('select consent_email_at, consent_whatsapp_at from rayhab.appointments where id = ?', [$id]);
    ok($row['consent_email_at'] !== null && $row['consent_whatsapp_at'] === null, 'email consent stored, no WhatsApp consent');

    // Request received: to the patient, neutral, replies to the clinic; nothing on WhatsApp.
    $got = $outbox($id, 'request_received');
    eq(['email', 'patient@example.com'], [$got['channel'], $got['recipient']]);
    $p = json_decode($got['payload'], true);
    eq('rayan@clinic.test', $p['reply_to']);
    foreach (['Scoliosis', 'Thoracic', 'Maya'] as $w) ok(!str_contains($p['text'] . $p['subject'], $w), "the email leaves out \"$w\"");
    eq(0, (int) $app->db->one("select count(*)::int as n from rayhab.notification_outbox where channel = 'whatsapp' and appointment_id = ?", [$id])['n']);

    // Approved: the private link reaches the patient only at sending time.
    $link = approve($app, $staff, $id);
    $before = json_decode($outbox($id, 'approved')['payload'], true);
    ok(str_contains($before['text'], PatientMail::LINK) && !str_contains($before['text'], $link), 'stored with a placeholder, not the link');
    ok(str_contains($before['text'], 'pay at the clinic'), 'cash-only wording while Whish is off');
    $deliver();
    $mail = array_values(array_filter($sent->mail, static fn($m) => str_contains($m['subject'], 'approved')))[0];
    ok(str_contains($mail['text'], ORIGIN . '/payment/#t=' . $link), 'the sent email carries the working link');
    eq('rayan@clinic.test', $mail['replyTo']);
    $after = $outbox($id, 'approved');
    eq('sent', $after['status']);
    ok(!str_contains($after['payload'], $link) && !str_contains($after['payload'], 'link_sealed'), 'the outbox keeps no link once sent');

    // The patient confirms with "pay at the clinic"; Rayan is told.
    $v = call($app, 'GET', '/api/payment-selection', null, ['x-payment-token' => $link])->data();
    eq(['cash'], $v['allowed_methods'], 'cash is the only method');
    eq('confirmed', call($app, 'POST', '/api/payment-selection', ['method' => 'cash'], ['x-payment-token' => $link])->data()['appointment']['status']);
    $told = $app->db->one("select recipient, payload from rayhab.notification_outbox where template = 'patient_confirmed' and appointment_id = ?", [$id]);
    eq('clinic@rayhab.test', $told['recipient']);
    ok(str_contains($told['payload'], 'pay at the clinic') && !str_contains($told['payload'], 'Maya'), 'Rayan hears it, without patient details');

    // Rayan records the cash; the patient gets a receipt by email.
    $a = staffCall($app, $staff, 'GET', "/api/admin/appointments/$id")->data()['appointment'];
    eq(['confirm_cash'], $a['payment']['actions']);
    $paid = staffCall($app, $staff, 'POST', '/api/admin/payments/' . $a['payment']['id'] . '/confirm-cash',
                      ['amount' => $a['payment']['amount'], 'currency' => $a['payment']['currency']], ['idempotency-key' => 'p1-cash']);
    eq(200, $paid->status, $paid->body);
    eq('paid', $paid->data()['payment']['status']);
    eq('email', $outbox($id, 'payment_received')['channel']);

    // The reminder goes by email too.
    $app->db->query("update rayhab.appointments set starts_at = now() + interval '24 hours', ends_at = now() + interval '25 hours', reminded_at = null where id = ?", [$id]);
    (new Worker($app, $sent))->remind();
    eq('patient@example.com', $outbox($id, 'reminder')['recipient']);
});

test('every patient email reads well, and none names the service', function () use ($app) {
    $cases = ['request_received' => ['Thursday 22 October', '10:00'], 'approved' => ['Thursday 22 October', '10:00'],
              'declined' => ['No suitable time available'], 'new_time' => ['Friday 23 October', '15:00'],
              'cancelled' => ['Thursday 22 October', '10:00'], 'payment_received' => ['$80.00', 'Thursday 22 October'],
              'reminder' => ['Thursday 22 October', '10:00', 'Rayhab Movement Clinic, Beirut']];
    foreach ($cases as $template => $params) {
        $m = PatientMail::compose($app->cfg, $template, $params);
        ok(str_starts_with($m['subject'], 'Rayhab: ') && str_contains($m['text'], 'Reply to this email'), "$template has a subject and the reply line");
        ok(!str_contains($m['text'], 'Scoliosis') && !str_contains($m['text'], '{$p'), "$template is neutral and complete");
        ok(str_contains($m['text'], PatientMail::LINK) === in_array($template, ['approved', 'new_time'], true), "$template has the link only when it needs one");
    }
});
