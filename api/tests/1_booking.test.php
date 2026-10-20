<?php
// Patient booking: README.md, "API contracts: patient booking", and the acceptance checks.
declare(strict_types=1);

use Rayhab\Time;

$app = fresh();

test('lists services with prices, modes and the practitioner', function () use ($app) {
    $r = call($app, 'GET', '/api/services');
    eq(200, $r->status);
    $b = $r->data();
    eq(['assessment', 'follow', 'online', 'sports', 'pain', 'pain-follow'], array_column($b['services'], 'id'));
    eq(60, $b['services'][0]['duration_min']);
    eq(['amount' => 8000, 'currency' => 'USD'], $b['services'][0]['price']);
    eq(['pr-rayan'], $b['services'][0]['practitioner_ids']);
    eq(['online'], $b['services'][2]['modes']);
    eq([['id' => 'pr-rayan', 'name' => 'Dr. Rayan Halimeh', 'title' => 'Physiotherapist, DPT']], $b['practitioners']);
    eq('no-store', $r->headers['Cache-Control']);
});

test('offers the clinic grid on an open day, nothing when closed or out of range', function () use ($app) {
    $day = fullDay(2);
    eq(['09:00', '10:00', '11:00', '15:00', '16:00', '17:00'], array_column(call($app, 'GET', "/api/availability?service_id=assessment&mode=clinic&date=$day")->data()['slots'], 'time'));
    $sun = Time::addDays(Time::today(), 1);
    while (Time::dow($sun) !== 0) $sun = Time::addDays($sun, 1);
    eq([], call($app, 'GET', "/api/availability?service_id=assessment&mode=clinic&date=$sun")->data()['slots']);
    eq([], call($app, 'GET', "/api/availability?service_id=online&mode=clinic&date=$day")->data()['slots']);
    eq([], call($app, 'GET', '/api/availability?service_id=assessment&mode=clinic&date=2020-01-06')->data()['slots']);
    eq(422, call($app, 'GET', "/api/availability?service_id=nope&mode=clinic&date=$day")->status);
});

test('stores a request and answers "requested" with a reference', function () use ($app) {
    $r = call($app, 'POST', '/api/appointments', booking(['time' => '10:00']));
    eq(201, $r->status, $r->body);
    eq('requested', $r->data()['status']);
    ok(preg_match('/^RQ-\d+$/', $r->data()['reference']), 'a reference');
    $row = $app->db->one('select status, consent_version, consent_whatsapp_at from rayhab.appointments where id = ?', [$r->data()['id']]);
    eq('requested', $row['status']);
    eq('2026-10-20', $row['consent_version']);
    ok($row['consent_whatsapp_at'] !== null, 'WhatsApp consent stored');
    $out = $app->db->query('select channel, template, payload from rayhab.notification_outbox where appointment_id = ? order by id', [$r->data()['id']]);
    eq(['whatsapp:request_received', 'email:new_request'], array_map(static fn($o) => $o['channel'] . ':' . $o['template'], $out));
    foreach ($out as $o) ok(!str_contains((string) $o['payload'], 'Scoliosis'), $o['template'] . ' does not name the service (it would reveal a condition)');
    $slots = call($app, 'GET', '/api/availability?service_id=assessment&mode=clinic&date=' . fullDay())->data()['slots'];
    eq(false, array_values(array_filter($slots, static fn($s) => $s['time'] === '10:00'))[0]['available'], 'the time is now taken');
});

test('puts field messages under the right fields (422)', function () use ($app) {
    $r = call($app, 'POST', '/api/appointments', booking(['email' => 'not-an-email', 'phone' => '71383315', 'first_name' => 'M']));
    eq(422, $r->status);
    eq('validation', $r->data()['error']['code']);
    $keys = array_keys($r->data()['errors']);
    sort($keys);
    eq(['email', 'first_name', 'phone'], $keys);
    $c = call($app, 'POST', '/api/appointments', booking(['consents' => ['storage' => true, 'whatsapp' => false, 'version' => 'x']]));
    eq(422, $c->status);
    ok(isset($c->data()['errors']['consents']), 'consents error');
});

test('rejects the honeypot and other origins, and stores nothing', function () use ($app) {
    $before = $app->db->one('select count(*)::int as n from rayhab.appointments')['n'];
    eq(400, call($app, 'POST', '/api/appointments', booking(['website' => 'spam.example', 'time' => '11:00']))->status);
    eq(403, call($app, 'POST', '/api/appointments', booking(['time' => '11:00']), ['origin' => 'https://evil.example'])->status);
    eq($before, $app->db->one('select count(*)::int as n from rayhab.appointments')['n']);
});

test('a second request for the same time gets 409', function () use ($app) {
    $day = fullDay(3);
    eq(201, call($app, 'POST', '/api/appointments', booking(['date' => $day, 'time' => '15:00', 'phone' => '+96170000201']))->status);
    $b = call($app, 'POST', '/api/appointments', booking(['date' => $day, 'time' => '15:00', 'phone' => '+96170000202']));
    eq(409, $b->status);
    eq('slot_taken', $b->data()['error']['code']);
});

test('the database itself refuses an overlap, whatever the application checked', function () use ($app) {
    $row = $app->db->one("select practitioner_id, starts_at, ends_at, patient_id, service_id from rayhab.appointments where status = 'requested' limit 1");
    try {
        $app->db->query("insert into rayhab.appointments (id, reference, patient_id, practitioner_id, service_id, mode, for_whom, starts_at, ends_at,
            local_date, local_time, status, consent_storage_at, consent_version)
            values ('apt_x', 'RQ-X', ?::uuid, ?, ?, 'clinic', 'me', ?::timestamptz, ?::timestamptz, '2026-01-01', '09:00', 'approved', now(), 'x')",
            [$row['patient_id'], $row['practitioner_id'], $row['service_id'], $row['starts_at'], $row['ends_at']]);
        throw new RuntimeException('the overlap was stored');
    } catch (PDOException $e) {
        eq('23P01', Rayhab\Db::code($e));
    }
});

test('a repeated Idempotency-Key returns the first answer and books once', function () use ($app) {
    $body = booking(['date' => fullDay(4), 'time' => '16:00', 'phone' => '+96170000301']);
    $one = call($app, 'POST', '/api/appointments', $body, ['idempotency-key' => 'same-key-1']);
    $two = call($app, 'POST', '/api/appointments', $body, ['idempotency-key' => 'same-key-1']);
    eq(201, $one->status);
    eq(201, $two->status);
    eq($one->data(), $two->data());
    eq(1, $app->db->one("select count(*)::int as n from rayhab.appointments a join rayhab.patients p on p.id = a.patient_id where p.phone_e164 = '+96170000301'")['n']);
    $other = call($app, 'POST', '/api/appointments', ['time' => '17:00'] + $body, ['idempotency-key' => 'same-key-1']);
    eq(422, $other->status);
    eq('idempotency_mismatch', $other->data()['error']['code']);
});

test('limits requests per number per day (429)', function () use ($app) {
    $day = fullDay(10);
    $codes = [];
    foreach (['09:00', '10:00', '11:00', '15:00', '16:00', '17:00'] as $t) {
        $codes[] = call($app, 'POST', '/api/appointments', booking(['date' => $day, 'time' => $t, 'phone' => '+96170000401']))->status;
    }
    eq(5, count(array_filter($codes, static fn($c) => $c === 201)));
    eq(429, end($codes));
});

test('limits requests per address (429)', function () use ($app) {
    $codes = [];
    $day = fullDay(12);
    foreach (['09:00', '10:00', '11:00', '15:00', '16:00', '17:00'] as $i => $t) {
        $r = $app->handle(new Rayhab\Request('POST', '/api/appointments', [], ['origin' => ORIGIN, 'content-type' => 'application/json'], [],
            (string) json_encode(booking(['date' => $day, 'time' => $t, 'phone' => '+9617000050' . $i])), '192.0.2.77'));
        $codes[] = $r->status;
    }
    eq(429, end($codes));
});

test('stores 09:00 Beirut as 06:00 UTC in summer and 07:00 UTC in winter', function () use ($app) {
    foreach ([['2026-10-24', '06:00'], ['2026-10-26', '07:00'], ['2027-03-26', '07:00'], ['2027-03-29', '06:00']] as [$date, $utc]) {
        if ($date <= Time::today()) continue;
        $r = call($app, 'POST', '/api/appointments', booking(['date' => $date, 'time' => '09:00', 'phone' => '+9617000' . substr(str_replace('-', '', $date), 2)]));
        eq(201, $r->status, $date . ' ' . $r->body);
        $row = $app->db->one("select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI') as s from rayhab.appointments where id = ?", [$r->data()['id']]);
        eq($date . 'T' . $utc, $row['s'], $date);
    }
});

test('enquiries: "received" on success, field errors otherwise', function () use ($app) {
    $ok = call($app, 'POST', '/api/enquiries', ['first_name' => 'Karim', 'last_name' => 'Saad', 'email' => 'k@example.com', 'phone' => '',
                                                'message' => 'Do you treat adults with scoliosis?']);
    eq(201, $ok->status);
    eq(['status' => 'received'], $ok->data());
    $mail = $app->db->one("select payload from rayhab.notification_outbox where template = 'enquiry' order by id desc limit 1");
    ok(!str_contains((string) $mail['payload'], 'adults with scoliosis'), 'the email does not carry the question itself');
    $bad = call($app, 'POST', '/api/enquiries', ['first_name' => 'K', 'last_name' => 'Saad', 'email' => 'nope', 'message' => 'short']);
    eq(422, $bad->status);
    $keys = array_keys($bad->data()['errors']);
    sort($keys);
    eq(['email', 'first_name', 'message'], $keys);
});
