<?php
/* Every /api/* request. Apache sends them here (infra/apache), with the
   settings file's path in RAYHAB_ENV_FILE.

   After the response has gone to the browser, any message the request
   queued (a WhatsApp confirmation, a staff email) is sent at once; the
   minute-by-minute cron worker is the backstop. */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use Rayhab\App;
use Rayhab\Config;
use Rayhab\Db;
use Rayhab\Messaging;
use Rayhab\Request;
use Rayhab\Response;
use Rayhab\Worker;

ini_set('display_errors', '0');

try {
    $cfg = Config::fromEnvironment();
    $app = new App($cfg, Db::connect($cfg->get('DATABASE_URL')));
} catch (Throwable $e) {
    error_log('[rayhab] cannot start: ' . $e->getMessage());
    Response::json(['error' => ['code' => 'unavailable', 'message' => 'The booking service is not available right now.']], 503)->send();
    exit;
}

$request = Request::fromGlobals();
$response = $app->handle($request);
$response->send();

if ($request->method !== 'GET' && $response->status < 400) {
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    try { (new Worker($app, new Messaging($cfg)))->deliver(10); } catch (Throwable $e) { error_log('[rayhab] delivery after response: ' . $e->getMessage()); }
}
