<?php
/* Apply migrations, then make sure the starting data is there.
   Run by deploy.sh with the schema owner's connection:

     DATABASE_MIGRATE_URL=postgres://… php bin/migrate.php */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use Rayhab\Db;
use Rayhab\Migrate;

$url = getenv('DATABASE_MIGRATE_URL') ?: getenv('DATABASE_URL');
if (!$url) {
    fwrite(STDERR, "Set DATABASE_MIGRATE_URL.\n");
    exit(1);
}
$db = Db::connect($url);
Migrate::run($db);
Migrate::seed($db);
