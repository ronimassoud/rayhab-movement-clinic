/* WhatsApp delivery receipts from Meta.

     GET  /api/webhooks/whatsapp   Meta's subscription check (hub.verify_token)
     POST /api/webhooks/whatsapp   statuses: sent, delivered, read, failed

   Every POST is authenticated with X-Hub-Signature-256, an HMAC of the raw
   body with the app secret; anything else is refused. */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { hmac, safeEqual } from '../lib/util.js';

export function whatsappWebhook(app: FastifyInstance, { cfg, db }: Deps) {
  app.get('/api/webhooks/whatsapp', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (cfg.WA_VERIFY_TOKEN && q['hub.mode'] === 'subscribe' && safeEqual(q['hub.verify_token'] || '', cfg.WA_VERIFY_TOKEN)) {
      return reply.type('text/plain').send(q['hub.challenge'] || '');
    }
    return reply.code(403).send({ error: { code: 'forbidden', message: 'Verification failed.' } });
  });

  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    scope.post('/api/webhooks/whatsapp', async (req, reply) => {
      const raw = String(req.body || '');
      const sig = String(req.headers['x-hub-signature-256'] || '');
      if (!cfg.WA_APP_SECRET || !sig || !safeEqual(sig, 'sha256=' + hmac(cfg.WA_APP_SECRET, raw))) {
        return reply.code(401).send({ error: { code: 'unauthenticated', message: 'Signature check failed.' } });
      }
      let body: any = {};
      try { body = JSON.parse(raw); } catch { return reply.code(400).send({ error: { code: 'bad_request', message: 'Not JSON.' } }); }
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          for (const s of change.value?.statuses || []) {
            await db.query(`update rayhab.notification_outbox set delivery_status = $2,
                              last_error = case when $2 = 'failed' then $3 else last_error end
                             where provider_message_id = $1`,
                           [s.id, s.status, JSON.stringify(s.errors || []).slice(0, 500)]);
          }
        }
      }
      return { ok: true };
    });
  });
}
