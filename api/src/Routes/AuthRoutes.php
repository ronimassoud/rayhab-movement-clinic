<?php
/* Staff sign-in: password, then an authenticator code (TOTP), always.

     POST /api/admin/login        { email, password } -> { mfa: "verify" | "enroll" }
     POST /api/admin/mfa/enroll   first sign-in only  -> { qr_code, secret }
     POST /api/admin/mfa/verify   { code }            -> { ok: true }, session cookie set
     POST /api/admin/logout

   Between the steps the identity provider's first-step token is kept on the
   server, sealed, for five minutes, behind a short-lived cookie. Five wrong
   codes end the attempt. */
declare(strict_types=1);

namespace Rayhab\Routes;

use Rayhab\ApiError;
use Rayhab\App;
use Rayhab\Check;
use Rayhab\Guard;
use Rayhab\Records;
use Rayhab\Request;
use Rayhab\Response;
use Rayhab\Util;

final class AuthRoutes
{
    public static function register(App $app): void
    {
        $secret = $app->cfg->get('APP_SECRET');
        $expired = static fn() => new ApiError(401, 'login_expired', 'The sign-in took too long. Start again.');
        $read = function (Request $r) use ($app, $secret, $expired): array {
            $raw = $r->cookies[Guard::PENDING_COOKIE] ?? '';
            if ($raw === '') throw $expired();
            $row = $app->db->one('select sealed from rayhab.auth_pending where id_hash = ? and expires_at > now()', [Util::sha256($raw)]);
            if (!$row) throw $expired();
            return [Util::sha256($raw), json_decode(Util::unseal($secret, $row['sealed']), true)];
        };
        $write = fn(string $hash, array $p) => $app->db->query('update rayhab.auth_pending set sealed = ? where id_hash = ?',
                                                              [Util::seal($secret, (string) json_encode($p)), $hash]);
        $clear = fn(Response $res) => $res->cookie(Guard::PENDING_COOKIE, '', $app->guard->cookieOpts(0));

        $app->post('/api/admin/login', function (Request $r) use ($app, $secret) {
            $app->guard->origin($r);
            $app->guard->limit('login-ip:' . $r->ip, 10, 900);
            $c = new Check($r->json());
            $email = $c->email('email', true);
            $password = (string) ($r->json()['password'] ?? '');
            $c->add('password', $password === '' ? 'Enter your password.' : null);
            $c->done();
            $res = $app->auth->password((string) $email, $password);
            $staff = $app->db->one('select id from rayhab.practitioners where auth_user_id = ?::uuid and active', [$res['userId']]);
            if (!$staff) throw ApiError::forbidden('not_staff', 'This account has no access to the clinic admin.');
            $verified = null;
            foreach ($res['factors'] as $f) if ($f['type'] === 'totp' && $f['status'] === 'verified') $verified = $f;
            $raw = Util::token();
            $p = ['accessToken' => $res['accessToken'], 'practitionerId' => $staff['id'], 'factorId' => $verified['id'] ?? null,
                  'enrolled' => $verified !== null, 'tries' => 0];
            $app->db->query('delete from rayhab.auth_pending where expires_at < now()');
            $app->db->query("insert into rayhab.auth_pending (id_hash, sealed, expires_at) values (?, ?, now() + interval '5 minutes')",
                            [Util::sha256($raw), Util::seal($secret, (string) json_encode($p))]);
            return Response::json(['mfa' => $verified ? 'verify' : 'enroll'])->cookie(Guard::PENDING_COOKIE, $raw, $app->guard->cookieOpts(300));
        });

        $app->post('/api/admin/mfa/enroll', function (Request $r) use ($app, $read, $write) {
            $app->guard->origin($r);
            $app->guard->limit('login-ip:' . $r->ip, 10, 900);
            [$hash, $p] = $read($r);
            if ($p['enrolled']) throw ApiError::conflict('already_enrolled', 'An authenticator is already set up. Enter its code.');
            $e = $app->auth->enroll($p['accessToken']);
            $p['factorId'] = $e['factorId'];
            $write($hash, $p);
            return Response::json(['qr_code' => $e['qrCode'], 'secret' => $e['secret']]);
        });

        $app->post('/api/admin/mfa/verify', function (Request $r) use ($app, $read, $write, $clear, $expired) {
            $app->guard->origin($r);
            $app->guard->limit('login-ip:' . $r->ip, 20, 900);
            $code = (string) ($r->json()['code'] ?? '');
            if (!preg_match('/^\d{6}$/', $code)) throw ApiError::validation(['code' => 'Enter the 6-digit code.']);
            [$hash, $p] = $read($r);
            if (!$p['factorId']) throw ApiError::conflict('enroll_first', 'Set up the authenticator first.');
            try {
                $app->auth->verify($p['accessToken'], $p['factorId'], $code);
            } catch (ApiError $e) {
                $p['tries']++;
                if ($p['tries'] >= 5) {
                    $app->db->query('delete from rayhab.auth_pending where id_hash = ?', [$hash]);
                    $err = $expired();
                    throw $err;
                }
                $write($hash, $p);
                throw $e;
            }
            $app->db->query('delete from rayhab.auth_pending where id_hash = ?', [$hash]);
            $res = Response::json(['ok' => true]);
            $clear($res);
            $app->guard->createSession($res, $p['practitionerId'], $r->header('user-agent'));
            $who = $app->db->one('select name from rayhab.practitioners where id = ?', [$p['practitionerId']]);
            Records::log($app->db, 'signed_in', null, ['kind' => 'staff', 'id' => $p['practitionerId'], 'name' => $who['name'] ?? ''],
                         $p['enrolled'] ? 'Signed in' : 'Signed in and set up an authenticator');
            return $res;
        });

        $app->post('/api/admin/logout', function (Request $r) use ($app) {
            $app->guard->origin($r);
            $raw = $r->cookies[Guard::SESSION_COOKIE] ?? '';
            if ($raw !== '') $app->db->query('delete from rayhab.staff_sessions where id_hash = ?', [Util::sha256($raw)]);
            return Response::json(['ok' => true])->cookie(Guard::SESSION_COOKIE, '', $app->guard->cookieOpts(0));
        });
    }
}
