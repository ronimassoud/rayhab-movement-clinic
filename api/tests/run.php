<?php
/* The API's tests: plain PHP, no framework.

     TEST_DATABASE_URL=postgres://… php tests/run.php     (CI: a postgres:16 service)
     npm test --prefix api/dev                            (locally: PGlite, nothing to install)

   Each *.test.php file gets a fresh schema. Requests go through App::handle
   exactly as Apache's would, without a web server. */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';
require __DIR__ . '/helpers.php';

$url = getenv('TEST_DATABASE_URL');
if (!$url) { fwrite(STDERR, "Set TEST_DATABASE_URL.\n"); exit(2); }
$GLOBALS['TEST_DB_URL'] = $url;

$filter = $argv[1] ?? '';
$files = glob(__DIR__ . '/*.test.php') ?: [];
sort($files);
$passed = 0;
$failed = [];
foreach ($files as $file) {
    $GLOBALS['TESTS'] = [];
    require $file;
    fwrite(STDOUT, basename($file) . "\n");
    foreach ($GLOBALS['TESTS'] as [$name, $fn]) {
        if ($filter !== '' && stripos($name, $filter) === false) continue;
        try {
            $fn();
            $passed++;
            fwrite(STDOUT, "  ✓ $name\n");
        } catch (Throwable $e) {
            $failed[] = basename($file) . ' > ' . $name;
            fwrite(STDOUT, "  ✗ $name\n    " . str_replace("\n", "\n    ", $e->getMessage()) . "\n    at " . basename($e->getFile()) . ':' . $e->getLine() . "\n");
        }
    }
}
fwrite(STDOUT, "\n$passed passed, " . count($failed) . " failed\n");
foreach ($failed as $f) fwrite(STDOUT, "  failed: $f\n");
exit($failed ? 1 : 0);
