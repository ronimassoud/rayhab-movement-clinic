<?php
/* Whish Money, behind one interface.

   A payment is paid only when this reports it verified: from an
   authenticated callback, or from the provider's own status query. Never
   because the browser came back from checkout.

   Drivers (WHISH_DRIVER):
     disabled  no online payments; choosing Whish answers 503 and the page
               offers cash. The default.
     sandbox   a stand-in hosted checkout served by this API, for development
               and staging. Refused in production by Config.
     whish     the real merchant integration. NOT WRITTEN YET: Whish's merchant
               API is not public, so its endpoints, signatures and statuses
               must come from the official documentation and sandbox
               credentials (runbook, "Whish"). Until then it fails closed. */
declare(strict_types=1);

namespace Rayhab;

final class Whish
{
    public readonly string $name;

    public function __construct(private Config $cfg, private Db $db)
    {
        $this->name = $cfg->get('WHISH_DRIVER');
    }

    /** @return array{checkoutUrl:string,externalRef:string,expiresAt:int} */
    public function createCheckout(string $intentId, int $amount, string $currency, string $description, string $returnUrl, string $idempotencyKey): array
    {
        if ($this->name === 'sandbox') {
            $ref = Util::id('wsb');
            $q = http_build_query(['return' => $returnUrl, 'amount' => $amount, 'currency' => $currency]);
            return ['checkoutUrl' => rtrim($this->cfg->get('PUBLIC_ORIGIN'), '/') . '/api/payments/whish/sandbox/' . $ref . '?' . $q,
                    'externalRef' => $ref, 'expiresAt' => time() + 900];
        }
        // To implement for "whish", from Whish's merchant documentation: create a
        // payment or hosted checkout for $amount in $currency with $intentId as
        // the merchant reference and $returnUrl as the browser return, sending
        // $idempotencyKey if Whish supports one; return Whish's URL and reference.
        throw new ApiError(503, 'whish_unavailable', $this->name === 'whish' ? 'Online payment is not set up yet.' : 'Whish is not available right now.');
    }

    /* The provider's view of one payment: pending, verified, failed or abandoned. */
    public function fetchStatus(string $externalRef): string
    {
        if ($this->name === 'sandbox') {
            $o = $this->db->one("select raw->>'sandbox_outcome' as o from rayhab.payment_transactions where external_ref = ?", [$externalRef])['o'] ?? null;
            return in_array($o, ['verified', 'failed', 'abandoned'], true) ? $o : 'pending';
        }
        // "whish": query the payment by reference and map Whish's statuses.
        return 'pending';
    }

    /**
     * A callback, verified and parsed, or null when it is not authentic.
     * @param array<string,string> $headers
     * @return array{externalRef:string,status:string,eventId:string}|null
     */
    public function parseWebhook(array $headers, string $raw): ?array
    {
        if ($this->name === 'sandbox') {
            // Signed with APP_SECRET, so the sandbox exercises the same check a real callback gets.
            $sig = $headers['x-sandbox-signature'] ?? '';
            if ($sig === '' || !hash_equals(Util::hmac($this->cfg->get('APP_SECRET'), $raw), $sig)) return null;
            $b = json_decode($raw, true);
            return is_array($b) ? ['externalRef' => (string) $b['ref'], 'status' => (string) $b['status'], 'eventId' => (string) ($b['event_id'] ?? '')] : null;
        }
        // "whish": verify Whish's signature on the raw body, reject replays, map the status.
        return null;
    }
}
