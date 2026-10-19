<?php
/* Test helpers: a fresh API on a fresh schema, requests, sign-in. */
declare(strict_types=1);

use Rayhab\App;
use Rayhab\Auth;
use Rayhab\Config;
use Rayhab\Db;
use Rayhab\Migrate;
use Rayhab\Request;
use Rayhab\Response;
use Rayhab\Time;
use Rayhab\Util;

const ORIGIN = 'https://dr-rayhab.test';
const STAFF_EMAIL = 'staff@rayhab.test';
const STAFF_PASSWORD = 'correct horse battery';

function test(string $name, callable $fn): void { $GLOBALS['TESTS'][] = [$name, $fn]; }

function eq(mixed $want, mixed $got, string $what = ''): void
{
    if ($want !== $got) throw new RuntimeException(($what ? "$what: " : '') . 'expected ' . json_encode($want, JSON_UNESCAPED_UNICODE) . ', got ' . json_encode($got, JSON_UNESCAPED_UNICODE));
}
function ok(mixed $cond, string $what): void { if (!$cond) throw new RuntimeException("expected: $what"); }

function config(array $extra = []): Config
{
    return new Config(array_merge([
        'DEPLOY_ENV' => 'test', 'PUBLIC_ORIGIN' => ORIGIN, 'APP_SECRET' => 'test-secret-test-secret-test-secret-0000',
        'COOKIE_SECURE' => 'false', 'AUTH_DRIVER' => 'dev', 'DEV_STAFF' => STAFF_EMAIL . ':' . STAFF_PASSWORD . ':pr-rayan',
        'WHATSAPP_DRIVER' => 'log', 'EMAIL_DRIVER' => 'log', 'STAFF_EMAILS' => 'clinic@rayhab.test', 'WHISH_DRIVER' => 'sandbox',
        'HORIZON_DAYS' => '200', 'DATABASE_URL' => $GLOBALS['TEST_DB_URL'],
    ], $extra));
}

/* A fresh schema with the seed, prices, and the test staff account. */
function fresh(array $extra = []): App
{
    $db = Db::connect($GLOBALS['TEST_DB_URL']);
    $db->exec('drop schema if exists rayhab cascade');
    Migrate::run($db, static fn() => null);
    Migrate::seed($db, static fn() => null);
    $db->query('update rayhab.services set price_amount = 8000');
    $db->query('update rayhab.practitioners set auth_user_id = ?::uuid where id = ?', [Auth::devUserId(STAFF_EMAIL), 'pr-rayan']);
    @unlink(sys_get_temp_dir() . '/rayhab-dev-factors-' . substr(hash('sha256', 'test-secret-test-secret-test-secret-0000'), 0, 8) . '.json');
    return new App(config($extra), $db);
}

/* The same database, other settings (for example Whish disabled). */
function sibling(App $app, array $extra): App { return new App(config($extra), $app->db); }

/* The $n-th day from today that is open mornings and afternoons (closed
   Sunday and Wednesday, mornings only Saturday). It counts open days, not
   calendar days, so different $n are always different days, whatever
   weekday the tests run on. */
function fullDay(int $n = 1): string
{
    $d = Time::today();
    while ($n > 0) {
        $d = Time::addDays($d, 1);
        if (!in_array(Time::dow($d), [0, 3, 6], true)) $n--;
    }
    return $d;
}

function booking(array $over = []): array
{
    return array_merge([
        'service_id' => 'assessment', 'practitioner_id' => null, 'for_whom' => 'me', 'mode' => 'clinic',
        'date' => fullDay(), 'time' => '09:00', 'timezone' => 'Asia/Beirut',
        'first_name' => 'Maya', 'last_name' => 'Khoury', 'phone' => '+96170000101', 'email' => 'maya@example.com', 'note' => '',
        'consents' => ['storage' => true, 'whatsapp' => true, 'version' => '2026-10-15'], 'website' => '', 'elapsed_ms' => 40000,
    ], $over);
}

/* One request through the app, as Apache would deliver it. Each call has its
   own address, as separate visitors would, so per-IP limits only bite where
   a test means them to. */
function call(App $app, string $method, string $path, mixed $body = null, array $headers = [], array $cookies = []): Response
{
    static $ip = 0;
    $ip++;
    $q = [];
    if (str_contains($path, '?')) { [$path, $qs] = explode('?', $path, 2); parse_str($qs, $q); }
    $h = array_change_key_case($headers, CASE_LOWER);
    if ($method !== 'GET' && !array_key_exists('origin', $h)) $h['origin'] = ORIGIN;
    if ($body !== null && !isset($h['content-type'])) $h['content-type'] = 'application/json';
    $raw = $body === null ? '' : (is_string($body) ? $body : (string) json_encode($body));
    return $app->handle(new Request($method, $path, $q, $h, $cookies, $raw, '10.' . ($ip >> 16 & 255) . '.' . ($ip >> 8 & 255) . '.' . ($ip & 255)));
}

function cookieFrom(Response $r, string $name): ?string
{
    foreach ($r->cookies as [$n, $v]) if ($n === $name) return $v;
    return null;
}

/* Signs the test staff member in through the real flow: password, the
   authenticator (set up the first time), the code. */
function signIn(App $app): array
{
    $login = call($app, 'POST', '/api/admin/login', ['email' => STAFF_EMAIL, 'password' => STAFF_PASSWORD]);
    eq(200, $login->status, 'login');
    $pending = cookieFrom($login, 'rh_pending');
    if ($login->data()['mfa'] === 'enroll') {
        $enroll = call($app, 'POST', '/api/admin/mfa/enroll', [], [], ['rh_pending' => $pending]);
        $GLOBALS['TOTP_SECRET'] = $enroll->data()['secret'];
    }
    $verify = call($app, 'POST', '/api/admin/mfa/verify', ['code' => Auth::totp($GLOBALS['TOTP_SECRET'])], [], ['rh_pending' => $pending]);
    eq(200, $verify->status, 'verify: ' . $verify->body);
    $session = cookieFrom($verify, 'rh_admin');
    $s = call($app, 'GET', '/api/admin/session', null, [], ['rh_admin' => $session]);
    return ['cookies' => ['rh_admin' => $session], 'csrf' => $s->data()['csrf_token']];
}

function staffCall(App $app, array $staff, string $method, string $path, mixed $body = null, array $headers = []): Response
{
    return call($app, $method, $path, $body, ['x-csrf-token' => $staff['csrf']] + $headers, $staff['cookies']);
}

function book(App $app, array $over = []): string
{
    $r = call($app, 'POST', '/api/appointments', booking($over));
    eq(201, $r->status, 'booking: ' . $r->body);
    return $r->data()['id'];
}

/* The link token the newest message of that kind carries. */
function linkFromOutbox(App $app, string $apptId, string $template): string
{
    $row = $app->db->one('select payload from rayhab.notification_outbox where appointment_id = ? and template = ? order by id desc limit 1', [$apptId, $template]);
    return Util::unseal($app->cfg->get('APP_SECRET'), json_decode((string) $row['payload'], true)['link_sealed']);
}

function approve(App $app, array $staff, string $apptId): string
{
    $r = staffCall($app, $staff, 'POST', '/api/admin/appointments/' . $apptId . '/approve', []);
    eq(200, $r->status, 'approve: ' . $r->body);
    return linkFromOutbox($app, $apptId, 'approved');
}
