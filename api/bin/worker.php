<?php
/* The worker from the command line: messages, holds, payment
   reconciliation, reminders. On Vercel the same work runs every minute
   through GET /api/cron/worker (vercel.json); this is for a server of our own
   or a manual run, with RAYHAB_ENV_FILE naming the settings:

     RAYHAB_ENV_FILE=app.env php api/bin/worker.php

   A lock file keeps two runs from overlapping. */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use Rayhab\App;
use Rayhab\Config;
use Rayhab\Db;
use Rayhab\Messaging;
use Rayhab\Worker;

$cfg = Config::fromEnvironment();
$lock = fopen(sys_get_temp_dir() . '/rayhab-worker-' . $cfg->env() . '.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) exit(0);   // the previous run is still going

try {
    $app = new App($cfg, Db::connect($cfg->get('DATABASE_URL')));
    $r = (new Worker($app, new Messaging($cfg)))->tick();
} catch (Throwable $e) {
    fwrite(STDERR, gmdate('c') . ' worker failed: ' . App::redact((string) $e) . "\n");
    exit(1);
}
if (array_sum($r) > 0) fwrite(STDOUT, gmdate('c') . ' ' . json_encode($r) . "\n");
