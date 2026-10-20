<?php
/* Appointments and payments, shaped exactly as the admin and the payment
   page expect them (README.md, "API contracts"), with the actions the
   server allows on each record; and the event history. */
declare(strict_types=1);

namespace Rayhab;

final class Records
{
    private const ACTIONS = [
        'requested' => ['approve', 'decline', 'reschedule'],
        'approved' => ['reschedule', 'cancel'],
        'confirmed' => ['reschedule', 'cancel', 'complete', 'no_show'],
        'reschedule_requested' => ['cancel'],
    ];

    public const SELECT = "
      select a.id, a.reference, a.status, a.mode, a.for_whom, a.starts_at, a.ends_at, a.local_date, a.local_time,
             a.note, a.hold_expires_at, a.financial_closed_at, a.created_at, a.updated_at,
             a.consent_whatsapp_at, a.patient_id,
             s.id as service_id, s.name as service_name, s.duration_min,
             p.id as practitioner_id, p.name as practitioner_name,
             pt.first_name, pt.last_name, pt.phone_e164, pt.email,
             pi.id as pay_id, pi.method as pay_method, pi.status as pay_status, pi.amount as pay_amount,
             pi.currency as pay_currency, pi.outstanding as pay_outstanding, pi.updated_at as pay_updated_at
        from rayhab.appointments a
        join rayhab.services s on s.id = a.service_id
        join rayhab.practitioners p on p.id = a.practitioner_id
        join rayhab.patients pt on pt.id = a.patient_id
        join rayhab.payment_intents pi on pi.appointment_id = a.id";

    public function __construct(private Db $db) {}

    /** @return array<string,list<array<string,mixed>>> */
    private function transactions(array $intentIds): array
    {
        $out = [];
        if (!$intentIds) return $out;
        $rows = $this->db->query('select t.id, t.intent_id, t.provider, t.status, t.amount, t.currency, t.reference, t.updated_at,
                                         p.name as recorded_by_name
                                    from rayhab.payment_transactions t left join rayhab.practitioners p on p.id = t.recorded_by
                                   where t.intent_id = any(?::text[]) order by t.created_at', [Db::arrayLiteral($intentIds)]);
        foreach ($rows as $r) $out[$r['intent_id']][] = $r;
        return $out;
    }

    private function payment(array $row, array $txs, ?string $role): array
    {
        $verified = array_values(array_filter($txs, static fn($t) => $t['status'] === 'verified'));
        $lastVerified = $verified ? end($verified) : null;
        $whish = array_values(array_filter($txs, static fn($t) => $t['provider'] === 'whish'));
        $lastWhish = $whish ? end($whish) : null;
        $cash = array_values(array_filter($verified, static fn($t) => $t['provider'] === 'cash'));
        $lastCash = $cash ? end($cash) : null;
        $live = in_array($row['status'], ['approved', 'confirmed', 'completed'], true);
        $canCash = $role !== null && Guard::permissions($role)['confirm_cash'] && $row['pay_method'] === 'cash'
                   && $row['pay_status'] === 'awaiting_payment' && $live;
        return [
            'id' => $row['pay_id'],
            'method' => $row['pay_method'],
            'status' => $row['pay_status'],
            'amount' => (int) $row['pay_amount'],
            'currency' => $row['pay_currency'],
            'outstanding' => (int) $row['pay_outstanding'],
            'last_attempt' => $lastWhish ? ['status' => $lastWhish['status'] === 'verified' ? 'succeeded' : $lastWhish['status'], 'at' => Util::iso($lastWhish['updated_at'])] : null,
            'verified_by' => $row['pay_status'] === 'paid' && $lastVerified ? ($lastVerified['provider'] === 'whish' ? 'whish' : 'cash_receipt') : null,
            'receipt_reference' => $lastVerified['reference'] ?? null,
            'recorded_by' => $lastCash && $lastCash['recorded_by_name'] ? ['name' => $lastCash['recorded_by_name']] : null,
            'transactions' => array_map(static fn($t) => ['id' => $t['id'], 'provider' => $t['provider'], 'status' => $t['status'],
                'amount' => (int) $t['amount'], 'currency' => $t['currency'], 'reference' => $t['reference'], 'at' => Util::iso($t['updated_at'])], $txs),
            'updated_at' => Util::iso($row['pay_updated_at']),
            'actions' => $canCash ? ['confirm_cash'] : [],
        ];
    }

    public function appointment(array $row, array $txs, ?string $role): array
    {
        return [
            'id' => $row['id'],
            'reference' => $row['reference'],
            'status' => $row['status'],
            'service' => ['id' => $row['service_id'], 'name' => $row['service_name'], 'duration_min' => (int) $row['duration_min']],
            'practitioner' => ['id' => $row['practitioner_id'], 'name' => $row['practitioner_name']],
            'mode' => $row['mode'],
            'for_whom' => $row['for_whom'],
            'start' => Util::iso($row['starts_at']),
            'end' => Util::iso($row['ends_at']),
            'local_date' => $row['local_date'],
            'local_time' => $row['local_time'],
            'timezone' => Time::TZ,
            'patient' => ['name' => trim($row['first_name'] . ' ' . $row['last_name']), 'phone' => $row['phone_e164'], 'email' => $row['email'] ?: null],
            // The patient's own view (no role) and practitioners see the note; reception does not.
            'note' => $role === null || Guard::permissions($role)['read_notes'] ? (string) $row['note'] : null,
            'hold_expires_at' => Util::iso($row['hold_expires_at']),
            'payment' => $this->payment($row, $txs, $role),
            'financial_closed_at' => Util::iso($row['financial_closed_at']),
            'created_at' => Util::iso($row['created_at']),
            'updated_at' => Util::iso($row['updated_at']),
            'actions' => $role !== null ? (self::ACTIONS[$row['status']] ?? []) : [],
        ];
    }

    /** @return list<array<string,mixed>> */
    public function shape(array $rows, ?string $role): array
    {
        $txs = $this->transactions(array_column($rows, 'pay_id'));
        return array_map(fn($r) => $this->appointment($r, $txs[$r['pay_id']] ?? [], $role), $rows);
    }

    public function load(string $id, ?string $role): ?array
    {
        $row = $this->db->one(self::SELECT . ' where a.id = ?', [$id]);
        return $row ? $this->shape([$row], $role)[0] : null;
    }

    public static function paymentRow(array $a): array
    {
        return $a['payment'] + [
            'appointment' => ['id' => $a['id'], 'reference' => $a['reference'], 'status' => $a['status'], 'service_name' => $a['service']['name'],
                              'local_date' => $a['local_date'], 'local_time' => $a['local_time'], 'patient_name' => $a['patient']['name']],
            'financial_closed_at' => $a['financial_closed_at'],
        ];
    }

    /** @param array{kind:string,id?:?string,name?:string} $actor */
    public static function log(Db $db, string $type, ?string $appointmentId, array $actor, string $summary = '',
                               ?string $old = null, ?string $new = null, ?string $requestId = null): void
    {
        $db->query('insert into rayhab.events (type, appointment_id, actor_kind, actor_id, actor_name, summary, old_status, new_status, request_id)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                   [$type, $appointmentId, $actor['kind'], $actor['id'] ?? null, $actor['name'] ?? '', $summary, $old, $new, $requestId]);
    }

    public static function eventView(array $e): array
    {
        return ['id' => 'ev_' . $e['id'], 'at' => Util::iso($e['at']), 'type' => $e['type'],
                'actor' => ['kind' => $e['actor_kind'], 'name' => $e['actor_name'] ?: ($e['actor_kind'] === 'system' ? 'System' : '')],
                'appointment_id' => $e['appointment_id'], 'reference' => $e['reference'] ?? null, 'summary' => $e['summary']];
    }
}
