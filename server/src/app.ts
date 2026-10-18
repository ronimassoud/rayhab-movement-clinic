/* The API, assembled. Nginx proxies https://dr-rayhab.com/api/* here
   unchanged, so every route keeps its /api prefix. */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import type { Db } from './db/db.js';
import { ApiError } from './lib/errors.js';
import type { AuthDriver } from './integrations/auth.js';
import type { WhishDriver } from './integrations/whish.js';
import { publicRoutes } from './modules/public.js';
import { patientRoutes } from './modules/patient.js';
import { authRoutes } from './modules/auth.js';
import { adminRoutes } from './modules/admin.js';
import { whatsappWebhook } from './modules/webhooks.js';

export interface Deps { cfg: Config; db: Db; auth: AuthDriver; whish: WhishDriver }

export function maskUrl(url: string): string {
  return String(url || '').replace(/(\/payment-selection\/)[^/?#]+/, '$1…').replace(/([?&](?:t|token)=)[^&#]+/g, '$1…');
}

export async function buildApp(deps: Deps, opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const { cfg } = deps;
  const app = Fastify({
    logger: opts.logger ?? {
      level: cfg.LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
      // A payment link's token is in the path; it never reaches the logs.
      serializers: {
        req: (req: any) => ({ method: req.method, url: maskUrl(req.url), id: req.id, ip: req.ip })
      }
    },
    trustProxy: cfg.TRUST_PROXY.split(',').map((s) => s.trim()),
    bodyLimit: 64 * 1024,
    genReqId: () => Math.random().toString(36).slice(2, 12)
  });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new ApiError(429, 'rate_limited', 'Too many requests. Wait a minute and try again.')
  });

  // Nothing the API says is to be cached by a browser or a proxy.
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/') && !reply.getHeader('cache-control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send(err.body());
    if (err && err.statusCode === 429) return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Wait a minute and try again.' } });
    if (err && (err.validation || err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || err.statusCode === 400)) {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'The request could not be read.' } });
    }
    if (err && err.statusCode === 413) return reply.code(413).send({ error: { code: 'too_large', message: 'The request is too large.' } });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong on our side.' } });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'No such endpoint.' } }));

  app.get('/api/health', async () => {
    await deps.db.query('select 1');
    return { ok: true };
  });

  publicRoutes(app, deps);
  patientRoutes(app, deps);
  authRoutes(app, deps);
  adminRoutes(app, deps);
  whatsappWebhook(app, deps);
  return app;
}
