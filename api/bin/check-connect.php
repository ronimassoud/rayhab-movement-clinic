<?php
/* Checks Supabase and Resend from YOUR computer, before any server exists,
   using infra/connect.<env>.env:

     node api/dev/check.mjs production [--email you@example.com]

   Supabase: the project answers with the anon key and public sign-up is off;
   both database logins work through the pooler, as the right users, on the
   same project; btree_gist is on; rayhab_app can use it; the owner can create
   the schema. Resend: the domain's DNS records are visible, and the API key
   signs in to SMTP. With --email it sends one test email, which also proves
   the domain is verified. It changes nothing else, and prints no secrets.
   Exit code 0 when everything needed is in place.

   After the first deploy, bin/doctor.php on the server checks the rest. */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use Rayhab\Db;

$failed = 0;
$ok = static function (string $m) { fwrite(STDOUT, "  ok    $m\n"); };
$warn = static function (string $m) { fwrite(STDOUT, "  note  $m\n"); };
$bad = static function (string $m) use (&$failed) { $failed++; fwrite(STDOUT, "  FAIL  $m\n"); };
$mask = static fn (string $m) => preg_replace(['/password=\S+/', '#//([^:/@]+):[^@]+@#'], ['password=…', '//$1:…@'], $m);

// production|staging and --email in any order (getopt stops at the first plain argument).
$env = 'production';
$opts = [];
for ($i = 1; $i < $argc; $i++) {
    if (str_starts_with($argv[$i], '--email=')) $opts['email'] = substr($argv[$i], 8);
    elseif ($argv[$i] === '--email') $opts['email'] = $argv[++$i] ?? '';
    else $env = $argv[$i];
}
if (!in_array($env, ['production', 'staging'], true)) { fwrite(STDERR, "Usage: check-connect.php production|staging [--email you@example.com]\n"); exit(2); }
$file = dirname(__DIR__, 2) . "/infra/connect.$env.env";

fwrite(STDOUT, "Settings (infra/connect.$env.env)\n");
if (!is_file($file)) { $bad("missing: copy infra/connect.example.env to infra/connect.$env.env"); exit(1); }
$c = [];
foreach (file($file, FILE_IGNORE_NEW_LINES) as $line) {
    if (preg_match('/^([A-Z_]+)=(.*)$/', $line, $m)) $c[$m[1]] = trim($m[2]);
}
$need = ['PUBLIC_ORIGIN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DATABASE_URL', 'DATABASE_MIGRATE_URL', 'RESEND_API_KEY', 'EMAIL_FROM', 'STAFF_EMAILS'];
$empty = array_values(array_filter($need, static fn ($k) => ($c[$k] ?? '') === ''));
$empty ? $bad('still empty: ' . implode(', ', $empty) . ' (the checks that need them are skipped)') : $ok('every value is filled in');
$has = static fn (string ...$keys) => !array_intersect($keys, $empty);
$skip = static fn (string $what) => fwrite(STDOUT, "  skip  $what\n");
if (($c['DEPLOY_ENV'] ?? $env) !== $env) $bad("DEPLOY_ENV is {$c['DEPLOY_ENV']}, but this is the $env file");
if (isset($opts['email']) && !filter_var($opts['email'], FILTER_VALIDATE_EMAIL)) { $bad('--email needs an address'); exit(1); }
$ref = preg_match('#^https://([a-z0-9]+)\.supabase\.co/?$#', $c['SUPABASE_URL'] ?? '', $m) ? $m[1] : '';
$has('SUPABASE_URL') && !$ref && $bad('SUPABASE_URL should look like https://<ref>.supabase.co');
$has('RESEND_API_KEY') && !str_starts_with($c['RESEND_API_KEY'], 're_') && $bad('RESEND_API_KEY should start with re_');
$from = preg_match('/<([^>]+)>/', $c['EMAIL_FROM'] ?? '', $m) ? $m[1] : ($c['EMAIL_FROM'] ?? '');
if ($has('EMAIL_FROM')) filter_var($from, FILTER_VALIDATE_EMAIL) ? $ok("sender $from") : $bad('EMAIL_FROM has no valid address');
foreach ($has('STAFF_EMAILS') ? array_map('trim', explode(',', $c['STAFF_EMAILS'])) : [] as $s) {
    if (!filter_var($s, FILTER_VALIDATE_EMAIL)) $bad("STAFF_EMAILS: \"$s\" is not an email address");
}

/* HTTPS from this computer: on Windows PHP's curl has no certificate list of
   its own, so it uses the system's. */
$get = static function (string $url, array $headers) {
    $ch = curl_init($url);
    $o = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_HTTPHEADER => $headers];
    if (PHP_OS_FAMILY === 'Windows' && !ini_get('curl.cainfo') && defined('CURLSSLOPT_NATIVE_CA')) $o[CURLOPT_SSL_OPTIONS] = CURLSSLOPT_NATIVE_CA;
    curl_setopt_array($ch, $o);
    $raw = curl_exec($ch);
    $r = ['status' => $raw === false ? 0 : (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'error' => curl_error($ch), 'json' => json_decode((string) $raw, true) ?: []];
    curl_close($ch);
    return $r;
};

fwrite(STDOUT, "Supabase sign-in\n");
$r = $has('SUPABASE_URL', 'SUPABASE_ANON_KEY') && $ref ? $get(rtrim($c['SUPABASE_URL'], '/') . '/auth/v1/settings', ['apikey: ' . $c['SUPABASE_ANON_KEY']]) : null;
if ($r === null) {
    $skip('needs SUPABASE_URL and SUPABASE_ANON_KEY');
} elseif ($r['status'] === 200) {
    $ok('the project answers with this anon key');
    $su = $r['json']['disable_signup'] ?? null;
    $su === true ? $ok('public sign-up is off')
        : ($su === false ? $bad('anyone can sign up: Authentication > Sign In / Providers, turn off "Allow new users to sign up" (runbook 5.6)') : $warn('could not read the sign-up setting'));
    empty($r['json']['external']['email']) && $warn('email sign-in looks disabled; staff sign in with email and password');
} else {
    $bad('Supabase Auth: ' . ($r['status'] ? 'HTTP ' . $r['status'] . ($r['status'] === 401 ? ' (the anon key does not belong to this project)' : '') : $r['error'] . ' (check SUPABASE_URL)'));
}

fwrite(STDOUT, "Supabase database\n");
$hosts = [];
foreach (['DATABASE_URL' => 'rayhab_app', 'DATABASE_MIGRATE_URL' => 'postgres'] as $key => $role) {
    if (!$has($key)) { $skip("needs $key"); continue; }
    $u = parse_url($c[$key]) ?: [];
    $user = urldecode($u['user'] ?? '');
    $hosts[$key] = ($u['host'] ?? '') . ':' . ($u['port'] ?? 5432);
    if (str_starts_with($u['host'] ?? '', 'db.')) $warn("$key uses the direct host; use the Session pooler URL instead (the direct one needs IPv6)");
    if (($u['port'] ?? 5432) == 6543) $warn("$key uses port 6543 (transaction pooler); use the Session pooler, port 5432");
    if ($ref && str_contains($u['host'] ?? '', 'pooler.supabase.com') && $user !== "$role.$ref") {
        $bad("$key should sign in as $role.$ref (it says " . ($user ?: 'nobody') . ')');
        continue;
    }
    try {
        $db = Db::connect($c[$key]);
        $me = (string) $db->one('select current_user as u')['u'];
        $me === $role ? $ok("$key connects, as $role") : $bad("$key connects as $me, expected $role");
        if ($role === 'rayhab_app') {
            $db->one("select 1 as x from pg_extension where extname = 'btree_gist'") ? $ok('btree_gist is on') : $bad('btree_gist is off: run infra/supabase/setup.sql');
            $usage = $db->one("select has_schema_privilege(oid, 'USAGE') as x from pg_namespace where nspname = 'extensions'");
            $usage === null ? $bad('there is no extensions schema: is this a Supabase database?')
                : ($usage['x'] ? $ok('rayhab_app can use the extensions schema') : $bad('rayhab_app cannot use the extensions schema: run infra/supabase/setup.sql'));
            if ($db->one("select 1 as x from pg_namespace where nspname = 'rayhab'")) {
                $mig = $db->query('select name from rayhab.schema_migrations order by name');
                $ok('tables exist; migrations applied: ' . (implode(', ', array_column($mig, 'name')) ?: 'none'));
            } else {
                $warn('no tables yet: the first deploy creates them');
            }
        } else {
            $db->one('select has_database_privilege(current_database(), \'CREATE\') as x')['x'] ? $ok('the owner can create the rayhab schema') : $bad('the postgres login cannot create schemas');
        }
    } catch (Throwable $e) {
        $msg = $mask($e->getMessage());
        // libpq tries twice and repeats itself; the FATAL line is the useful part.
        if (preg_match('/FATAL:\s+(.+?)(?=\s+connection to server|$)/s', $msg, $m)) $msg = $m[1];
        $hint = str_contains($msg, 'password authentication failed') ? ' (wrong password'
              . ($role === 'rayhab_app' ? ': the one you put in setup.sql' : ': the database password from project creation, or reset it under Database > Settings')
              . '; symbols such as @ # / ? % must be URL-encoded, so letters and digits are simplest)'
              : (str_contains($msg, 'Tenant or user not found') ? ' (the user should be ' . $role . '.<project-ref>, and the role must exist: setup.sql)' : '');
        $bad("$key: " . trim(preg_replace('/\s+/', ' ', $msg)) . $hint);
    }
}
if (count(array_unique($hosts)) > 1) $bad('DATABASE_URL and DATABASE_MIGRATE_URL point at different hosts; use the same Session pooler URL for both');

fwrite(STDOUT, "Resend domain\n");
$domain = strtolower(substr(strrchr($from, '@') ?: '@', 1));
if ($domain === '') {
    $skip('needs EMAIL_FROM');
} else {
    $txt = static fn (string $name) => implode(' ', array_column(@dns_get_record($name, DNS_TXT) ?: [], 'txt'));
    $txt("resend._domainkey.$domain") !== '' ? $ok("DKIM record resend._domainkey.$domain is visible") : $warn("DKIM record resend._domainkey.$domain not visible yet (Resend > Domains lists the records; DNS can take a few hours)");
    @dns_get_record("send.$domain", DNS_MX) ? $ok("bounce record (MX send.$domain) is visible") : $warn("MX record send.$domain not visible yet");
    str_contains($txt("send.$domain"), 'v=spf1') ? $ok("SPF record (TXT send.$domain) is visible") : $warn("SPF record TXT send.$domain not visible yet");
    $warn('Resend > Domains must say "Verified" before mail goes out; --email proves it');
}

fwrite(STDOUT, "Resend SMTP\n");
/* The same route the server uses: smtp.resend.com:587, STARTTLS, user
   "resend", the API key as password. */
$smtp = static function (array &$log) use ($c, $from, $opts): void {
    $s = @stream_socket_client('tcp://smtp.resend.com:587', $no, $err, 10);
    if (!$s) throw new RuntimeException("cannot reach smtp.resend.com:587 ($err); a network or firewall blocking port 587?");
    stream_set_timeout($s, 15);
    $read = static function () use ($s): string {
        $out = '';
        while (($l = fgets($s, 1024)) !== false) { $out .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; }
        return $out;
    };
    $say = static function (string $cmd, string $want, string $what) use ($s, $read): string {
        if ($cmd !== '') fwrite($s, $cmd . "\r\n");
        $r = $read();
        if (strncmp($r, $want, 3) !== 0) throw new RuntimeException($what . ': ' . trim(preg_replace('/\s+/', ' ', $r) ?: 'no answer'));
        return $r;
    };
    $say('', '220', 'greeting');
    $say('EHLO rayhab-check', '250', 'EHLO');
    $say('STARTTLS', '220', 'STARTTLS');
    if (!stream_socket_enable_crypto($s, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new RuntimeException('TLS handshake failed');
    $log[] = 'TLS';
    $say('EHLO rayhab-check', '250', 'EHLO');
    $say('AUTH LOGIN', '334', 'AUTH');
    $say(base64_encode('resend'), '334', 'AUTH');
    $say(base64_encode($c['RESEND_API_KEY']), '235', 'sign-in with RESEND_API_KEY');
    $log[] = 'auth';
    if (isset($opts['email'])) {
        $to = (string) $opts['email'];
        $say("MAIL FROM:<$from>", '250', 'sender');
        $say("RCPT TO:<$to>", '250', 'recipient');
        $say('DATA', '354', 'DATA');
        $msg = "From: {$c['EMAIL_FROM']}\r\nTo: <$to>\r\nSubject: Rayhab: connection check\r\nDate: " . date(DATE_RFC2822)
             . "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
             . "This is a test from the Rayhab connection check.\r\nIf it arrived, Resend is connected and the domain is verified.\r\n.";
        $log[] = trim($say($msg, '250', 'sending (if it mentions the domain, verify it in Resend > Domains)'));
    }
    fwrite($s, "QUIT\r\n");
    fclose($s);
};
$log = [];
if (!$has('RESEND_API_KEY', 'EMAIL_FROM')) {
    $skip('needs RESEND_API_KEY and EMAIL_FROM');
} else try {
    $smtp($log);
    $ok('smtp.resend.com:587 with STARTTLS');
    $ok('RESEND_API_KEY signs in');
    isset($opts['email']) ? $ok('test email accepted for ' . $opts['email'] . ': check the inbox (and spam)') : $warn('add --email you@example.com to send a test and prove the domain is verified');
} catch (Throwable $e) {
    if (in_array('TLS', $log, true)) $ok('smtp.resend.com:587 with STARTTLS');
    if (in_array('auth', $log, true)) $ok('RESEND_API_KEY signs in');
    $msg = $e->getMessage();
    $bad($msg . (str_contains($msg, 'sign-in') ? ' (the key is wrong or was deleted: make a new one with Sending access)' : ''));
}

fwrite(STDOUT, $failed ? "\n$failed problem(s) to fix.\n" : "\nSupabase and Resend are connected for $env.\n");
exit($failed ? 1 : 0);
