<?php
// Payment choice and settlement: cash recorded once, Whish paid only when verified.
declare(strict_types=1);

use Rayhab\Messaging;
use Rayhab\SendError;
use Rayhab\Util;
use Rayhab\Worker;

$app = fresh();
$staff = signIn($app);
$n = 0;
$approved = function () use ($app, $staff, &$n): array {
    $times = ['09:00', '10:00', '11:00', '15:00', '16:00', '17:00'];
    $id = book($app, ['date' => fullDay(2 + intdiv($n, 6) * 2), 'time' => $times[$n % 6], 'phone' => '+9617100' . (1000 + $n++)]);
    return [$id, approve($app, $staff, $id)];
};
// A messenger that never leaves the test.
$quiet = new class(config()) extends Messaging {
    public ?SendError $fail = null;
    public function whatsapp(string $to, string $template, array $params, ?string $linkToken): array { if ($this->fail) throw $this->fail; return ['id' => 'wamid.x', 'skipped' => false]; }
    public function email(string $to, string $subject, string $text, ?string $replyTo = null): array { return ['id' => 'm.x', 'skipped' => false]; }
};

test('the payment page shows the approved appointment and both methods', function () use ($app, $approved) {
    [, $link] = $approved();
    $v = call($app, 'GET', "/api/payment-selection/$link")->data();
    eq('approved', $v['appointment']['status']);
    eq('Scoliosis assessment', $v['appointment']['service']['name']);
    eq(['method' => null, 'status' => 'not_selected', 'amount' => 8000, 'currency' => 'USD', 'outstanding' => 8000],
       array_intersect_key($v['payment'], array_flip(['method', 'status', 'amount', 'currency', 'outstanding'])));
    eq(['whish', 'cash'], $v['allowed_methods']);
});

test('unknown and expired links', function () use ($app, $approved) {
    eq('link_invalid', call($app, 'GET', '/api/payment-selection/' . str_repeat('x', 43))->data()['error']['code']);
    [$id, $link] = $approved();
    $app->db->query("update rayhab.payment_links set expires_at = now() - interval '1 minute' where appointment_id = ?", [$id]);
    $r = call($app, 'GET', "/api/payment-selection/$link");
    eq(410, $r->status);
    eq('link_expired', $r->data()['error']['code']);
});

test('choosing cash confirms the appointment but leaves it unpaid', function () use ($app, $approved) {
    [, $link] = $approved();
    $v = call($app, 'POST', "/api/payment-selection/$link", ['method' => 'cash'])->data();
    eq('confirmed', $v['appointment']['status']);
    eq('cash', $v['payment']['method']);
    eq('awaiting_payment', $v['payment']['status']);
    eq(true, $v['can_change_method']);
});

test('confirm cash received: once, however often it is pressed', function () use ($app, $staff, $approved) {
    [$id, $link] = $approved();
    call($app, 'POST', "/api/payment-selection/$link", ['method' => 'cash']);
    $a = staffCall($app, $staff, 'GET', "/api/admin/appointments/$id")->data()['appointment'];
    eq(['confirm_cash'], $a['payment']['actions']);
    $url = '/api/admin/payments/' . $a['payment']['id'] . '/confirm-cash';
    $much = staffCall($app, $staff, 'POST', $url, ['amount' => 9000, 'currency' => 'USD']);
    eq(422, $much->status);
    ok(isset($much->data()['errors']['amount']), 'amount error');
    $one = staffCall($app, $staff, 'POST', $url, ['amount' => 8000, 'currency' => 'USD'], ['idempotency-key' => 'cash-1']);
    $two = staffCall($app, $staff, 'POST', $url, ['amount' => 8000, 'currency' => 'USD'], ['idempotency-key' => 'cash-1']);
    eq(200, $one->status);
    eq($one->data(), $two->data(), 'same key, same answer');
    $paid = $one->data()['payment'];
    eq('paid', $paid['status']);
    eq('cash_receipt', $paid['verified_by']);
    eq([], $paid['actions']);
    eq(['name' => 'Dr. Rayan Halimeh'], $paid['recorded_by']);
    eq('already_recorded', staffCall($app, $staff, 'POST', $url, ['amount' => 8000, 'currency' => 'USD'], ['idempotency-key' => 'other'])->data()['error']['code']);
    eq(1, $app->db->one("select count(*)::int as n from rayhab.payment_transactions where intent_id = ? and provider = 'cash'", [$a['payment']['id']])['n']);
    $after = staffCall($app, $staff, 'GET', "/api/admin/appointments/$id")->data()['appointment'];
    ok($after['financial_closed_at'] !== null, 'financial case closed');
    eq('confirmed', $after['status'], 'paid is not completed');
    $v = call($app, 'GET', "/api/payment-selection/$link")->data();
    eq('paid', $v['payment']['status']);
    eq([], $v['allowed_methods']);
});

$startWhish = function () use ($app, $approved): array {
    [$id, $link] = $approved();
    call($app, 'POST', "/api/payment-selection/$link", ['method' => 'whish']);
    $co = call($app, 'POST', '/api/payments/whish/create', ['token' => $link]);
    eq(200, $co->status, $co->body);
    $ref = basename(parse_url($co->data()['checkout_url'], PHP_URL_PATH));
    return [$id, $link, $ref, $co->data()['checkout_url']];
};

test('coming back from Whish is not proof: unpaid until verified', function () use ($app, $startWhish) {
    [, $link, $ref, $url] = $startWhish();
    $back = call($app, 'GET', "/api/payment-selection/$link")->data();
    eq('awaiting_payment', $back['payment']['status']);
    eq('pending', $back['payment']['last_attempt']['status']);
    eq(false, $back['can_change_method']);
    eq($url, call($app, 'POST', '/api/payments/whish/create', ['token' => $link])->data()['checkout_url'], 'the open checkout is reused');
    call($app, 'POST', "/api/payments/whish/sandbox/$ref", 'outcome=verified', ['content-type' => 'application/x-www-form-urlencoded']);
    $app->db->query("update rayhab.payment_transactions set updated_at = now() - interval '1 minute' where external_ref = ?", [$ref]);
    $paid = call($app, 'GET', "/api/payment-selection/$link")->data();
    eq('paid', $paid['payment']['status'], 'verified when the page asks again');
    eq($ref, $paid['payment']['receipt_reference']);
});

test('the worker settles a Whish payment once', function () use ($app, $startWhish, $quiet) {
    [, $link, $ref] = $startWhish();
    call($app, 'POST', "/api/payments/whish/sandbox/$ref", 'outcome=verified', ['content-type' => 'application/x-www-form-urlencoded']);
    $app->db->query("update rayhab.payment_transactions set updated_at = now() - interval '2 minutes' where external_ref = ?", [$ref]);
    $w = new Worker($app, $quiet);
    eq(1, $w->reconcile());
    eq(0, $w->reconcile());
    eq('paid', call($app, 'GET', "/api/payment-selection/$link")->data()['payment']['status']);
});

test('a failed payment stays unpaid and may be retried', function () use ($app, $startWhish) {
    [, $link, $ref] = $startWhish();
    call($app, 'POST', "/api/payments/whish/sandbox/$ref", 'outcome=failed', ['content-type' => 'application/x-www-form-urlencoded']);
    $app->db->query("update rayhab.payment_transactions set updated_at = now() - interval '1 minute' where external_ref = ?", [$ref]);
    $v = call($app, 'GET', "/api/payment-selection/$link")->data();
    eq('awaiting_payment', $v['payment']['status']);
    eq('failed', $v['payment']['last_attempt']['status']);
    eq(true, $v['can_retry']);
    eq(true, $v['can_change_method']);
});

test('a callback must be authentic, and counts once', function () use ($app, $startWhish) {
    [$id, $link, $ref] = $startWhish();
    $raw = (string) json_encode(['ref' => $ref, 'status' => 'verified', 'event_id' => 'ev1']);
    eq(401, call($app, 'POST', '/api/webhooks/whish', $raw, ['x-sandbox-signature' => 'nope'])->status);
    $sig = Util::hmac($app->cfg->get('APP_SECRET'), $raw);
    for ($i = 0; $i < 2; $i++) eq(200, call($app, 'POST', '/api/webhooks/whish', $raw, ['x-sandbox-signature' => $sig])->status);
    eq('paid', call($app, 'GET', "/api/payment-selection/$link")->data()['payment']['status']);
    eq(1, $app->db->one("select count(*)::int as n from rayhab.events where appointment_id = ? and type = 'payment_verified'", [$id])['n']);
});

test('with Whish disabled, only cash is offered', function () use ($app, $approved) {
    [, $link] = $approved();
    eq(['cash'], call(sibling($app, ['WHISH_DRIVER' => 'disabled']), 'GET', "/api/payment-selection/$link")->data()['allowed_methods']);
});

test('the worker delivers the outbox and removes the sealed link once sent', function () use ($app, $approved, $quiet) {
    $approved();
    ok((new Worker($app, $quiet))->deliver(200) > 0, 'something sent');
    eq(0, $app->db->one("select count(*)::int as n from rayhab.notification_outbox where status not in ('sent', 'skipped')")['n']);
    foreach ($app->db->query("select payload from rayhab.notification_outbox where template = 'approved'") as $r) {
        ok(!isset(json_decode((string) $r['payload'], true)['link_sealed']), 'no sealed link left');
    }
});

test('gives up on a permanent error, retries a temporary one', function () use ($app, $approved, $quiet) {
    $approved();
    $quiet->fail = new SendError('WhatsApp 400: template not approved', false);
    (new Worker($app, $quiet))->deliver(200);
    eq('dead', $app->db->one("select status from rayhab.notification_outbox where channel = 'whatsapp' order by id desc limit 1")['status']);
    $approved();
    $quiet->fail = new SendError('WhatsApp 503', true);
    (new Worker($app, $quiet))->deliver(200);
    eq('failed', $app->db->one("select status from rayhab.notification_outbox where channel = 'whatsapp' order by id desc limit 1")['status']);
    $quiet->fail = null;
});
