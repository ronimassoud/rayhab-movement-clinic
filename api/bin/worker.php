<?php
/* The cron worker: messages, holds, payment reconciliation, reminders.
   /etc/cron.d/rayhab runs it every minute (infra/cron/rayhab):

     RAYHAB_ENV_FILE=/srv/rayhab/production/app.env php /srv/rayhab/production/api/current/bin/worker.php

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
