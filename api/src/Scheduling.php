<?php
/* Which times can be requested.

   Each practitioner's working hours for the weekday, minus their blocked
   times, minus every live appointment. A slot is a start time on the
   service's own grid. The database's exclusion constraint stays the final
   word: if two requests race for one slot, one is refused there. */
declare(strict_types=1);

namespace Rayhab;

final class Scheduling
{
    public const LIVE = ['requested', 'approved', 'confirmed', 'reschedule_requested'];

    public function __construct(private Db $db, private Config $cfg) {}

    /** @return list<array<string,mixed>> */
    public function services(): array
    {
        $rows = $this->db->query("
            select s.id, s.name, s.description, s.tag, s.duration_min, s.buffer_min, s.price_amount, s.currency,
                   array_to_json(s.modes) as modes,
                   coalesce(json_agg(sp.practitioner_id order by sp.practitioner_id) filter (where p.id is not null), '[]') as practitioner_ids
              from rayhab.services s
              left join rayhab.service_practitioners sp on sp.service_id = s.id
              left join rayhab.practitioners p on p.id = sp.practitioner_id and p.active and p.bookable
             where s.active
             group by s.id
             order by s.sort, s.name");
        return array_map(static function ($s) {
            $s['modes'] = json_decode((string) $s['modes'], true);
            $s['practitioner_ids'] = json_decode((string) $s['practitioner_ids'], true);
            $s['duration_min'] = (int) $s['duration_min'];
            $s['buffer_min'] = (int) $s['buffer_min'];
            $s['price_amount'] = $s['price_amount'] === null ? null : (int) $s['price_amount'];
            return $s;
        }, $rows);
    }

    public function service(string $id): ?array
    {
        foreach ($this->services() as $s) if ($s['id'] === $id) return $s;
        return null;
    }

    /** @return array{first:string,last:string} */
    public function window(): array
    {
        $today = Time::today();
        return ['first' => Time::addDays($today, $this->cfg->int('LEAD_DAYS')), 'last' => Time::addDays($today, $this->cfg->int('HORIZON_DAYS'))];
    }

    /**
     * The slots for one service on one Beirut day. An empty practitioner
     * means "any": a time is free if any practitioner offering it is.
     * @return list<array{time:string,available:bool,practitioners:list<string>}>
     */
    public function slots(string $serviceId, ?string $practitionerId, string $mode, string $date, string $excludeId = ''): array
    {
        $svc = $this->service($serviceId);
        if (!$svc) throw ApiError::validation(['service_id' => 'Unknown service.']);
        if (!preg_match(Check::DAY, $date)) throw ApiError::validation(['date' => 'Use yyyy-mm-dd.']);
        if (!in_array($mode, $svc['modes'], true)) return [];
        $win = $this->window();
        if ($date < $win['first'] || $date > $win['last']) return [];

        $pracs = $svc['practitioner_ids'];
        if ($practitionerId) $pracs = array_values(array_filter($pracs, static fn($p) => $p === $practitionerId));
        if (!$pracs) return [];
        $list = Db::arrayLiteral($pracs);

        $hours = $this->db->query('select practitioner_id, start_time, end_time from rayhab.working_hours
                                    where weekday = ? and practitioner_id = any(?::text[]) order by start_time', [Time::dow($date), $list]);
        $busy = $this->db->query('select practitioner_id, local_time, (extract(epoch from ends_at - starts_at) / 60)::int as mins
                                    from rayhab.appointments
                                   where local_date = ? and practitioner_id = any(?::text[]) and status = any(?::text[]) and id <> ?',
                                 [$date, $list, Db::arrayLiteral(self::LIVE), $excludeId]);
        $blocked = $this->db->query('select practitioner_id, start_time, end_time from rayhab.schedule_exceptions
                                      where local_date = ? and practitioner_id = any(?::text[])', [$date, $list]);

        $dur = $svc['duration_min'];
        $buf = $svc['buffer_min'];
        $byTime = [];
        foreach ($pracs as $p) {
            $ranges = [];
            foreach ($busy as $b) if ($b['practitioner_id'] === $p) $ranges[] = [Time::toMin($b['local_time']), Time::toMin($b['local_time']) + (int) $b['mins'] + $buf];
            foreach ($blocked as $b) if ($b['practitioner_id'] === $p) $ranges[] = [Time::toMin($b['start_time']), Time::toMin($b['end_time'])];
            foreach ($hours as $h) {
                if ($h['practitioner_id'] !== $p) continue;
                for ($t = Time::toMin($h['start_time']); $t + $dur <= Time::toMin($h['end_time']); $t += $dur + $buf) {
                    $label = Time::fromMin($t);
                    $free = true;
                    foreach ($ranges as [$a, $b]) if ($t < $b && $t + $dur > $a) { $free = false; break; }
                    $slot = $byTime[$label] ?? ['time' => $label, 'available' => false, 'practitioners' => []];
                    if ($free) { $slot['available'] = true; $slot['practitioners'][] = $p; }
                    $byTime[$label] = $slot;
                }
            }
        }
        ksort($byTime);
        return array_values($byTime);
    }
}
