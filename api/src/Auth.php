<?php
/* Staff identity: Supabase Auth, with a TOTP authenticator required.

   All server-side, through Supabase Auth's REST API, so no Supabase key or
   token reaches the browser:

     password   POST {SUPABASE_URL}/auth/v1/token?grant_type=password
     enroll     POST {SUPABASE_URL}/auth/v1/factors              (first sign-in)
     challenge  POST {SUPABASE_URL}/auth/v1/factors/{id}/challenge
     verify     POST {SUPABASE_URL}/auth/v1/factors/{id}/verify  -> aal2

   After Supabase confirms the second factor (aal2) the API issues its own
   session (Guard.php) and keeps no Supabase token.

   The "dev" driver does the same with local users (DEV_STAFF =
   "email:password:practitionerId") and real TOTP codes, so the sign-in page
   can be tried without a Supabase project. Refused outside development. */
declare(strict_types=1);

namespace Rayhab;

final class Auth
{
    public function __construct(private Config $cfg) {}

    private static function badLogin(): ApiError { return new ApiError(401, 'invalid_credentials', 'That email and password do not match.'); }
    private static function badCode(): ApiError
    {
        return new ApiError(422, 'invalid_code', 'That code did not work. Check the time on your phone and try again.',
                            ['errors' => ['code' => 'That code did not work. Try the newest one.']]);
    }
    private static function down(): ApiError { return new ApiError(502, 'auth_unavailable', 'Sign-in is not available right now.'); }

    /** @return array{userId:string,accessToken:string,factors:list<array{id:string,status:string,type:string}>} */
    public function password(string $email, string $password): array
    {
        if ($this->cfg->get('AUTH_DRIVER') === 'dev') return $this->devPassword($email, $password);
        $r = $this->call('/token?grant_type=password', ['email' => $email, 'password' => $password]);
        if (in_array($r['status'], [400, 401, 422], true)) throw self::badLogin();
        if ($r['status'] < 200 || $r['status'] >= 300) throw self::down();
        $factors = array_map(static fn($f) => ['id' => (string) $f['id'], 'status' => (string) $f['status'], 'type' => (string) $f['factor_type']],
                             $r['json']['user']['factors'] ?? []);
        return ['userId' => (string) $r['json']['user']['id'], 'accessToken' => (string) $r['json']['access_token'], 'factors' => $factors];
    }

    /** @return array{factorId:string,qrCode:string,secret:string} */
    public function enroll(string $accessToken): array
    {
        if ($this->cfg->get('AUTH_DRIVER') === 'dev') return $this->devEnroll($accessToken);
        $r = $this->call('/factors', ['factor_type' => 'totp', 'friendly_name' => 'Rayhab admin ' . gmdate('Y-m-d H:i')], $accessToken);
        if ($r['status'] < 200 || $r['status'] >= 300) throw new ApiError(502, 'auth_unavailable', 'The authenticator could not be set up. Try again.');
        return ['factorId' => (string) $r['json']['id'], 'qrCode' => (string) ($r['json']['totp']['qr_code'] ?? ''), 'secret' => (string) ($r['json']['totp']['secret'] ?? '')];
    }

    public function verify(string $accessToken, string $factorId, string $code): void
    {
        if ($this->cfg->get('AUTH_DRIVER') === 'dev') { $this->devVerify($accessToken, $factorId, $code); return; }
        $ch = $this->call('/factors/' . rawurlencode($factorId) . '/challenge', new \stdClass(), $accessToken);
        if ($ch['status'] < 200 || $ch['status'] >= 300) throw self::down();
        $v = $this->call('/factors/' . rawurlencode($factorId) . '/verify', ['challenge_id' => $ch['json']['id'] ?? '', 'code' => $code], $accessToken);
        if ($v['status'] < 200 || $v['status'] >= 300) throw self::badCode();
        $parts = explode('.', (string) ($v['json']['access_token'] ?? ''));
        $claims = json_decode(Util::unb64url($parts[1] ?? ''), true);
        if (($claims['aal'] ?? '') !== 'aal2') throw self::badCode();
    }

    private function call(string $path, mixed $body, ?string $bearer = null): array
    {
        $h = ['apikey' => $this->cfg->get('SUPABASE_ANON_KEY')];
        if ($bearer) $h['Authorization'] = 'Bearer ' . $bearer;
        return HttpClient::json('POST', rtrim($this->cfg->get('SUPABASE_URL'), '/') . '/auth/v1' . $path, $h, $body, 10);
    }

    /* ---------- Development stand-in ---------- */

    public static function devUserId(string $email): string
    {
        $h = hash_hmac('sha256', strtolower($email), 'rayhab-dev');
        return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-4' . substr($h, 13, 3) . '-8' . substr($h, 17, 3) . '-' . substr($h, 20, 12);
    }

    /** @return list<array{email:string,password:string,practitionerId:string,userId:string}> */
    private function devUsers(): array
    {
        $out = [];
        foreach (array_filter(explode(',', $this->cfg->get('DEV_STAFF'))) as $u) {
            [$email, $password, $pid] = array_pad(explode(':', $u), 3, '');
            $out[] = ['email' => $email, 'password' => $password, 'practitionerId' => $pid, 'userId' => self::devUserId($email)];
        }
        return $out;
    }

    // Authenticator secrets of dev users, kept in a file (PHP keeps nothing between requests).
    private function devStore(): string { return sys_get_temp_dir() . '/rayhab-dev-factors-' . substr(hash('sha256', $this->cfg->get('APP_SECRET')), 0, 8) . '.json'; }
    private function devFactors(): array { $f = $this->devStore(); return is_file($f) ? (json_decode((string) file_get_contents($f), true) ?: []) : []; }
    private function devSave(array $f): void { file_put_contents($this->devStore(), json_encode($f)); }

    private function devPassword(string $email, string $password): array
    {
        foreach ($this->devUsers() as $u) {
            if (strcasecmp($u['email'], $email) === 0 && hash_equals($u['password'], $password)) {
                $factors = [];
                foreach ($this->devFactors() as $id => $f) {
                    if ($f['userId'] === $u['userId']) $factors[] = ['id' => $id, 'status' => $f['verified'] ? 'verified' : 'unverified', 'type' => 'totp'];
                }
                return ['userId' => $u['userId'], 'accessToken' => 'dev.' . $u['userId'], 'factors' => $factors];
            }
        }
        throw self::badLogin();
    }

    private function devEnroll(string $accessToken): array
    {
        $secret = self::base32(random_bytes(20));
        $id = 'factor_' . bin2hex(random_bytes(6));
        $all = $this->devFactors();
        $all[$id] = ['secret' => $secret, 'verified' => false, 'userId' => substr($accessToken, 4)];
        $this->devSave($all);
        // No QR library here: the sign-in page shows the key to type in instead.
        return ['factorId' => $id, 'qrCode' => '', 'secret' => $secret];
    }

    private function devVerify(string $accessToken, string $factorId, string $code): void
    {
        $all = $this->devFactors();
        $f = $all[$factorId] ?? null;
        if (!$f || $f['userId'] !== substr($accessToken, 4)) throw self::badCode();
        $ok = false;
        foreach ([-30, 0, 30] as $skew) if (hash_equals(self::totp($f['secret'], time() + $skew), $code)) $ok = true;
        if (!$ok) throw self::badCode();
        $all[$factorId]['verified'] = true;
        $this->devSave($all);
    }

    private const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public static function base32(string $bin): string
    {
        $bits = '';
        foreach (str_split($bin) as $c) $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
        $out = '';
        foreach (str_split($bits, 5) as $chunk) $out .= self::B32[bindec(str_pad($chunk, 5, '0'))];
        return $out;
    }

    private static function unbase32(string $s): string
    {
        $bits = '';
        foreach (str_split(strtoupper(rtrim($s, '='))) as $c) $bits .= str_pad(decbin(strpos(self::B32, $c)), 5, '0', STR_PAD_LEFT);
        $out = '';
        foreach (str_split($bits, 8) as $byte) if (strlen($byte) === 8) $out .= chr(bindec($byte));
        return $out;
    }

    /* RFC 6238: 6 digits, 30-second steps, HMAC-SHA1. */
    public static function totp(string $secret, ?int $at = null): string
    {
        $counter = pack('J', intdiv($at ?? time(), 30));
        $h = hash_hmac('sha1', $counter, self::unbase32($secret), true);
        $o = ord($h[19]) & 15;
        $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
        return str_pad((string) ($n % 1000000), 6, '0', STR_PAD_LEFT);
    }
}
