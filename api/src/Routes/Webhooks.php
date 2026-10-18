<?php
/* WhatsApp delivery receipts from Meta.

     GET  /api/webhooks/whatsapp   Meta's subscription check (hub.verify_token)
     POST /api/webhooks/whatsapp   statuses: sent, delivered, read, failed

   Every POST is authenticated with X-Hub-Signature-256, an HMAC of the raw
   body with the app secret; anything else is refused. */
declare(strict_types=1);

namespace Rayhab\Routes;

use Rayhab\App;
use Rayhab\Request;
use Rayhab\Response;
use Rayhab\Util;

final class Webhooks
{
    public static function register(App $app): void
    {
        $app->get('/api/webhooks/whatsapp', function (Request $r) use ($app) {
            $q = $r->query;
            // PHP turns the dots in hub.mode into underscores.
            $mode = $q['hub_mode'] ?? $q['hub.mode'] ?? '';
            $token = (string) ($q['hub_verify_token'] ?? $q['hub.verify_token'] ?? '');
            $want = $app->cfg->get('WA_VERIFY_TOKEN');
            if ($want !== '' && $mode === 'subscribe' && hash_equals($want, $token)) {
                $res = new Response(200, (string) ($q['hub_challenge'] ?? $q['hub.challenge'] ?? ''));
                $res->headers['Content-Type'] = 'text/plain';
                return $res;
            }
            return Response::json(['error' => ['code' => 'forbidden', 'message' => 'Verification failed.']], 403);
        });

        $app->post('/api/webhooks/whatsapp', function (Request $r) use ($app) {
            $secret = $app->cfg->get('WA_APP_SECRET');
            $sig = $r->header('x-hub-signature-256');
            if ($secret === '' || $sig === '' || !hash_equals('sha256=' . Util::hmac($secret, $r->body), $sig)) {
                return Response::json(['error' => ['code' => 'unauthenticated', 'message' => 'Signature check failed.']], 401);
            }
            $body = json_decode($r->body, true);
            if (!is_array($body)) return Response::json(['error' => ['code' => 'bad_request', 'message' => 'Not JSON.']], 400);
            foreach ($body['entry'] ?? [] as $entry) {
                foreach ($entry['changes'] ?? [] as $change) {
                    foreach ($change['value']['statuses'] ?? [] as $s) {
                        $app->db->query("update rayhab.notification_outbox set delivery_status = ?,
                                           last_error = case when ? = 'failed' then ? else last_error end where provider_message_id = ?",
                                        [(string) $s['status'], (string) $s['status'], mb_substr((string) json_encode($s['errors'] ?? []), 0, 500), (string) $s['id']]);
                    }
                }
            }
            return Response::json(['ok' => true]);
        });
    }
}
