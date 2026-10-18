<?php
// Configuration safety, the WhatsApp webhook, holds, errors and log masking.
declare(strict_types=1);

use Rayhab\App;
use Rayhab\Config;
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

test('sealing round-trips and refuses tampering', function () {
    $s = Util::seal('k' . str_repeat('x', 40), 'hello');
    eq('hello', Util::unseal('k' . str_repeat('x', 40), $s));
    try { Util::unseal('other' . str_repeat('x', 40), $s); throw new LogicException('opened with the wrong key'); } catch (RuntimeException $e) { ok(true, 'refused'); }
});
