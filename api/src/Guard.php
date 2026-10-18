<?php
/* Request plumbing shared by the routes: idempotency, the Origin check,
   rate limits, and staff sessions with CSRF. */
declare(strict_types=1);

namespace Rayhab;

final class Guard
{
    public const SESSION_COOKIE = 'rh_admin';
    public const PENDING_COOKIE = 'rh_pending';
    public const LOGIN_URL = '/admin/login.html';
    public const LOGOUT_URL = '/admin/login.html?signout=1';

    public function __construct(private Db $db, private Config $cfg) {}

    /* Browser writes must come from the site itself. */
    public function origin(Request $r): void
    {
        if (!in_array($r->header('origin'), $this->cfg->origins, true)) {
            throw ApiError::forbidden('origin', 'Requests must come from the clinic’s website.');
        }
    }

    /* At most $max requests per $seconds for one bucket (an IP, a number). */
    public function limit(string $bucket, int $max, int $seconds): void
    {
        $start = intdiv(time(), $seconds) * $seconds;
        $row = $this->db->one(
            "insert into rayhab.rate_limits (bucket, window_start, hits) values (?, to_timestamp(?), 1)
             on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1 returning hits",
            [$bucket, $start]);
        if ((int) $row['hits'] > $max) throw new ApiError(429, 'rate_limited', 'Too many requests. Wait a minute and try again.');
    }

    /* Idempotency-Key: the same key and body return the first answer and do
       nothing twice; the same key with another body is refused. A failure on
       the server's side (5xx) is forgotten, so a retry can succeed. */
    public function idempotent(Request $r, string $scope, callable $run): Response
    {
        $key = $r->header('idempotency-key');
        if ($key === '') return $run();
        if (strlen($key) > 100) throw ApiError::validation(['Idempotency-Key' => 'Too long.']);
        $hash = Util::sha256($r->body);
        $ins = $this->db->query('insert into rayhab.idempotency_keys (scope, key, request_hash) values (?, ?, ?) on conflict do nothing returning key',
                                [$scope, $key, $hash]);
        if (!$ins) {
            $row = $this->db->one('select request_hash, status_code, response from rayhab.idempotency_keys where scope = ? and key = ?', [$scope, $key]);
            if ($row && $row['request_hash'] !== $hash) throw new ApiError(422, 'idempotency_mismatch', 'This key was already used for a different request.');
            if (!$row || $row['status_code'] === null) throw new ApiError(409, 'in_progress', 'The same request is still being handled.');
            return new Response((int) $row['status_code'], (string) $row['response']);
        }
        $save = fn(int $status, string $body) => $this->db->query(
            'update rayhab.idempotency_keys set status_code = ?, response = ? where scope = ? and key = ?', [$status, $body, $scope, $key]);
        try {
            $res = $run();
            $save($res->status, $res->body);
            return $res;
        } catch (ApiError $e) {
            if ($e->status < 500) $save($e->status, (string) json_encode($e->body(), JSON_UNESCAPED_UNICODE));
            else $this->forget($scope, $key);
            throw $e;
        } catch (\Throwable $e) {
            $this->forget($scope, $key);
            throw $e;
        }
    }

    private function forget(string $scope, string $key): void
    {
        $this->db->query('delete from rayhab.idempotency_keys where scope = ? and key = ?', [$scope, $key]);
    }

    /* ---------- Staff sessions ----------
       An opaque cookie (HttpOnly, Secure, SameSite=Strict, Path=/api/admin)
       whose hash is stored, and a CSRF token every change must echo back. */
    public function cookieOpts(int $seconds): array
    {
        return ['expires' => $seconds > 0 ? time() + $seconds : time() - 3600, 'path' => '/api/admin',
                'httponly' => true, 'secure' => $this->cfg->bool('COOKIE_SECURE'), 'samesite' => 'Strict'];
    }

    public function createSession(Response $res, string $practitionerId, string $ua): void
    {
        $raw = Util::token();
        $hours = $this->cfg->int('SESSION_HOURS');
        $this->db->query("insert into rayhab.staff_sessions (id_hash, practitioner_id, csrf_token, expires_at, user_agent)
                          values (?, ?, ?, now() + make_interval(hours => ?), ?)",
                         [Util::sha256($raw), $practitionerId, Util::token(), $hours, mb_substr($ua, 0, 200)]);
        $res->cookie(self::SESSION_COOKIE, $raw, $this->cookieOpts($hours * 3600));
    }

    /** @return array{id:string,name:string,role:string,csrf:string}|null */
    public function staff(Request $r): ?array
    {
        $raw = $r->cookies[self::SESSION_COOKIE] ?? '';
        if ($raw === '') return null;
        $row = $this->db->one("select p.id, p.name, p.role, s.csrf_token from rayhab.staff_sessions s
                                 join rayhab.practitioners p on p.id = s.practitioner_id
                                where s.id_hash = ? and s.expires_at > now() and p.active", [Util::sha256($raw)]);
        if (!$row) return null;
        $this->db->query('update rayhab.staff_sessions set last_seen_at = now() where id_hash = ?', [Util::sha256($raw)]);
        return ['id' => $row['id'], 'name' => $row['name'], 'role' => $row['role'], 'csrf' => $row['csrf_token']];
    }

    /* Every admin route: a live session; for changes also the CSRF token and the Origin. */
    public function requireStaff(Request $r): array
    {
        $s = $this->staff($r);
        if (!$s) {
            $had = ($r->cookies[self::SESSION_COOKIE] ?? '') !== '';
            throw new ApiError(401, $had ? 'session_expired' : 'unauthenticated',
                               $had ? 'Your session has expired.' : 'Sign in to continue.', ['login_url' => self::LOGIN_URL]);
        }
        if ($r->method !== 'GET') {
            $this->origin($r);
            $sent = $r->header('x-csrf-token');
            if ($sent === '' || !hash_equals($s['csrf'], $sent)) throw ApiError::forbidden('csrf', 'Missing or wrong CSRF token.');
        }
        return $s;
    }

    /** @return array{confirm_cash:bool,manage_schedule:bool} */
    public static function permissions(string $role): array
    {
        return ['confirm_cash' => true, 'manage_schedule' => $role !== 'reception'];
    }

    public static function can(array $staff, string $what): void
    {
        if (!self::permissions($staff['role'])[$what]) throw ApiError::forbidden('forbidden', 'You do not have permission to do this.');
    }
}
