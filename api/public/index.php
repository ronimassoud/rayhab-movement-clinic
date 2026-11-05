<?php
/* Every /api/* request. On Vercel, vercel.json routes them here and the
   settings come from the project's environment variables; locally, the dev
   router does, with RAYHAB_ENV_FILE.

   Any message the request queued (the patient's email, a staff notice) is
   then sent at once: after the response where the server allows it
   (fastcgi_finish_request), otherwise just before the function ends. The
   minute-by-minute cron worker (GET /api/cron/worker) is the backstop. */
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
