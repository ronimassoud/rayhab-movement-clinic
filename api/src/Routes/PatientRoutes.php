<?php
/* The patient's secure link (README.md, "API contracts: payment choice").

     GET  /api/payment-selection/{token}              what the page shows
     POST /api/payment-selection/{token}              { method: "whish" | "cash" }
     POST /api/payment-selection/{token}/reschedule   { accept: true | false }
     POST /api/payments/whish/create                  { token } -> { checkout_url }
     POST /api/webhooks/whish                         Whish's authenticated callback
     GET|POST /api/payments/whish/sandbox/{ref}       the stand-in checkout (sandbox only) */
declare(strict_types=1);

namespace Rayhab\Routes;

use Rayhab\ApiError;
use Rayhab\App;
use Rayhab\Db;
use Rayhab\Records;
use Rayhab\Request;
use Rayhab\Response;
use Rayhab\Time;
use Rayhab\Util;

final class PatientRoutes
{
    public static function view(App $app, array $a): array
    {
        $p = $a['payment'];
        $live = in_array($a['status'], ['approved', 'confirmed'], true);
        $finalized = in_array($p['status'], ['paid', 'refunded'], true);
        $methods = $app->whish->name === 'disabled' ? ['cash'] : ['whish', 'cash'];
        $pendingWhish = ($p['last_attempt']['status'] ?? null) === 'pending';
        $hours = $app->cfg->int('PAYMENT_DEADLINE_HOURS');
        $deadline = $hours > 0 ? strtotime((string) $a['start']) - $hours * 3600 : null;
        return [
            'appointment' => [
                'reference' => $a['reference'], 'status' => $a['status'],
                'service' => ['name' => $a['service']['name'], 'duration_min' => $a['service']['duration_min']],
                'practitioner' => ['name' => $a['practitioner']['name']],
                'mode' => $a['mode'], 'local_date' => $a['local_date'], 'local_time' => $a['local_time'], 'timezone' => Time::TZ,
                'location' => $a['mode'] === 'online' ? 'Online, video call' : $app->cfg->get('CLINIC_LOCATION'),
            ],
            'payment' => ['method' => $p['method'], 'status' => $p['status'], 'amount' => $p['amount'], 'currency' => $p['currency'],
                          'outstanding' => $p['outstanding'], 'last_attempt' => $p['last_attempt'],
                          'receipt_reference' => $p['status'] === 'paid' ? $p['receipt_reference'] : null],
            'allowed_methods' => $live && !$finalized ? $methods : [],
            'can_change_method' => $live && !$finalized && $p['status'] === 'awaiting_payment' && !$pendingWhish,
            'can_retry' => $live && $p['method'] === 'whish' && $p['status'] === 'awaiting_payment' && $p['last_attempt'] !== null
                           && $p['last_attempt']['status'] !== 'pending' && $app->whish->name !== 'disabled',
            'policy' => ['cash' => $app->cfg->get('POLICY_CASH_TEXT'), 'whish' => $app->cfg->get('POLICY_WHISH_TEXT'),
                         'deadline' => $deadline && $deadline > time() ? Util::iso('@' . $deadline) : null],
            'clinic' => ['name' => $app->cfg->get('CLINIC_NAME'), 'phone' => $app->cfg->get('CLINIC_PHONE')],
        ];
    }

    private static function current(App $app, string $apptId): array
    {
        $a = $app->records->load($apptId, null);
        if (!$a) throw new ApiError(404, 'link_invalid', 'This link is not recognized.');
        return self::view($app, $a);
    }

    public static function register(App $app): void
    {
        $app->get('/api/payment-selection/{token}', function (Request $r, array $p) use ($app) {
            $app->guard->limit('link-ip:' . $r->ip, 60, 60);
            $apptId = $app->links->resolve($p['token']);
            // While the page waits on Whish, ask Whish about this one payment
            // rather than waiting for the minute-by-minute worker.
            $pending = $app->db->one("select t.external_ref from rayhab.payment_transactions t join rayhab.payment_intents pi on pi.id = t.intent_id
                                       where pi.appointment_id = ? and t.provider = 'whish' and t.status = 'pending'
                                         and t.updated_at < now() - interval '3 seconds' order by t.created_at desc limit 1", [$apptId]);
            if ($pending) $app->payments->settleWhish($pending['external_ref'], $app->whish->fetchStatus($pending['external_ref']));
            return Response::json(self::current($app, $apptId));
        });

        $app->post('/api/payment-selection/{token}', function (Request $r, array $p) use ($app) {
            $app->guard->origin($r);
            $app->guard->limit('link-ip:' . $r->ip, 60, 60);
            $apptId = $app->links->resolve($p['token']);
            $method = (string) ($r->json()['method'] ?? '');
            if (!in_array($method, ['whish', 'cash'], true)) throw ApiError::validation(['method' => 'Choose Whish or cash.']);
            return $app->guard->idempotent($r, 'select:' . Util::sha256($p['token']), function () use ($app, $apptId, $method) {
                $app->db->tx(function (Db $t) use ($app, $apptId, $method) {
                    $row = $t->one('select a.status, pi.id, pi.method, pi.status as pay_status from rayhab.appointments a
                                      join rayhab.payment_intents pi on pi.appointment_id = a.id where a.id = ? for update', [$apptId]);
                    if (!$row || !in_array($row['status'], ['approved', 'confirmed'], true)) throw ApiError::conflict('appointment_closed', 'This appointment is no longer active.');
                    if (in_array($row['pay_status'], ['paid', 'refunded'], true)) throw ApiError::conflict('method_finalized', 'This appointment is already paid.');
                    $v = self::view($app, $app->records->load($apptId, null));
                    if (!in_array($method, $v['allowed_methods'], true)) throw ApiError::conflict('method_finalized', 'This payment method is not available.');
                    if ($row['method'] && $row['method'] !== $method && !$v['can_change_method']) throw ApiError::conflict('method_finalized', 'The payment method can no longer be changed.');
                    if ($row['method'] !== $method) {
                        $t->query("update rayhab.payment_intents set method = ?, status = 'awaiting_payment', updated_at = now() where id = ?", [$method, $row['id']]);
                        Records::log($t, 'payment_selected', $apptId, ['kind' => 'patient', 'name' => 'Patient'], 'Chose ' . ($method === 'cash' ? 'cash at the clinic' : 'Whish'));
                    }
                    // Choosing how to pay confirms an approved appointment. It does not pay it.
                    if ($row['status'] === 'approved') {
                        $t->query("update rayhab.appointments set status = 'confirmed', updated_at = now() where id = ?", [$apptId]);
                        Records::log($t, 'confirmed', $apptId, ['kind' => 'patient', 'name' => 'Patient'], 'Confirmed by choosing a payment method', 'approved', 'confirmed');
                    }
                });
                return Response::json(self::current($app, $apptId));
            });
        });

        $app->post('/api/payment-selection/{token}/reschedule', function (Request $r, array $p) use ($app) {
            $app->guard->origin($r);
            $apptId = $app->links->resolve($p['token']);
            $accept = $r->json()['accept'] ?? null;
            if (!is_bool($accept)) throw ApiError::validation(['accept' => 'Answer yes or no.']);
            return $app->guard->idempotent($r, 'reschedule:' . Util::sha256($p['token']), function () use ($app, $apptId, $accept) {
                $app->db->tx(function (Db $t) use ($app, $apptId, $accept) {
                    $row = $t->one('select a.status, a.local_date, a.local_time, a.reference, pi.method from rayhab.appointments a
                                      join rayhab.payment_intents pi on pi.appointment_id = a.id where a.id = ? for update', [$apptId]);
                    if (!$row || $row['status'] !== 'reschedule_requested') throw ApiError::conflict('appointment_closed', 'There is no new time waiting for an answer.');
                    if ($accept) {
                        $next = $row['method'] ? 'confirmed' : 'approved';
                        $t->query('update rayhab.appointments set status = ?, hold_expires_at = null, updated_at = now() where id = ?', [$next, $apptId]);
                        Records::log($t, 'reschedule_accepted', $apptId, ['kind' => 'patient', 'name' => 'Patient'],
                                     'Accepted ' . Time::dayLabel($row['local_date']) . ' ' . $row['local_time'], $row['status'], $next);
                    } else {
                        $t->query("update rayhab.appointments set status = 'requested', hold_expires_at = now() + make_interval(hours => ?), updated_at = now() where id = ?",
                                  [$app->cfg->int('HOLD_HOURS'), $apptId]);
                        Records::log($t, 'reschedule_rejected', $apptId, ['kind' => 'patient', 'name' => 'Patient'], 'Asked for another time', $row['status'], 'requested');
                        $app->notify->staff('reschedule_rejected', $row['reference'] . ': the patient asked for another time',
                            'The patient did not accept the new time proposed for ' . $row['reference'] . " and asked for another one.\n\nReview it: "
                            . $app->notify->adminUrl('#/requests') . "\n", $apptId);
                    }
                });
                return Response::json(self::current($app, $apptId));
            });
        });

        $app->post('/api/payments/whish/create', function (Request $r) use ($app) {
            $app->guard->origin($r);
            $tok = (string) ($r->json()['token'] ?? '');
            $apptId = $app->links->resolve($tok);
            return $app->guard->idempotent($r, 'whish:' . Util::sha256($tok), function () use ($app, $r, $tok, $apptId) {
                $a = $app->records->load($apptId, null);
                if (!$a || !in_array($a['status'], ['approved', 'confirmed'], true)) throw ApiError::conflict('appointment_closed', 'This appointment is no longer active.');
                if ($a['payment']['status'] === 'paid') throw ApiError::conflict('already_paid', 'This appointment is already paid.');
                if ($a['payment']['method'] !== 'whish') throw ApiError::conflict('method_mismatch', 'Choose Whish first.');
                // A checkout still open from a moment ago is reused, never doubled.
                $open = $app->db->one("select checkout_url, extract(epoch from created_at)::bigint as at from rayhab.payment_transactions
                                        where intent_id = ? and provider = 'whish' and status = 'pending' and created_at > now() - interval '15 minutes'
                                        order by created_at desc limit 1", [$a['payment']['id']]);
                if ($open && $open['checkout_url']) {
                    return Response::json(['checkout_url' => $open['checkout_url'], 'expires_at' => Util::iso('@' . ((int) $open['at'] + 900))]);
                }
                $return = rtrim($app->cfg->get('PUBLIC_ORIGIN'), '/') . '/payment/#t=' . $tok . '&r=1';
                $co = $app->whish->createCheckout($a['payment']['id'], $a['payment']['outstanding'], $a['payment']['currency'],
                                                 $a['service']['name'] . ' ' . $a['reference'], $return, $r->header('idempotency-key') ?: Util::id('ik'));
                $app->db->tx(function (Db $t) use ($a, $co, $apptId) {
                    $t->query("insert into rayhab.payment_transactions (id, intent_id, provider, status, amount, currency, external_ref, checkout_url)
                               values (?, ?, 'whish', 'pending', ?, ?, ?, ?)",
                              [Util::id('tx'), $a['payment']['id'], $a['payment']['outstanding'], $a['payment']['currency'], $co['externalRef'], $co['checkoutUrl']]);
                    Records::log($t, 'checkout_started', $apptId, ['kind' => 'patient', 'name' => 'Patient'], 'Whish checkout started');
                });
                return Response::json(['checkout_url' => $co['checkoutUrl'], 'expires_at' => Util::iso('@' . $co['expiresAt'])]);
            });
        });

        /* Whish's callback, authenticated by the driver over the raw body. */
        $app->post('/api/webhooks/whish', function (Request $r) use ($app) {
            $parsed = $app->whish->parseWebhook($r->headers, $r->body);
            if (!$parsed) throw new ApiError(401, 'unauthenticated', 'Callback not authenticated.');
            $app->payments->settleWhish($parsed['externalRef'], $parsed['status']);
            return Response::json(['ok' => true]);
        });

        if ($app->whish->name !== 'sandbox') return;

        $pendingRef = fn(string $ref) => $app->db->one("select id from rayhab.payment_transactions where external_ref = ? and provider = 'whish' and status = 'pending'", [$ref]);
        $app->get('/api/payments/whish/sandbox/{ref}', function (Request $r, array $p) use ($pendingRef) {
            if (!$pendingRef($p['ref'])) return Response::html('<p>Unknown or finished sandbox payment.</p>', 404);
            $q = $r->query;
            $amount = ($q['currency'] ?? '') === 'USD' ? Util::money((int) ($q['amount'] ?? 0), 'USD') : ($q['currency'] ?? '') . ' ' . ($q['amount'] ?? '');
            $ret = htmlspecialchars((string) ($q['return'] ?? ''), ENT_QUOTES);
            $form = static fn(string $o, string $label) => '<form method="post"><input type="hidden" name="outcome" value="' . $o . '">'
                . '<input type="hidden" name="return" value="' . $ret . '"><button>' . $label . '</button></form>';
            return Response::html('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                . '<title>Whish sandbox</title><style>body{font:16px system-ui;max-width:420px;margin:40px auto;padding:0 16px}'
                . 'button{display:block;width:100%;margin:10px 0;padding:14px;font:inherit;border-radius:10px;border:1px solid #888;cursor:pointer}'
                . '.k{color:#6B4A07;font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:12px}</style>'
                . '<p class="k">Whish sandbox, not a real payment</p><h1>' . htmlspecialchars($amount) . '</h1>'
                . $form('verified', 'Pay (Whish confirms it)') . $form('failed', 'Payment fails') . $form('abandoned', 'Close without paying'));
        });
        $app->post('/api/payments/whish/sandbox/{ref}', function (Request $r, array $p) use ($app, $pendingRef) {
            $b = $r->json();
            $o = (string) ($b['outcome'] ?? '');
            if (!$pendingRef($p['ref']) || !in_array($o, ['verified', 'failed', 'abandoned'], true)) return Response::html('bad request', 400);
            $app->db->query("update rayhab.payment_transactions set raw = jsonb_build_object('sandbox_outcome', ?::text) where external_ref = ? and status = 'pending'", [$o, $p['ref']]);
            // Like Whish, send the patient back; the server learns the outcome by asking.
            $back = (string) ($b['return'] ?? '');
            return Response::redirect(str_starts_with($back, rtrim($app->cfg->get('PUBLIC_ORIGIN'), '/') . '/') ? $back : '/');
        });
    }
}
