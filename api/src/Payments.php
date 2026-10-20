<?php
/* Settling money. Only two things make a payment paid:
     - a Whish payment the driver reports verified (callback or status query),
     - cash recorded by a staff member with the permission to.
   Both lock the payment row, and both are idempotent: settling something
   already settled changes nothing. Paid is not completed: the clinical
   status is never touched here. */
declare(strict_types=1);

namespace Rayhab;

final class Payments
{
    public function __construct(private Db $db, private Config $cfg, private Notify $notify) {}

    public function afterCredit(string $intentId, int $credited): array
    {
        $pi = $this->db->one("update rayhab.payment_intents
                                 set outstanding = greatest(outstanding - ?, 0),
                                     status = case when outstanding - ? <= 0 then 'paid' else status end,
                                     updated_at = now()
                               where id = ? returning appointment_id, status, amount, currency", [$credited, $credited, $intentId]);
        if ($pi['status'] === 'paid') {
            $closed = $this->db->query('update rayhab.appointments set financial_closed_at = now(), updated_at = now()
                                         where id = ? and financial_closed_at is null returning id', [$pi['appointment_id']]);
            if ($closed) Records::log($this->db, 'financial_closed', $pi['appointment_id'], ['kind' => 'system', 'name' => 'System'], 'Financial case closed');
            $m = $this->notify->row($pi['appointment_id']);
            if ($m) $this->notify->whatsapp($m, 'payment_received', [Util::money((int) $pi['amount'], $pi['currency']),
                                                                     Time::dayLabel($m['local_date'], true)], null, 'paid:' . $pi['appointment_id']);
        }
        return $pi;
    }

    public function settleWhish(string $externalRef, string $status): bool
    {
        if ($status === 'pending') return false;
        return $this->db->tx(function (Db $t) use ($externalRef, $status) {
            $tx = $t->one("select id, intent_id, status, amount, currency from rayhab.payment_transactions
                            where external_ref = ? and provider = 'whish' for update", [$externalRef]);
            if (!$tx || $tx['status'] !== 'pending') return false;             // unknown, or already settled
            $t->query('select id from rayhab.payment_intents where id = ? for update', [$tx['intent_id']]);
            $t->query("update rayhab.payment_transactions set status = ?, reference = case when ? = 'verified' then external_ref else reference end,
                              updated_at = now() where id = ?", [$status, $status, $tx['id']]);
            $appt = $t->one('select appointment_id from rayhab.payment_intents where id = ?', [$tx['intent_id']])['appointment_id'];
            if ($status === 'verified') {
                Records::log($t, 'payment_verified', $appt, ['kind' => 'system', 'name' => 'System'], 'Verified with Whish, ' . Util::money((int) $tx['amount'], $tx['currency']));
                $this->afterCredit($tx['intent_id'], (int) $tx['amount']);
            } else {
                Records::log($t, $status === 'failed' ? 'payment_failed' : 'checkout_abandoned', $appt, ['kind' => 'system', 'name' => 'System'],
                             $status === 'failed' ? 'Whish reported the payment failed' : 'Whish checkout closed without paying');
            }
            return true;
        });
    }
}
