/* WhatsApp (Meta WhatsApp Business Cloud API) and email (SMTP).

   Each has a "log" driver for development, which writes what would have
   been sent to the log, and "off", which skips sending (the outbox records
   it as skipped). Production requires the real drivers or "off" (config). */
import type { Config } from '../config.js';
import type { FastifyBaseLogger } from 'fastify';
import { WA_TEMPLATES, type WaTemplate } from '../services/notify.js';

export interface SendResult { providerMessageId?: string; skipped?: boolean }

export interface WhatsApp {
  sendTemplate(to: string, template: WaTemplate, params: string[], linkToken?: string): Promise<SendResult>;
}
export interface Mailer {
  send(to: string, subject: string, text: string, replyTo?: string): Promise<SendResult>;
}

/* An error that is worth retrying (network, 429, 5xx), or not (4xx: a bad
   number, a template not approved). The worker stops on the second kind. */
export class SendError extends Error {
  constructor(message: string, public retry: boolean) { super(message); }
}

export function whatsapp(cfg: Config, log: FastifyBaseLogger): WhatsApp {
  if (cfg.WHATSAPP_DRIVER === 'off') return { async sendTemplate() { return { skipped: true }; } };
  if (cfg.WHATSAPP_DRIVER === 'log') {
    return {
      async sendTemplate(to, template, params, linkToken) {
        // In local development the link is printed, so the payment page can be opened from the log.
        const link = linkToken ? (cfg.DEPLOY_ENV === 'development' ? new URL('/payment/#t=' + linkToken, cfg.PUBLIC_ORIGIN).toString() : 'yes') : 'no';
        log.info({ to: to.slice(0, 5) + '…', template: WA_TEMPLATES[template], params, link }, 'whatsapp (log driver)');
        return { providerMessageId: 'log-' + Date.now() };
      }
    };
  }
  const url = 'https://graph.facebook.com/' + cfg.WA_GRAPH_VERSION + '/' + cfg.WA_PHONE_NUMBER_ID + '/messages';
  return {
    async sendTemplate(to, template, params, linkToken) {
      const components: unknown[] = [];
      if (params.length) components.push({ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) });
      // The approved template's URL button is https://dr-rayhab.com/payment/#t={{1}};
      // the token is its dynamic suffix.
      if (linkToken) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: linkToken }] });
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + cfg.WA_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'template',
            template: { name: WA_TEMPLATES[template], language: { code: cfg.WA_LANG }, components }
          }),
          signal: AbortSignal.timeout(15000)
        });
      } catch (e) {
        throw new SendError('WhatsApp unreachable: ' + (e as Error).message, true);
      }
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = 'WhatsApp ' + res.status + ': ' + (json.error?.message || 'error');
        throw new SendError(msg, res.status === 429 || res.status >= 500);
      }
      return { providerMessageId: json.messages?.[0]?.id };
    }
  };
}

export async function mailer(cfg: Config, log: FastifyBaseLogger): Promise<Mailer> {
  if (cfg.EMAIL_DRIVER === 'off') return { async send() { return { skipped: true }; } };
  if (cfg.EMAIL_DRIVER === 'log') {
    return { async send(to, subject) { log.info({ to, subject }, 'email (log driver)'); return { providerMessageId: 'log-' + Date.now() }; } };
  }
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport(cfg.SMTP_URL);
  return {
    async send(to, subject, text, replyTo) {
      try {
        const info = await transport.sendMail({ from: cfg.EMAIL_FROM, to, subject, text, replyTo });
        return { providerMessageId: info.messageId };
      } catch (e: any) {
        const code = Number(e?.responseCode || 0);
        // SMTP: 4xx is temporary, 5xx is permanent; no code means it never connected.
        throw new SendError('Email failed: ' + e.message, code === 0 || (code >= 400 && code < 500));
      }
    }
  };
}
