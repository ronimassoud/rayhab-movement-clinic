/* Whish Money, behind one interface.

   The API never decides that a Whish payment succeeded on the browser's
   word. A payment is paid only when a driver reports it verified: from an
   authenticated callback (webhook), or from the provider's own status query
   run by the worker's reconciliation.

   Drivers:
     disabled  no online payments. Choosing Whish answers 503 whish_unavailable,
               and the page offers cash instead. The default.
     sandbox   a stand-in hosted checkout served by this API, for development
               and the staging backend. Refused in production by config.
     whish     the real merchant integration. NOT WRITTEN YET: Whish's merchant
               API is not public, and its endpoints, signatures and status
               values must come from the official documentation and sandbox
               credentials (runbook, "Whish"). Until then it fails closed. */
import type { Config } from '../config.js';
import { ApiError } from '../lib/errors.js';
import { hmac, id, safeEqual } from '../lib/util.js';
import type { Db } from '../db/db.js';

export type WhishStatus = 'pending' | 'verified' | 'failed' | 'abandoned';

export interface Checkout { checkoutUrl: string; externalRef: string; expiresAt: Date }

export interface WhishDriver {
  name: string;
  createCheckout(o: { intentId: string; amount: number; currency: string; description: string; returnUrl: string; idempotencyKey: string }): Promise<Checkout>;
  /* The provider's view of one payment, for reconciliation. */
  fetchStatus(externalRef: string): Promise<WhishStatus>;
  /* An incoming callback: verified and parsed, or null when it is not authentic. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): Promise<{ externalRef: string; status: WhishStatus; eventId: string } | null>;
}

const unavailable = () => new ApiError(503, 'whish_unavailable', 'Whish is not available right now.');

export const disabledWhish: WhishDriver = {
  name: 'disabled',
  async createCheckout() { throw unavailable(); },
  async fetchStatus() { return 'pending'; },
  async parseWebhook() { return null; }
};

/* The sandbox records the tester's choice on the payment row itself (raw.sandbox_outcome),
   so the API that shows the stand-in checkout and the worker that later
   reconciles it can be separate processes, as in production. */
export function sandboxWhish(cfg: Config, db: Db): WhishDriver {
  return {
    name: 'sandbox',
    async createCheckout(o) {
      const ref = id('wsb');
      const url = new URL('/api/payments/whish/sandbox/' + ref, cfg.PUBLIC_ORIGIN);
      url.searchParams.set('return', o.returnUrl);
      url.searchParams.set('amount', String(o.amount));
      url.searchParams.set('currency', o.currency);
      return { checkoutUrl: url.toString(), externalRef: ref, expiresAt: new Date(Date.now() + 15 * 60000) };
    },
    async fetchStatus(ref) {
      const row = await db.one<{ o: string | null }>(
        `select raw->>'sandbox_outcome' as o from rayhab.payment_transactions where external_ref = $1`, [ref]);
      const o = row && row.o;
      return o === 'verified' || o === 'failed' || o === 'abandoned' ? o : 'pending';
    },
    async parseWebhook(headers, raw) {
      // Signed with APP_SECRET, so the sandbox exercises the same check a real callback gets.
      const sig = String(headers['x-sandbox-signature'] || '');
      if (!sig || !safeEqual(sig, hmac(cfg.APP_SECRET, raw))) return null;
      const b = JSON.parse(raw);
      return { externalRef: b.ref, status: b.status, eventId: b.event_id };
    }
  };
}

export function realWhish(_cfg: Config): WhishDriver {
  const notYet = () => new ApiError(503, 'whish_unavailable', 'Online payment is not set up yet.');
  return {
    name: 'whish',
    // To implement from Whish's merchant documentation:
    //  - createCheckout: create a payment / hosted checkout for `amount` in
    //    `currency`, with our intent id as the merchant reference and
    //    `returnUrl` as the browser return; return Whish's URL and reference.
    //  - fetchStatus: query the payment by reference; map Whish's statuses
    //    onto pending / verified / failed / abandoned.
    //  - parseWebhook: verify Whish's signature or authentication on the raw
    //    body, reject replays (event id, timestamp), map the status.
    async createCheckout() { throw notYet(); },
    async fetchStatus() { return 'pending'; },
    async parseWebhook() { return null; }
  };
}

export function whishDriver(cfg: Config, db: Db): WhishDriver {
  if (cfg.WHISH_DRIVER === 'sandbox') return sandboxWhish(cfg, db);
  if (cfg.WHISH_DRIVER === 'whish') return realWhish(cfg);
  return disabledWhish;
}
