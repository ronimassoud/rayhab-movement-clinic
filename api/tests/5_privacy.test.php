<?php
// Personal data: the retention schedule, access and erasure requests, and
// what each staff role may see.
declare(strict_types=1);

use Rayhab\Retention;
use Rayhab\Subject;

$app = fresh();
$staff = signIn($app);
$n = 0;
$req = function (array $over = []) use ($app, &$n): string {
    $n++;
    return book($app, $over + ['date' => fullDay(3 + intdiv($n, 6)), 'time' => ['09:00', '10:00', '11:00', '15:00', '16:00', '17:00'][$n % 6],
                               'phone' => '+9617200' . str_pad((string) $n, 4, '0', STR_PAD_LEFT)]);
};
$age = fn(string $id, string $status, int $days) => $app->db->query(
    "update rayhab.appointments set status = ?, updated_at = now() - make_interval(days => ?) where id = ?", [$status, $days, $id]);
$exists = fn(string $table, string $where, array $args) => (int) $app->db->one("select count(*)::int as n from rayhab.$table where $where", $args)['n'] > 0;

test('the retention schedule deletes old unconfirmed requests completely, and keeps the rest', function () use ($app, $req, $age, $exists) {
    $old = $req(['first_name' => 'Retain', 'last_name' => 'Oldrequest', 'phone' => '+96172009901']);
    $recent = $req(['phone' => '+96172009902']);
    $happened = $req(['phone' => '+96172009903']);
    $age($old, 'declined', 200);
    $age($recent, 'declined', 30);
    $app->db->query("insert into rayhab.events (type, appointment_id, actor_kind, actor_name, new_status) values ('confirmed', ?, 'patient', 'Patient', 'confirmed')", [$happened]);
    $age($happened, 'cancelled', 400);
    $pid = $app->db->one('select patient_id from rayhab.appointments where id = ?', [$old])['patient_id'];

    $done = (new Retention($app->db, $app->cfg))->run();
    ok($done['requests'] >= 1, 'deleted at least the old request');
    ok(!$exists('appointments', 'id = ?', [$old]), 'the old request is gone');
    ok(!$exists('patients', 'id = ?::uuid', [$pid]), 'its patient record is gone');
    ok(!$exists('notification_outbox', 'appointment_id = ?', [$old]), 'its messages are gone');
    ok(!$exists('events', "actor_name like '%Oldrequest%'", []), 'the name is gone from the audit log');
    ok($exists('appointments', 'id = ?', [$recent]), 'a recent declined request stays');
    ok($exists('appointments', 'id = ?', [$happened]), 'an appointment that was confirmed stays, however old');
    ok($exists('events', "type = 'retention'", []), 'the run is recorded, with counts');
});

test('the retention schedule deletes old answered questions and old message records', function () use ($app, $exists) {
    $q = fn(string $email) => eq(201, call($app, 'POST', '/api/enquiries', ['first_name' => 'Quinn', 'last_name' => 'Asker', 'email' => $email, 'message' => 'A question about my back.'])->status);
    $q('old-answered@example.com');
    $q('old-open@example.com');
    $app->db->query("update rayhab.enquiries set created_at = now() - interval '500 days', handled_at = now() - interval '400 days' where email = 'old-answered@example.com'");
    $app->db->query("update rayhab.enquiries set created_at = now() - interval '500 days' where email = 'old-open@example.com'");
    $app->db->query("update rayhab.notification_outbox set status = 'sent', created_at = now() - interval '100 days' where id = (select min(id) from rayhab.notification_outbox)");
    $oldest = (int) $app->db->one('select min(id) as id from rayhab.notification_outbox')['id'];

    (new Retention($app->db, $app->cfg))->run();
    ok(!$exists('enquiries', 'email = ?', ['old-answered@example.com']), 'an answered question past a year is gone');
    ok($exists('enquiries', 'email = ?', ['old-open@example.com']), 'an unanswered question stays');
    ok(!$exists('notification_outbox', 'id = ?', [$oldest]), 'a sent message record past 90 days is gone');
});

test('0 keeps a kind of data forever', function () use ($app, $req, $age, $exists) {
    $id = $req(['phone' => '+96172009904']);
    $age($id, 'expired', 1000);
    $keep = sibling($app, ['RETAIN_UNCONFIRMED_DAYS' => '0']);
    eq(0, (new Retention($keep->db, $keep->cfg))->run()['requests']);
    ok($exists('appointments', 'id = ?', [$id]), 'kept');
});

test('a data request finds, exports and erases one person across bookings and questions', function () use ($app, $req, $age, $exists) {
    $phone = '+96172005555';
    $declined = $req(['phone' => $phone, 'email' => 'erase.me@example.com', 'first_name' => 'Erase', 'last_name' => 'Requester', 'note' => 'Thoracic curve, 24 degrees']);
    $upcoming = $req(['phone' => $phone, 'email' => 'erase.me@example.com', 'first_name' => 'Erase', 'last_name' => 'Requester']);
    $paid = $req(['phone' => $phone, 'first_name' => 'Erase', 'last_name' => 'Requester', 'note' => 'Lower back']);
    call($app, 'POST', '/api/enquiries', ['first_name' => 'Erase', 'last_name' => 'Requester', 'email' => 'ERASE.ME@example.com', 'phone' => '+961 72 005 555', 'message' => 'Do you treat adults?']);
    $age($declined, 'declined', 2);
    $app->db->query("insert into rayhab.events (type, appointment_id, actor_kind, actor_name, new_status) values ('completed', ?, 'staff', 'Dr. Rayan Halimeh', 'completed')", [$paid]);
    $age($paid, 'completed', 2);

    $s = new Subject($app->db, '+961 72 005 555', '');
    $x = $s->export();
    eq(3, count($x['patients']), 'every booking made its own patient record');
    eq(1, count($x['questions']), 'the question is matched by phone, whatever its format');
    ok(str_contains(json_encode($x), 'Thoracic curve'), 'the export includes notes');
    eq(1, $s->plan()['upcoming']);
    try { $s->erase(); throw new LogicException('erased with an upcoming appointment'); }
    catch (RuntimeException $e) { ok(str_contains($e->getMessage(), 'cancel'), 'refuses while an appointment is upcoming'); }

    $age($upcoming, 'cancelled', 0);
    $plan = $s->erase();
    eq(2, $plan['requests_deleted'], 'the declined and the cancelled requests are deleted');
    eq(1, $plan['appointments_kept_anonymized'], 'the completed appointment is kept');
    ok(!$exists('appointments', 'id = any(?::text[])', [[$declined, $upcoming]]), 'requests gone');
    $kept = $app->db->one('select a.note, p.first_name, p.last_name, p.phone_e164, p.email from rayhab.appointments a join rayhab.patients p on p.id = a.patient_id where a.id = ?', [$paid]);
    eq(['note' => '', 'first_name' => 'Erased', 'last_name' => '', 'phone_e164' => '', 'email' => null], $kept);
    ok(!$exists('enquiries', "lower(email) = 'erase.me@example.com'", []), 'the question is gone');
    ok(!$exists('notification_outbox', 'recipient = ?', [$phone]), 'no message record to the number remains');
    ok(!$exists('events', "actor_name like '%Requester%'", []), 'the name is gone from the audit log');
    eq([], (new Subject($app->db, $phone))->export()['patients'], 'nothing is found any more');
    ok($exists('events', "type = 'subject_erased' and summary not like '%Requester%'", []), 'the erasure is recorded, without the name');
});

test('a data request needs a phone number or an email address', function () use ($app) {
    try { new Subject($app->db, '12', 'not-an-email'); throw new LogicException('accepted'); }
    catch (InvalidArgumentException $e) { ok(true, 'refused'); }
});

test('reception does not see patient notes; opening a record is logged once an hour', function () use ($app, $staff, $req) {
    $id = $req(['phone' => '+96172007777', 'note' => 'Knee pain after surgery']);
    $doc = staffCall($app, $staff, 'GET', "/api/admin/appointments/$id")->data();
    eq('Knee pain after surgery', $doc['appointment']['note'], 'a practitioner sees the note');
    staffCall($app, $staff, 'GET', "/api/admin/appointments/$id");
    eq(1, (int) $app->db->one("select count(*)::int as n from rayhab.events where type = 'viewed' and appointment_id = ?", [$id])['n'], 'two opens, one entry');
    ok(!in_array('viewed', array_column($doc['events'], 'type'), true), 'views stay out of the record history');
    ok(!in_array('viewed', array_column(staffCall($app, $staff, 'GET', '/api/admin/audit')->data()['items'], 'type'), true), 'and out of the activity list');
    ok(count(staffCall($app, $staff, 'GET', '/api/admin/audit?type=viewed')->data()['items']) >= 1, 'unless asked for');

    $app->db->query("update rayhab.practitioners set role = 'reception' where id = 'pr-rayan'");
    try {
        eq(null, staffCall($app, $staff, 'GET', "/api/admin/appointments/$id")->data()['appointment']['note'], 'reception gets no note');
        eq(0, staffCall($app, $staff, 'GET', '/api/admin/appointments?has_note=1')->data()['total'], 'nor the booking notes list');
        eq(false, staffCall($app, $staff, 'GET', '/api/admin/session')->data()['permissions']['read_notes']);
    } finally {
        $app->db->query("update rayhab.practitioners set role = 'admin' where id = 'pr-rayan'");
    }
});
