<?php
/* Deletes personal data the clinic no longer needs, on the schedule set in
   app.env (0 keeps that kind forever). Run by the worker's hourly sweep.

     RETAIN_UNCONFIRMED_DAYS        requests that never became appointments:
                                    declined, expired, or cancelled before
                                    being confirmed or paid. The booking, its
                                    payment record and links, its messages,
                                    the patient's name in the audit log, and
                                    the patient record once nothing else uses it.
     RETAIN_ANSWERED_QUESTION_DAYS  website questions, counted from when they
                                    were marked answered. Open ones stay.
     RETAIN_MESSAGE_DAYS            the message history (recipient, text,
                                    delivery status), for any booking.

   Appointments that happened, and payments, are kept: how long they must be
   kept is for the clinic's legal adviser (docs/privacy-policy-draft.md).
   Each run that deletes anything leaves one audit entry with counts only. */
declare(strict_types=1);

namespace Rayhab;

final class Retention
{
    private const BATCH = 200;

    /* For appointment "a": never confirmed, never attended, never paid. Such
       a request can go entirely; anything else is a clinical or financial
       record whose retention the law sets. */
    public const NEVER_HAPPENED = "not exists (select 1 from rayhab.events e where e.appointment_id = a.id
                                                and e.new_status in ('confirmed', 'completed', 'no_show'))
                                   and not exists (select 1 from rayhab.payment_intents pi
                                                   join rayhab.payment_transactions tx on tx.intent_id = pi.id
                                                   where pi.appointment_id = a.id and tx.status = 'verified')";

    /** Removes requests completely: the booking, its payment record and links,
        its messages, the patient's name in the audit log, and the patient record
        once nothing else refers to it. @param list<array{id:string,patient_id:string}> $rows */
    public static function deleteRequests(Db $t, array $rows): void
    {
        if (!$rows) return;
        $ids = array_column($rows, 'id');
        $t->query("update rayhab.events set actor_name = '', actor_id = null
                   where appointment_id = any(?::text[]) and actor_kind = 'patient'", [$ids]);
        $t->query('delete from rayhab.notification_outbox where appointment_id = any(?::text[])', [$ids]);
        $t->query('delete from rayhab.appointments where id = any(?::text[])', [$ids]);   // payments and links cascade
        $t->query('delete from rayhab.patients p where p.id = any(?::uuid[])
                   and not exists (select 1 from rayhab.appointments a where a.patient_id = p.id)',
                  [array_values(array_unique(array_column($rows, 'patient_id')))]);
    }

    public function __construct(private Db $db, private Config $cfg) {}

    /** @return array{requests:int,questions:int,messages:int} */
    public function run(): array
    {
        $done = ['requests' => $this->unconfirmed(), 'questions' => $this->questions(), 'messages' => $this->messages()];
        if (array_sum($done) > 0) {
            Records::log($this->db, 'retention', null, ['kind' => 'system', 'name' => 'System'],
                sprintf('Deleted under the retention schedule: %d unconfirmed request(s), %d answered question(s), %d message record(s)',
                        $done['requests'], $done['questions'], $done['messages']));
        }
        return $done;
    }

    private function days(string $key): int { return max(0, $this->cfg->int($key)); }

    private function unconfirmed(): int
    {
        $days = $this->days('RETAIN_UNCONFIRMED_DAYS');
        if ($days === 0) return 0;
        $total = 0;
        do {
            $n = $this->db->tx(function (Db $t) use ($days): int {
                $rows = $t->query("select a.id, a.patient_id from rayhab.appointments a
                                   where a.updated_at < now() - make_interval(days => ?)
                                     and a.status in ('declined', 'expired', 'cancelled') and " . self::NEVER_HAPPENED . "
                                   order by a.updated_at limit ? for update of a skip locked", [$days, self::BATCH]);
                self::deleteRequests($t, $rows);
                return count($rows);
            });
            $total += $n;
        } while ($n === self::BATCH);
        return $total;
    }

    private function questions(): int
    {
        $days = $this->days('RETAIN_ANSWERED_QUESTION_DAYS');
        if ($days === 0) return 0;
        return count($this->db->query('delete from rayhab.enquiries where handled_at < now() - make_interval(days => ?) returning id', [$days]));
    }

    private function messages(): int
    {
        $days = $this->days('RETAIN_MESSAGE_DAYS');
        if ($days === 0) return 0;
        return count($this->db->query("delete from rayhab.notification_outbox
                                       where created_at < now() - make_interval(days => ?) and status not in ('pending', 'sending')
                                       returning id", [$days]));
    }
}
