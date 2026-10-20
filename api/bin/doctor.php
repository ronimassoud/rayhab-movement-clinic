<?php
/* Checks that the API is connected: settings, Supabase (database and
   sign-in), the clinic's data, and email through Resend. Run on the server
   after push-settings.sh and the first deploy:

     sudo -u www-data RAYHAB_ENV_FILE=/srv/rayhab/production/app.env \
       php /srv/rayhab/production/api/current/bin/doctor.php [--email you@example.com]

   With --email it sends one test email to that address. It changes nothing
   else. Exit code 0 when everything needed is in place. */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use Rayhab\Config;
use Rayhab\Db;
use Rayhab\HttpClient;
use Rayhab\Messaging;

$failed = 0;
$ok = static function (string $m) { fwrite(STDOUT, "  ok    $m\n"); };
$warn = static function (string $m) { fwrite(STDOUT, "  note  $m\n"); };
$bad = static function (string $m) use (&$failed) { $failed++; fwrite(STDOUT, "  FAIL  $m\n"); };

$opts = getopt('', ['email:']);

fwrite(STDOUT, "Settings\n");
try {
    $cfg = Config::fromEnvironment();
    $ok('app.env is complete for ' . $cfg->env() . ' (' . $cfg->get('PUBLIC_ORIGIN') . ')');
    $ok('drivers: auth ' . $cfg->get('AUTH_DRIVER') . ', email ' . $cfg->get('EMAIL_DRIVER') . ', WhatsApp ' . $cfg->get('WHATSAPP_DRIVER') . ', Whish ' . $cfg->get('WHISH_DRIVER'));
} catch (Throwable $e) {
    $bad($e->getMessage());
    exit(1);
}

fwrite(STDOUT, "Supabase database\n");
$db = null;
try {
    $db = Db::connect($cfg->get('DATABASE_URL'));
    $who = $db->one('select current_user as u, version() as v');
    $who['u'] === 'rayhab_app' ? $ok('connected as rayhab_app') : $warn('connected as ' . $who['u'] . ' (expected rayhab_app: the API should not use the owner)');
    $ok(preg_replace('/ on .*$/', '', (string) $who['v']));
    $ext = $db->one("select 1 as x from pg_extension where extname = 'btree_gist'");
    $ext ? $ok('btree_gist is enabled') : $bad('btree_gist is not enabled (infra/supabase/setup.sql)');
    $mig = $db->query('select name from rayhab.schema_migrations order by name');
    $mig ? $ok('migrations applied: ' . implode(', ', array_column($mig, 'name'))) : $bad('no migrations yet: deploy first');
    $n = (int) $db->one('select count(*)::int as n from rayhab.services where active')['n'];
    $ok("$n services");
    $db->query("insert into rayhab.rate_limits (bucket, window_start, hits) values ('doctor', now(), 1) on conflict do nothing");
    $db->query("delete from rayhab.rate_limits where bucket = 'doctor'");
    $ok('the API can write');
    $noPrice = array_column($db->query('select name from rayhab.services where active and price_amount is null'), 'name');
    $noPrice ? $warn('no price yet for: ' . implode(', ', $noPrice) . ' (runbook step 11; requests for these cannot be approved)') : $ok('every service has a price');
    $staff = (int) $db->one('select count(*)::int as n from rayhab.practitioners where active and auth_user_id is not null')['n'];
    $staff ? $ok("$staff staff account(s) linked to Supabase Auth") : $bad('no staff account linked yet (runbook step 5.6, the SQL after the first deploy)');
    $hb = $db->one("select extract(epoch from now() - at)::int as s from rayhab.heartbeats where name = 'worker'");
    if (!$hb) $warn('the cron worker has not finished a run yet (/etc/cron.d/rayhab; it runs every minute)');
    elseif ($hb['s'] <= 300) $ok('the cron worker last finished ' . $hb['s'] . 's ago');
    else $bad('the cron worker last finished ' . round($hb['s'] / 60) . ' minutes ago: see /var/log/rayhab/worker-' . $cfg->env() . '.log');
} catch (Throwable $e) {
    $bad('database: ' . preg_replace('/password=\S+/', 'password=…', $e->getMessage()));
}

fwrite(STDOUT, "Supabase sign-in\n");
$r = $cfg->get('AUTH_DRIVER') === 'dev' ? null
   : HttpClient::json('GET', rtrim($cfg->get('SUPABASE_URL'), '/') . '/auth/v1/settings', ['apikey' => $cfg->get('SUPABASE_ANON_KEY')], null, 10);
if ($r === null) {
    $warn('development sign-in stand-in (AUTH_DRIVER=dev): Supabase not checked');
} elseif ($r['status'] === 200) {
    $ok('Supabase Auth answers with this key');
    if (($r['json']['disable_signup'] ?? null) === false) $bad('anyone can sign up: turn off "Allow new users to sign up" (runbook step 5.6)');
    elseif (($r['json']['disable_signup'] ?? null) === true) $ok('public sign-up is off');
    if (empty($r['json']['external']['email'])) $warn('email sign-in looks disabled; staff sign in with email and password');
} else {
    $bad('Supabase Auth: ' . ($r['status'] ? 'HTTP ' . $r['status'] . ' (check SUPABASE_URL and SUPABASE_ANON_KEY)' : $r['error']));
}

fwrite(STDOUT, "Email\n");
if ($cfg->get('EMAIL_DRIVER') !== 'mail') {
    $warn('EMAIL_DRIVER is ' . $cfg->get('EMAIL_DRIVER') . ': no email is sent');
} else {
    $ok('notices go to ' . implode(', ', $cfg->staffEmails) . ' from ' . $cfg->get('EMAIL_FROM'));
    if (isset($opts['email'])) {
        try {
            (new Messaging($cfg))->email((string) $opts['email'], 'Rayhab: test email', "This is a test from the Rayhab booking API on " . gethostname() . ".\nIf it arrived, email is working.\n");
            $ok('test email handed to msmtp for ' . $opts['email'] . ' (check the inbox, and /var/log/rayhab/msmtp.log)');
        } catch (Throwable $e) {
            $bad('test email: ' . $e->getMessage() . ' (see /var/log/rayhab/msmtp.log)');
        }
    } else {
        $warn('add --email you@example.com to send a test');
    }
}

fwrite(STDOUT, $failed ? "\n$failed problem(s) to fix.\n" : "\nEverything needed is in place.\n");
exit($failed ? 1 : 0);
