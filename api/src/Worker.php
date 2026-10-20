<?php
/* Background jobs. Run every minute by cron (bin/worker.php), and right
   after a response for the messages a request just queued. Each job is safe
   to run twice and on two processes at once: rows are claimed with
   FOR UPDATE SKIP LOCKED, or updated with conditions only one run can meet.

     deliver      send due outbox messages; retry with backoff; give up after 8
     expireHolds  requests nobody answered in time, and unanswered new times
     reconcile    ask Whish about payments still pending after a minute
     remind       WhatsApp reminder about 24 hours before a confirmed visit
     sweep        remove expired sessions, sign-in steps, keys and counters */
declare(strict_types=1);

namespace Rayhab;

final class Worker
{
    private const MAX_ATTEMPTS = 8;

    public function __construct(private App $app, private Messaging $send) {}

    public function deliver(int $batch = 20): int
    {
        $db = $this->app->db;
        $rows = $db->tx(fn(Db $t) => $t->query("update rayhab.notification_outbox set status = 'sending', attempts = attempts + 1
             where id in (select id from rayhab.notification_outbox where status in ('pending', 'failed') and next_attempt_at <= now()
                          order by id limit ? for update skip locked)
             returning id, channel, template, recipient, payload, attempts", [$batch]));
        foreach ($rows as $r) {
            $payload = json_decode((string) $r['payload'], true) ?: [];
            try {
                if ($r['channel'] === 'whatsapp') {
                    $link = isset($payload['link_sealed']) ? Util::unseal($this->app->cfg->get('APP_SECRET'), $payload['link_sealed']) : null;
                    $res = $this->send->whatsapp($r['recipient'], $r['template'], $payload['params'] ?? [], $link);
                } else {
                    $res = $this->send->email($r['recipient'], (string) ($payload['subject'] ?? ''), (string) ($payload['text'] ?? ''), $payload['reply_to'] ?? null);
                }
                unset($payload['link_sealed']);          // sent: the sealed link is no longer needed
                $db->query("update rayhab.notification_outbox set status = ?, sent_at = now(), provider_message_id = ?, payload = ?::jsonb, last_error = null where id = ?",
                           [$res['skipped'] ? 'skipped' : 'sent', $res['id'], json_encode($payload ?: new \stdClass(), JSON_UNESCAPED_UNICODE), $r['id']]);
            } catch (\Throwable $e) {
                $retry = !($e instanceof SendError) || $e->retry;
                $dead = !$retry || (int) $r['attempts'] >= self::MAX_ATTEMPTS;
                $wait = min(60 * 2 ** ((int) $r['attempts'] - 1), 6 * 3600);   // 1 min, 2, 4 … capped at 6 h
                $db->query('update rayhab.notification_outbox set status = ?, last_error = ?, next_attempt_at = now() + make_interval(secs => ?) where id = ?',
                           [$dead ? 'dead' : 'failed', mb_substr(App::redact($e->getMessage()), 0, 500), $wait, $r['id']]);
                error_log('[rayhab] message ' . $r['id'] . ' (' . $r['template'] . ') ' . ($dead ? 'given up: ' : 'will be retried: ') . App::redact($e->getMessage()));
            }
        }
        return count($rows);
    }

    public function expireHolds(): int
    {
        return $this->app->db->tx(function (Db $t) {
            $gone = $t->query("update rayhab.appointments a set status = 'expired', updated_at = now()
                                 from (select id, status from rayhab.appointments
                                        where status in ('requested', 'reschedule_requested') and hold_expires_at < now() for update skip locked) old
                                where a.id = old.id returning a.id, old.status");
            foreach ($gone as $g) {
                $this->app->links->revoke($g['id']);
                Records::log($t, 'expired', $g['id'], ['kind' => 'system', 'name' => 'System'],
                             $g['status'] === 'requested' ? 'Not answered in time; the time was released' : 'The new time was not accepted in time', $g['status'], 'expired');
            }
            return count($gone);
        });
    }

    public function reconcile(): int
    {
        if ($this->app->whish->name === 'disabled') return 0;
        $n = 0;
        $pending = $this->app->db->query("select external_ref, extract(epoch from created_at)::bigint as at from rayhab.payment_transactions
                                           where provider = 'whish' and status = 'pending' and external_ref is not null
                                             and updated_at < now() - interval '1 minute' order by created_at limit 20");
        foreach ($pending as $p) {
            $status = $this->app->whish->fetchStatus($p['external_ref']);
            // A checkout nobody finished in two hours is treated as left unpaid.
            if ($status === 'pending' && time() - (int) $p['at'] > 7200) $status = 'abandoned';
            if ($this->app->payments->settleWhish($p['external_ref'], $status)) $n++;
        }
        return $n;
    }

    public function remind(): int
    {
        $due = $this->app->db->query("select a.id, a.local_date, a.local_time, a.mode, a.consent_whatsapp_at, s.name as service_name, p.phone_e164
                                        from rayhab.appointments a join rayhab.services s on s.id = a.service_id join rayhab.patients p on p.id = a.patient_id
                                       where a.status = 'confirmed' and a.reminded_at is null
                                         and a.starts_at between now() + interval '20 hours' and now() + interval '28 hours'");
        foreach ($due as $a) {
            $this->app->db->tx(function (Db $t) use ($a) {
                $this->app->notify->whatsapp($a, 'reminder', [$a['service_name'], Time::dayLabel($a['local_date'], true), $a['local_time'],
                    $a['mode'] === 'online' ? 'Online, video call' : $this->app->cfg->get('CLINIC_LOCATION')], null, 'reminder:' . $a['id']);
                $t->query('update rayhab.appointments set reminded_at = now() where id = ?', [$a['id']]);
            });
        }
        return count($due);
    }

    public function sweep(): void
    {
        $db = $this->app->db;
        $db->query('delete from rayhab.staff_sessions where expires_at < now()');
        $db->query('delete from rayhab.auth_pending where expires_at < now()');
        $db->query("delete from rayhab.idempotency_keys where created_at < now() - interval '2 days'");
        $db->query("delete from rayhab.rate_limits where window_start < now() - interval '1 day'");
    }

    /** The cron run: everything once, then a heartbeat (only if all of it worked). */
    public function tick(): array
    {
        $r = ['delivered' => $this->deliver(50), 'reconciled' => $this->reconcile(), 'expired' => $this->expireHolds(),
              'reminded' => $this->remind(), 'swept' => (int) (gmdate('i') === '07' && $this->sweepOnce())];
        $this->app->db->query("insert into rayhab.heartbeats (name, at) values ('worker', now())
                               on conflict (name) do update set at = excluded.at");
        return $r;
    }

    private function sweepOnce(): bool { $this->sweep(); return true; }
}
