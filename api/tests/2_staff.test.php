<?php
// Staff sign-in, sessions, the admin actions and the enquiries view.
declare(strict_types=1);

use Rayhab\Auth;

$app = fresh();
$staff = signIn($app);
$n = 0;
$req = function (string $time, ?string $day = null) use ($app, &$n): string {
    return book($app, ['date' => $day ?? fullDay(2), 'time' => $time, 'phone' => '+9617000' . str_pad((string) ++$n, 4, '0', STR_PAD_LEFT)]);
};

test('refuses a wrong password; 401 carries login_url when signed out', function () use ($app) {
    eq(401, call($app, 'POST', '/api/admin/login', ['email' => STAFF_EMAIL, 'password' => 'wrong'])->status);
    $r = call($app, 'GET', '/api/admin/session');
    eq(401, $r->status);
    eq('unauthenticated', $r->data()['error']['code']);
    eq('/admin/login.html', $r->data()['login_url']);
});

test('asks for the code once set up, and ends after five wrong codes', function () use ($app) {
    $login = call($app, 'POST', '/api/admin/login', ['email' => STAFF_EMAIL, 'password' => STAFF_PASSWORD]);
    eq(['mfa' => 'verify'], $login->data());
    $pending = cookieFrom($login, 'rh_pending');
    for ($i = 0; $i < 4; $i++) eq(422, call($app, 'POST', '/api/admin/mfa/verify', ['code' => '000000'], [], ['rh_pending' => $pending])->status);
    eq(401, call($app, 'POST', '/api/admin/mfa/verify', ['code' => '000000'], [], ['rh_pending' => $pending])->status);
    eq('login_expired', call($app, 'POST', '/api/admin/mfa/verify', ['code' => Auth::totp($GLOBALS['TOTP_SECRET'])], [], ['rh_pending' => $pending])->data()['error']['code']);
});

test('the session gives permissions, a CSRF token and the sign-in links', function () use ($app, $staff) {
    $s = call($app, 'GET', '/api/admin/session', null, [], $staff['cookies'])->data();
    eq('Dr. Rayan Halimeh', $s['user']['name']);
    eq('admin', $s['user']['role']);
    eq(['confirm_cash' => true, 'manage_schedule' => true], $s['permissions']);
    eq('/admin/login.html?signout=1', $s['logout_url']);
});

test('every change needs the CSRF token and the site Origin', function () use ($app, $staff, $req) {
    $id = $req('09:00');
    $no = call($app, 'POST', "/api/admin/appointments/$id/approve", [], [], $staff['cookies']);
    eq(403, $no->status);
    eq('csrf', $no->data()['error']['code']);
    eq('origin', staffCall($app, $staff, 'POST', "/api/admin/appointments/$id/approve", [], ['origin' => 'https://evil.example'])->data()['error']['code']);
});

test('approve: approved, a sealed link in the WhatsApp message, actions updated', function () use ($app, $staff, $req) {
    $id = $req('10:00');
    $link = approve($app, $staff, $id);
    ok(preg_match('/^[A-Za-z0-9_-]{40,}$/', $link), 'a link token');
    $a = staffCall($app, $staff, 'GET', "/api/admin/appointments/$id")->data();
    eq('approved', $a['appointment']['status']);
    eq(['reschedule', 'cancel'], $a['appointment']['actions']);
    eq(['approved', 'requested'], array_column($a['events'], 'type'));
    $again = staffCall($app, $staff, 'POST', "/api/admin/appointments/$id/approve", []);
    eq(409, $again->status);
    eq('invalid_transition', $again->data()['error']['code']);
});

test('approve needs a price for the service', function () use ($app, $staff) {
    $app->db->query("update rayhab.services set price_amount = null where id = 'sports'");
    $id = book($app, ['service_id' => 'sports', 'date' => fullDay(5), 'time' => '09:45', 'phone' => '+96170008001']);
    eq('price_missing', staffCall($app, $staff, 'POST', "/api/admin/appointments/$id/approve", [])->data()['error']['code']);
    $app->db->query("update rayhab.services set price_amount = 6000 where id = 'sports'");
});

test('decline needs a reason', function () use ($app, $staff, $req) {
    $id = $req('11:00');
    $r = staffCall($app, $staff, 'POST', "/api/admin/appointments/$id/decline", []);
    eq(422, $r->status);
    ok(isset($r->data()['errors']['reason']), 'reason error');
    eq('declined', staffCall($app, $staff, 'POST', "/api/admin/appointments/$id/decline", ['reason' => 'Duplicate request'])->data()['appointment']['status']);
});

test('reschedule: only to a free time; the patient accepts or asks again', function () use ($app, $staff, $req) {
    $day = fullDay(6);
    $id = $req('09:00', $day);
    $req('10:00', $day);
    eq('slot_taken', staffCall($app, $staff, 'POST', "/api/admin/appointments/$id/reschedule", ['date' => $day, 'time' => '10:00'])->data()['error']['code']);
    $moved = staffCall($app, $staff, 'POST', "/api/admin/appointments/$id/reschedule", ['date' => $day, 'time' => '15:00'])->data()['appointment'];
    eq('reschedule_requested', $moved['status']);
    eq('15:00', $moved['local_time']);
    $link = linkFromOutbox($app, $id, 'new_time');
    eq('reschedule_requested', call($app, 'GET', "/api/payment-selection/$link")->data()['appointment']['status']);
    eq('requested', call($app, 'POST', "/api/payment-selection/$link/reschedule", ['accept' => false])->data()['appointment']['status']);
    staffCall($app, $staff, 'POST', "/api/admin/appointments/$id/reschedule", ['date' => $day, 'time' => '16:00']);
    $link2 = linkFromOutbox($app, $id, 'new_time');
    eq(410, call($app, 'GET', "/api/payment-selection/$link")->status, 'the old link is revoked');
    $yes = call($app, 'POST', "/api/payment-selection/$link2/reschedule", ['accept' => true])->data()['appointment'];
    eq('approved', $yes['status']);
    eq('16:00', $yes['local_time']);
});

test('lists with filters and pages, and the overview counts', function () use ($app, $staff) {
    $all = staffCall($app, $staff, 'GET', '/api/admin/appointments?page_size=2')->data();
    eq(2, count($all['items']));
    ok($all['total'] > 2, 'more than one page');
    $requested = staffCall($app, $staff, 'GET', '/api/admin/appointments?status=requested')->data();
    eq(['requested'], array_values(array_unique(array_column($requested['items'], 'status'))));
    eq($all['total'], staffCall($app, $staff, 'GET', '/api/admin/appointments?q=khoury')->data()['total'], 'every test patient is a Khoury');
    eq($requested['total'], staffCall($app, $staff, 'GET', '/api/admin/overview')->data()['counts']['requested']);
});

test('blocks and frees time, and blocked time is not offered', function () use ($app, $staff) {
    $day = fullDay(8);
    eq(200, staffCall($app, $staff, 'PATCH', '/api/admin/availability', ['add' => [['date' => $day, 'start' => '09:00', 'end' => '11:00', 'reason' => 'Training']]])->status);
    $slots = call($app, 'GET', "/api/availability?service_id=assessment&mode=clinic&date=$day")->data()['slots'];
    eq(false, $slots[0]['available']);
    eq(false, $slots[1]['available']);
    $ex = staffCall($app, $staff, 'GET', "/api/admin/availability?from=$day&to=$day")->data()['exceptions'];
    eq(['date' => $day, 'start' => '09:00', 'end' => '11:00', 'reason' => 'Training'], array_intersect_key($ex[0], array_flip(['date', 'start', 'end', 'reason'])));
    staffCall($app, $staff, 'PATCH', '/api/admin/availability', ['remove' => [$ex[0]['id']]]);
    eq(true, call($app, 'GET', "/api/availability?service_id=assessment&mode=clinic&date=$day")->data()['slots'][0]['available']);
});

test('records history in the audit log', function () use ($app, $staff) {
    $r = staffCall($app, $staff, 'GET', '/api/admin/audit?type=approved')->data();
    ok(count($r['items']) > 0, 'some approvals');
    eq(['kind' => 'staff', 'name' => 'Dr. Rayan Halimeh'], $r['items'][0]['actor']);
});

test('enquiries: listed for staff, oldest open first, answered and reopened', function () use ($app, $staff) {
    foreach (['First question about scoliosis.', 'Second question about knee pain.'] as $i => $m) {
        eq(201, call($app, 'POST', '/api/enquiries', ['first_name' => 'Nour', 'last_name' => 'Aoun' . ($i ? 'b' : ''), 'email' => "n$i@example.com",
                                                      'phone' => $i ? '+961 70 000 000' : '', 'message' => $m])->status);
        $app->db->query("update rayhab.enquiries set created_at = now() - make_interval(mins => ?) where message = ?", [10 - $i, $m]);
    }
    eq(401, call($app, 'GET', '/api/admin/enquiries')->status, 'staff only');
    $open = staffCall($app, $staff, 'GET', '/api/admin/enquiries')->data();
    eq(2, $open['total']);
    eq('First question about scoliosis.', $open['items'][0]['message']);
    eq('open', $open['items'][0]['status']);
    eq(null, $open['items'][0]['phone']);
    eq(2, staffCall($app, $staff, 'GET', '/api/admin/overview')->data()['counts']['enquiries']);
    $id = $open['items'][0]['id'];
    $done = staffCall($app, $staff, 'POST', "/api/admin/enquiries/$id/answered", ['answered' => true])->data()['enquiry'];
    eq('answered', $done['status']);
    eq(['name' => 'Dr. Rayan Halimeh'], $done['answered_by']);
    eq(1, staffCall($app, $staff, 'GET', '/api/admin/enquiries?status=open')->data()['total']);
    eq(1, staffCall($app, $staff, 'GET', '/api/admin/enquiries?status=answered')->data()['total']);
    eq(1, staffCall($app, $staff, 'GET', '/api/admin/enquiries?status=all&q=knee')->data()['total']);
    eq('open', staffCall($app, $staff, 'POST', "/api/admin/enquiries/$id/answered", ['answered' => false])->data()['enquiry']['status']);
    eq(403, call($app, 'POST', "/api/admin/enquiries/$id/answered", ['answered' => true], [], $staff['cookies'])->status, 'needs CSRF');
    eq(404, staffCall($app, $staff, 'POST', '/api/admin/enquiries/00000000-0000-4000-8000-000000000000/answered', ['answered' => true])->status);
});

test('booking notes: only requests with a note, newest first', function () use ($app, $staff) {
    $day = fullDay(14);
    book($app, ['date' => $day, 'time' => '09:00', 'phone' => '+96170007001', 'note' => 'Older note: lower back pain for a month.']);
    $app->db->query("update rayhab.appointments set created_at = now() - interval '1 hour' where note like 'Older note%'");
    book($app, ['date' => $day, 'time' => '10:00', 'phone' => '+96170007002', 'note' => 'Newer note: knee pain after running.']);
    book($app, ['date' => $day, 'time' => '11:00', 'phone' => '+96170007003', 'note' => '']);
    $r = staffCall($app, $staff, 'GET', '/api/admin/appointments?has_note=1&sort=created_desc')->data();
    $notes = array_column($r['items'], 'note');
    eq('Newer note: knee pain after running.', $notes[0]);
    ok(in_array('Older note: lower back pain for a month.', $notes, true), 'the older note is listed');
    ok(!in_array('', $notes, true), 'no empty notes');
});

test('signing out ends the session', function () use ($app) {
    $s2 = signIn($app);
    call($app, 'POST', '/api/admin/logout', [], [], $s2['cookies']);
    eq(401, call($app, 'GET', '/api/admin/session', null, [], $s2['cookies'])->status);
});
