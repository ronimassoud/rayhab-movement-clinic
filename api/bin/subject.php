<?php
/* Requests about one person's data: show, export or erase it (Subject.php).
   Run on the server, after the clinic has checked who is asking (runbook,
   "Requests about personal data"):

     sudo -u www-data RAYHAB_ENV_FILE=/srv/rayhab/production/app.env \
       php /srv/rayhab/production/api/current/bin/subject.php <find|export|erase> --phone +961... [--email a@b.c] [--yes]

     find    what is held, as counts, and what erasing would do
     export  everything held, as JSON on standard output (redirect it to a
             file, give it to the person securely, then delete the file)
     erase   with --yes, erases; without it, only shows what would happen */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use Rayhab\Config;
use Rayhab\Db;
use Rayhab\Subject;

// The command, then options in any order (getopt stops at the first plain word).
$cmd = $argv[1] ?? '';
$opts = [];
for ($i = 2; $i < $argc; $i++) {
    if (preg_match('/^--(phone|email)=(.*)$/', $argv[$i], $m)) $opts[$m[1]] = $m[2];
    elseif (in_array($argv[$i], ['--phone', '--email'], true)) $opts[substr($argv[$i], 2)] = $argv[++$i] ?? '';
    elseif ($argv[$i] === '--yes') $opts['yes'] = true;
    else { fwrite(STDERR, "Unknown option: {$argv[$i]} (quote a phone number that has spaces)\n"); exit(2); }
}
if (!in_array($cmd, ['find', 'export', 'erase'], true)) {
    fwrite(STDERR, "Usage: subject.php <find|export|erase> --phone +961... [--email a@b.c] [--yes]\n");
    exit(2);
}

try {
    $cfg = Config::fromEnvironment();
    $subject = new Subject(Db::connect($cfg->get('DATABASE_URL')), (string) ($opts['phone'] ?? ''), (string) ($opts['email'] ?? ''));
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(2);
}

if ($cmd === 'export') {
    fwrite(STDOUT, json_encode($subject->export(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
    exit(0);
}

$plan = $subject->plan();
$lines = [
    'patient records found' => $plan['patient_records'],
    'requests that never became appointments (deleted on erase)' => $plan['requests_deleted'],
    'appointments that happened or were paid (kept, without name, contact or note)' => $plan['appointments_kept_anonymized'],
    'website questions (deleted on erase)' => $plan['questions_deleted'],
    'upcoming appointments (must be cancelled first)' => $plan['upcoming'],
];
foreach ($lines as $label => $n) fwrite(STDOUT, sprintf("  %3d  %s\n", $n, $label));

if ($cmd === 'find') exit(0);
if (!isset($opts['yes'])) {
    fwrite(STDOUT, "\nNothing erased. Add --yes to erase.\n");
    exit(0);
}
try {
    $subject->erase();
    fwrite(STDOUT, "\nErased. The audit log records that it happened, with counts only.\n");
} catch (Throwable $e) {
    fwrite(STDERR, "\nNot erased: " . $e->getMessage() . "\n");
    exit(1);
}
