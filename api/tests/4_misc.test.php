<?php
// Configuration safety, the WhatsApp webhook, holds, errors and log masking.
declare(strict_types=1);

use Rayhab\App;
use Rayhab\Config;
use Rayhab\Inbound;
use Rayhab\Messaging;
use Rayhab\Util;
use Rayhab\Worker;

$app = fresh(['WA_APP_SECRET' => 'wa-secret', 'WA_VERIFY_TOKEN' => 'verify-me']);

$throws = function (array $values, string $needle): void {
    try { new Config($values); } catch (RuntimeException $e) { ok(str_contains($e->getMessage(), $needle), "message mentions $needle: " . $e->getMessage()); return; }
    throw new RuntimeException("accepted a configuration that should mention $needle");
};
$prod = ['APP_SECRET' => str_repeat('x', 40), 'DEPLOY_ENV' => 'production', 'DATABASE_URL' => 'postgres://u:p@h/db', 'PUBLIC_ORIGIN' => 'https://dr-rayhab.com',
         'SUPABASE_URL' => 'https://p.supabase.co', 'SUPABASE_ANON_KEY' => 'k', 'WHATSAPP_DRIVER' => 'off', 'EMAIL_DRIVER' => 'off'];

test('refuses unsafe production settings', function () use ($throws, $prod) {
    $throws(['WHISH_DRIVER' => 'sandbox'] + $prod, 'sandbox');
    $throws(['AUTH_DRIVER' => 'dev'] + $prod, 'AUTH_DRIVER');
    $throws(['PUBLIC_ORIGIN' => 'http://dr-rayhab.com'] + $prod, 'https');
    $throws(['WHATSAPP_DRIVER' => 'log'] + $prod, 'WHATSAPP_DRIVER');
    $throws(['APP_SECRET' => 'short'], 'APP_SECRET');
});

test('accepts a complete production setup', function () use ($prod) {
    eq(['https://dr-rayhab.com'], (new Config($prod))->origins);
});

test('reads a settings file, ignoring comments', function () {
    $f = tempnam(sys_get_temp_dir(), 'env');
    file_put_contents($f, "# comment\nAPP_SECRET=" . str_repeat('y', 40) . "\nPOLICY_CASH_TEXT=\"Pay at reception.\"\n\n");
    eq('Pay at reception.', Config::fromFile($f)->get('POLICY_CASH_TEXT'));
    unlink($f);
});

test('WhatsApp webhook: subscription check and signed delivery receipts only', function () use ($app) {
    eq('42', call($app, 'GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42')->body);
    eq(403, call($app, 'GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=no&hub.challenge=42')->status);
    $app->db->query("insert into rayhab.notification_outbox (channel, template, recipient, provider_message_id, status) values ('whatsapp', 'approved', '+961', 'wamid.1', 'sent')");
    $raw = (string) json_encode(['entry' => [['changes' => [['value' => ['statuses' => [['id' => 'wamid.1', 'status' => 'delivered']]]]]]]]);
    eq(401, call($app, 'POST', '/api/webhooks/whatsapp', $raw, ['x-hub-signature-256' => 'sha256=bad'])->status);
    eq(200, call($app, 'POST', '/api/webhooks/whatsapp', $raw, ['x-hub-signature-256' => 'sha256=' . Util::hmac('wa-secret', $raw)])->status);
    eq('delivered', $app->db->one("select delivery_status from rayhab.notification_outbox where provider_message_id = 'wamid.1'")['delivery_status']);
});

test('a request nobody answers in time expires and frees its time', function () use ($app) {
    $id = book($app, ['time' => '17:00']);
    $app->db->query("update rayhab.appointments set hold_expires_at = now() - interval '1 minute' where id = ?", [$id]);
    eq(1, (new Worker($app, new Messaging($app->cfg)))->expireHolds());
    eq('expired', $app->db->one('select status from rayhab.appointments where id = ?', [$id])['status']);
    eq(201, call($app, 'POST', '/api/appointments', booking(['time' => '17:00', 'phone' => '+96170000999']))->status);
});

test('answers unknown routes and bad bodies in the error shape', function () use ($app) {
    eq('not_found', call($app, 'GET', '/api/nope')->data()['error']['code']);
    $r = call($app, 'POST', '/api/appointments', '{bad');
    eq(400, $r->status);
    eq('bad_request', $r->data()['error']['code']);
});

test('payment link tokens never reach a log line', function () {
    eq('/api/payment-selection/…/reschedule', App::maskUrl('/api/payment-selection/abcDEF123_-xyz/reschedule'));
    eq('/payment/?t=…&x=1', App::maskUrl('/payment/?t=secret&x=1'));
});

test('WhatsApp replies become enquiries; STOP turns WhatsApp off for that number', function () use ($app) {
    $wa = function (array $messages, array $contacts = []) use ($app) {
        $raw = (string) json_encode(['entry' => [['changes' => [['value' => ['messages' => $messages, 'contacts' => $contacts]]]]]]);
        eq(200, call($app, 'POST', '/api/webhooks/whatsapp', $raw, ['x-hub-signature-256' => 'sha256=' . Util::hmac('wa-secret', $raw)])->status);
    };
    $enq = fn(string $msgId) => $app->db->one('select first_name, last_name, email, phone, message, channel, appointment_id from rayhab.enquiries where source_message_id = ?', [$msgId]);
    $staffMail = fn(string $template) => $app->db->query('select payload from rayhab.notification_outbox where channel = ? and template = ? order by id', ['email', $template]);
    $id = book($app, ['date' => fullDay(11), 'time' => '09:00', 'phone' => '+96170000555', 'first_name' => 'Nada', 'last_name' => 'Saab']);

    // A reply: an enquiry under the booking's name, linked to it; the staff email doesn't carry the text.
    $wa([['from' => '96170000555', 'id' => 'wamid.r1', 'type' => 'text', 'text' => ['body' => 'Can I come 30 minutes later? My back is worse today.']]],
        [['wa_id' => '96170000555', 'profile' => ['name' => 'N S']]]);
    eq(['first_name' => 'Nada', 'last_name' => 'Saab', 'email' => null, 'phone' => '+96170000555',
        'message' => 'Can I come 30 minutes later? My back is worse today.', 'channel' => 'whatsapp', 'appointment_id' => $id], $enq('wamid.r1'));
    $mails = $staffMail('whatsapp_reply');
    ok(count($mails) >= 1 && !str_contains((string) end($mails)['payload'], 'back is worse'), 'the email says a reply arrived, not what it says');
    $wa([['from' => '96170000555', 'id' => 'wamid.r1', 'type' => 'text', 'text' => ['body' => 'Can I come 30 minutes later? My back is worse today.']]]);
    eq(1, (int) $app->db->one("select count(*)::int as n from rayhab.enquiries where source_message_id = 'wamid.r1'")['n'], 'a redelivered webhook counts once');

    // A photo is not kept; the admin says one arrived.
    $wa([['from' => '96170000555', 'id' => 'wamid.r2', 'type' => 'image', 'image' => ['id' => 'media.1']]]);
    ok(str_contains($enq('wamid.r2')['message'], 'sent a photo'), 'a photo is shown as a note, not stored');

    // Someone with no booking: the WhatsApp profile name, no appointment.
    $wa([['from' => '96171999888', 'id' => 'wamid.r3', 'type' => 'text', 'text' => ['body' => 'Hello, do you treat knees?']]],
        [['wa_id' => '96171999888', 'profile' => ['name' => 'Omar El Khoury']]]);
    eq(['Omar', 'El Khoury', null], [$enq('wamid.r3')['first_name'], $enq('wamid.r3')['last_name'], $enq('wamid.r3')['appointment_id']]);

    // STOP: consent off for that number, queued WhatsApp messages dropped, staff told, no enquiry.
    $app->db->query("insert into rayhab.notification_outbox (channel, template, recipient, appointment_id, status) values ('whatsapp', 'reminder', '+96170000555', ?, 'pending')", [$id]);
    $wa([['from' => '96170000555', 'id' => 'wamid.s1', 'type' => 'text', 'text' => ['body' => ' Stop! ']]]);
    eq(null, $app->db->one('select consent_whatsapp_at from rayhab.appointments where id = ?', [$id])['consent_whatsapp_at']);
    eq('skipped', $app->db->one("select status from rayhab.notification_outbox where template = 'reminder' and appointment_id = ?", [$id])['status']);
    eq(null, $enq('wamid.s1'), 'STOP is not an enquiry');
    ok(count($staffMail('whatsapp_opt_out')) >= 1, 'staff are told');
    ok((bool) $app->db->one("select 1 as x from rayhab.events where type = 'whatsapp_opt_out' and appointment_id = ?", [$id]), 'recorded in the audit log');
    $before = (int) $app->db->one("select count(*)::int as n from rayhab.notification_outbox where channel = 'whatsapp'")['n'];
    $app->notify->whatsapp($app->notify->row($id), 'approved', ['Thursday', '09:00']);
    eq($before, (int) $app->db->one("select count(*)::int as n from rayhab.notification_outbox where channel = 'whatsapp'")['n'], 'no further WhatsApp messages');

    ok(Inbound::isStop('إيقاف') && Inbound::isStop('UNSUBSCRIBE') && Inbound::isStop('stop.'), 'STOP in Arabic, any case, with punctuation');
    ok(!Inbound::isStop("please don't stop my reminders"), 'a sentence that mentions stop is a reply');
});

test('the worker health check fails once the worker stops', function () use ($app) {
    $app->db->query("delete from rayhab.heartbeats where name = 'worker'");
    eq(503, call($app, 'GET', '/api/health/worker')->status);
    (new Worker($app, new Messaging($app->cfg)))->tick();
    $r = call($app, 'GET', '/api/health/worker');
    eq(200, $r->status);
    ok($r->data()['last_run'] !== null, 'reports the last run');
    $app->db->query("update rayhab.heartbeats set at = now() - interval '6 minutes' where name = 'worker'");
    eq(503, call($app, 'GET', '/api/health/worker')->status);
});

test('blocked sign-in attempts email the staff, once an hour', function () use ($app) {
    $try = fn() => $app->handle(new \Rayhab\Request('POST', '/api/admin/login', [], ['origin' => ORIGIN, 'content-type' => 'application/json'], [],
                                                    (string) json_encode(['email' => 'nobody@example.com', 'password' => 'x']), '10.250.0.1'));
    $count = fn() => (int) $app->db->one("select count(*)::int as n from rayhab.notification_outbox where template = 'signin_alert'")['n'];
    $before = $count();
    for ($i = 0; $i < 10; $i++) ok($try()->status !== 429, 'under the limit');
    eq($before, $count(), 'no alert while under the limit');
    eq(429, $try()->status);
    eq(429, $try()->status);
    eq($before + 1, $count(), 'one alert per staff address, however often it trips');
    $mail = $app->db->one("select payload from rayhab.notification_outbox where template = 'signin_alert' order by id desc limit 1");
    ok(!str_contains((string) $mail['payload'], '10.250.0.1'), 'the address is not emailed');
});

test('error logs keep out the personal data a database error can quote', function () use ($app) {
    $email = 'leak-' . bin2hex(random_bytes(3)) . '@example.com';
    $app->db->query("create temporary table redact_probe (email text unique)");
    $app->db->query('insert into redact_probe values (?)', [$email]);
    try { $app->db->query('insert into redact_probe values (?)', [$email]); throw new LogicException('no duplicate error'); }
    catch (PDOException $e) { $line = App::redact((string) $e); }
    ok(!str_contains($line, $email), 'the duplicate value is withheld');
    ok(str_contains($line, '23505'), 'the error code stays');
    $line = App::redact('syntax error at or near "Maya Khoury" for +961 70 000 101 and 96170000101, on 2026-10-20 at App.php(61)');
    ok(!str_contains($line, 'Maya') && !str_contains($line, '000 101') && !str_contains($line, '96170000101'), 'names near a syntax error and numbers are withheld');
    ok(str_contains($line, '2026-10-20') && str_contains($line, 'App.php(61)'), 'dates and line numbers stay');
});

test('sealing round-trips and refuses tampering', function () {
    $s = Util::seal('k' . str_repeat('x', 40), 'hello');
    eq('hello', Util::unseal('k' . str_repeat('x', 40), $s));
    try { Util::unseal('other' . str_repeat('x', 40), $s); throw new LogicException('opened with the wrong key'); } catch (RuntimeException $e) { ok(true, 'refused'); }
});
