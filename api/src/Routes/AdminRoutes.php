<?php
/* The clinic admin's API (README.md, "API contracts: clinic admin").
   Every route needs a signed-in staff session; every change also needs the
   CSRF token and the site's Origin (Guard::requireStaff), and answers with
   the record as the database now holds it. */
declare(strict_types=1);

namespace Rayhab\Routes;

use Rayhab\ApiError;
use Rayhab\App;
use Rayhab\Check;
use Rayhab\Db;
use Rayhab\Guard;
use Rayhab\Records;
use Rayhab\Request;
use Rayhab\Response;
use Rayhab\Time;
use Rayhab\Util;

final class AdminRoutes
{
    private const ALLOWED = [
        'approve' => ['requested'],
        'decline' => ['requested'],
        'reschedule' => ['requested', 'approved', 'confirmed'],
        'cancel' => ['approved', 'confirmed', 'reschedule_requested'],
        'complete' => ['confirmed'],
        'no_show' => ['confirmed'],
    ];

    /** @return array{0:int,1:int,2:int} size, page, offset */
    public static function page(array $q): array
    {
        $size = min(max((int) ($q['page_size'] ?? 20) ?: 20, 1), 100);
        $page = max((int) ($q['page'] ?? 1), 1);
        return [$size, $page, ($page - 1) * $size];
    }

    public static function register(App $app): void
    {
        $staff = fn(Request $r) => $app->guard->requireStaff($r);

        $app->get('/api/admin/session', function (Request $r) use ($app, $staff) {
            $s = $staff($r);
            return Response::json([
                'user' => ['id' => $s['id'], 'name' => $s['name'], 'role' => $s['role']],
                'practitioners' => $app->db->query('select id, name, title from rayhab.practitioners where active order by name'),
                'services' => $app->db->query('select id, name from rayhab.services where active order by sort'),
                'permissions' => Guard::permissions($s['role']),
                'csrf_token' => $s['csrf'],
                'login_url' => Guard::LOGIN_URL,
                'logout_url' => Guard::LOGOUT_URL,
                'timezone' => Time::TZ,
            ]);
        });

        $app->get('/api/admin/overview', function (Request $r) use ($app, $staff) {
            $s = $staff($r);
            $today = Time::today();
            $todays = $app->db->query(Records::SELECT . ' where a.local_date = ? and a.status = any(?::text[]) order by a.starts_at',
                                      [$today, Db::arrayLiteral(['approved', 'confirmed', 'completed', 'reschedule_requested'])]);
            $c = $app->db->one("select
                (select count(*)::int from rayhab.appointments where status = 'requested') as requested,
                (select count(*)::int from rayhab.appointments a join rayhab.payment_intents pi on pi.appointment_id = a.id
                  where pi.status = 'awaiting_payment' and a.status in ('approved', 'confirmed', 'completed')) as awaiting_payment,
                (select count(*)::int from rayhab.enquiries where handled_at is null) as enquiries");
            $money = static fn(array $rows) => array_map(static fn($x) => ['currency' => $x['currency'], 'amount' => (int) $x['amount']], $rows);
            $outstanding = $app->db->query("select pi.currency, sum(pi.outstanding)::int as amount from rayhab.payment_intents pi
                                              join rayhab.appointments a on a.id = pi.appointment_id
                                             where pi.status = 'awaiting_payment' and a.status in ('approved', 'confirmed', 'completed') group by pi.currency");
            $received = $app->db->query("select currency, sum(amount)::int as amount from rayhab.payment_transactions
                                          where status = 'verified' and updated_at > now() - interval '7 days' group by currency");
            $alerts = [];
            foreach ($app->db->query("select a.id, a.reference, p.first_name, p.last_name from rayhab.appointments a join rayhab.patients p on p.id = a.patient_id
                                       where a.status = 'requested' and a.created_at < now() - interval '1 day' order by a.created_at") as $x) {
                $alerts[] = ['level' => 'warn', 'text' => $x['reference'] . ' (' . $x['first_name'] . ' ' . $x['last_name'] . ') has waited more than a day for a reply.', 'appointment_id' => $x['id']];
            }
            foreach ($app->db->query("select id, reference from rayhab.appointments where status = 'requested'
                                       and hold_expires_at < now() + interval '3 hours' and created_at >= now() - interval '1 day'") as $x) {
                $alerts[] = ['level' => 'warn', 'text' => $x['reference'] . ': the hold on this time ends within 3 hours. Reply before it lapses.', 'appointment_id' => $x['id']];
            }
            foreach ($app->db->query("select distinct a.id, a.reference from rayhab.payment_transactions t
                                        join rayhab.payment_intents pi on pi.id = t.intent_id join rayhab.appointments a on a.id = pi.appointment_id
                                       where t.status = 'failed' and pi.status = 'awaiting_payment' and a.status in ('approved', 'confirmed')") as $x) {
                $alerts[] = ['level' => 'info', 'text' => $x['reference'] . ': a Whish payment failed. The patient can retry from their link.', 'appointment_id' => $x['id']];
            }
            return Response::json([
                'date' => $today, 'timezone' => Time::TZ,
                'counts' => ['today' => count($todays), 'requested' => (int) $c['requested'], 'awaiting_payment' => (int) $c['awaiting_payment'],
                             'enquiries' => (int) $c['enquiries']],
                'outstanding' => $money($outstanding), 'received_7d' => $money($received),
                'today' => $app->records->shape($todays, $s['role']),
                'alerts' => $alerts,
            ]);
        });

        $app->get('/api/admin/appointments', function (Request $r) use ($app, $staff) {
            $s = $staff($r);
            $q = $r->query;
            $where = [];
            $params = [];
            if (!empty($q['status'])) { $where[] = 'a.status = any(?::text[])'; $params[] = Db::arrayLiteral(array_filter(explode(',', $q['status']))); }
            if (!empty($q['practitioner_id'])) { $where[] = 'a.practitioner_id = ?'; $params[] = $q['practitioner_id']; }
            if (($q['payment_method'] ?? '') === 'none') $where[] = 'pi.method is null';
            elseif (!empty($q['payment_method'])) { $where[] = 'pi.method = ?'; $params[] = $q['payment_method']; }
            if (!empty($q['date_from'])) { $where[] = 'a.local_date >= ?'; $params[] = $q['date_from']; }
            if (!empty($q['date_to'])) { $where[] = 'a.local_date <= ?'; $params[] = $q['date_to']; }
            // Only requests that came with a note (the admin's Enquiries > Booking notes).
            if (!empty($q['has_note'])) $where[] = "a.note <> ''";
            if (!empty($q['q'])) {
                $needle = '%' . str_replace(['%', '_'], '', mb_strtolower(trim($q['q']))) . '%';
                $where[] = "(lower(pt.first_name || ' ' || pt.last_name) like ? or lower(a.reference) like ? or pt.phone_e164 like ? or lower(coalesce(pt.email, '')) like ?)";
                array_push($params, $needle, $needle, $needle, $needle);
            }
            $w = $where ? ' where ' . implode(' and ', $where) : '';
            [$size, $page, $offset] = self::page($q);
            $total = (int) $app->db->one('select count(*)::int as n from (' . Records::SELECT . $w . ') x', $params)['n'];
            $order = ['created' => 'a.created_at', 'created_desc' => 'a.created_at desc'][$q['sort'] ?? ''] ?? 'a.starts_at';
            $rows = $app->db->query(Records::SELECT . $w . " order by $order limit $size offset $offset", $params);
            return Response::json(['items' => $app->records->shape($rows, $s['role']), 'page' => $page, 'page_size' => $size, 'total' => $total]);
        });

        $app->get('/api/admin/appointments/{id}', function (Request $r, array $p) use ($app, $staff) {
            $s = $staff($r);
            $a = $app->records->load($p['id'], $s['role']);
            if (!$a) throw ApiError::notFound('No such appointment.');
            $events = $app->db->query('select id, at, type, actor_kind, actor_name, appointment_id, summary from rayhab.events
                                        where appointment_id = ? order by at desc, id desc', [$a['id']]);
            return Response::json(['appointment' => $a, 'events' => array_map(static fn($e) => Records::eventView($e + ['reference' => $a['reference']]), $events)]);
        });

        foreach (['approve' => 'approve', 'decline' => 'decline', 'reschedule' => 'reschedule', 'cancel' => 'cancel',
                  'complete' => 'complete', 'no_show' => 'no-show'] as $action => $path) {
            $app->post('/api/admin/appointments/{id}/' . $path, function (Request $r, array $p) use ($app, $staff, $action) {
                $s = $staff($r);
                return $app->guard->idempotent($r, 'staff:' . $s['id'] . ':' . $action, function () use ($app, $s, $p, $action, $r) {
                    self::act($app, $s, $p['id'], $action, $r->json(), $r->id);
                    return Response::json(['appointment' => $app->records->load($p['id'], $s['role'])]);
                });
            });
        }

        $app->get('/api/admin/availability', function (Request $r) use ($app, $staff) {
            $staff($r);
            $q = $r->query;
            $pid = ($q['practitioner_id'] ?? '') ?: null;
            $hours = $app->db->query('select weekday, start_time, end_time from rayhab.working_hours
                                       where (?::text is null or practitioner_id = ?) order by weekday, start_time', [$pid, $pid]);
            $byDay = [];
            foreach ($hours as $h) $byDay[(int) $h['weekday']][] = ['start' => $h['start_time'], 'end' => $h['end_time']];
            $wh = [];
            foreach ($byDay as $d => $blocks) $wh[] = ['weekday' => $d, 'blocks' => $blocks];
            $from = ($q['from'] ?? '') ?: null;
            $to = ($q['to'] ?? '') ?: null;
            return Response::json(['timezone' => Time::TZ, 'working_hours' => $wh, 'exceptions' => $app->db->query(
                'select id, practitioner_id, local_date as date, start_time as start, end_time as "end", reason from rayhab.schedule_exceptions
                  where (?::text is null or local_date >= ?) and (?::text is null or local_date <= ?) and (?::text is null or practitioner_id = ?)
                  order by local_date, start_time', [$from, $from, $to, $to, $pid, $pid])]);
        });

        $app->patch('/api/admin/availability', function (Request $r) use ($app, $staff) {
            $s = $staff($r);
            Guard::can($s, 'manage_schedule');
            $b = $r->json();
            $add = is_array($b['add'] ?? null) ? $b['add'] : [];
            $remove = is_array($b['remove'] ?? null) ? $b['remove'] : [];
            if (count($add) > 20 || count($remove) > 50) throw ApiError::validation(['add' => 'Too many at once.']);
            foreach ($add as $x) {
                $c = new Check(is_array($x) ? $x : []);
                $c->match('date', Check::DAY, 'Choose a day.');
                $start = $c->match('start', Check::TIME, 'Choose a start time.');
                $end = $c->match('end', Check::TIME, 'Choose an end time.');
                if ($start !== '' && $end !== '' && $end <= $start) $c->add('end', 'End after the start time.');
                $c->maxText('reason', 120, 'Keep it short.');
                $c->done();
            }
            return $app->guard->idempotent($r, 'staff:' . $s['id'] . ':schedule', function () use ($app, $s, $add, $remove) {
                $app->db->tx(function (Db $t) use ($s, $add, $remove) {
                    foreach ($add as $x) {
                        $pid = ($x['practitioner_id'] ?? '') ?: $t->one('select id from rayhab.practitioners where active and bookable order by created_at limit 1')['id'];
                        $t->query('insert into rayhab.schedule_exceptions (id, practitioner_id, local_date, start_time, end_time, reason, created_by) values (?, ?, ?, ?, ?, ?, ?)',
                                  [Util::id('ex'), $pid, $x['date'], $x['start'], $x['end'], trim((string) ($x['reason'] ?? '')), $s['id']]);
                        Records::log($t, 'time_blocked', null, ['kind' => 'staff', 'id' => $s['id'], 'name' => $s['name']],
                                     'Blocked ' . Time::dayLabel($x['date']) . ' ' . $x['start'] . '–' . $x['end'] . (!empty($x['reason']) ? ' (' . $x['reason'] . ')' : ''));
                    }
                    foreach ($remove as $exId) {
                        $gone = $t->one('delete from rayhab.schedule_exceptions where id = ? returning local_date, start_time, end_time', [(string) $exId]);
                        if ($gone) Records::log($t, 'block_removed', null, ['kind' => 'staff', 'id' => $s['id'], 'name' => $s['name']],
                                                'Removed the block on ' . Time::dayLabel($gone['local_date']) . ' ' . $gone['start_time'] . '–' . $gone['end_time']);
                    }
                });
                return Response::json(['exceptions' => $app->db->query('select id, practitioner_id, local_date as date, start_time as start, end_time as "end", reason
                                                                         from rayhab.schedule_exceptions where local_date >= ? order by local_date, start_time', [Time::today()])]);
            });
        });

        $app->get('/api/admin/payments', function (Request $r) use ($app, $staff) {
            $s = $staff($r);
            $q = $r->query;
            $where = ["(pi.method is not null or a.status in ('approved', 'confirmed'))"];
            $params = [];
            if (!empty($q['status'])) { $where[] = 'pi.status = ?'; $params[] = $q['status']; }
            if (($q['payment_method'] ?? '') === 'none') $where[] = 'pi.method is null';
            elseif (!empty($q['payment_method'])) { $where[] = 'pi.method = ?'; $params[] = $q['payment_method']; }
            $w = ' where ' . implode(' and ', $where);
            [$size, $page, $offset] = self::page($q);
            $total = (int) $app->db->one('select count(*)::int as n from (' . Records::SELECT . $w . ') x', $params)['n'];
            $rows = $app->db->query(Records::SELECT . $w . " order by pi.updated_at desc limit $size offset $offset", $params);
            return Response::json(['items' => array_map([Records::class, 'paymentRow'], $app->records->shape($rows, $s['role'])),
                                   'page' => $page, 'page_size' => $size, 'total' => $total]);
        });

        $app->post('/api/admin/payments/{id}/confirm-cash', function (Request $r, array $p) use ($app, $staff) {
            $s = $staff($r);
            Guard::can($s, 'confirm_cash');
            $b = $r->json();
            $amount = $b['amount'] ?? null;
            if (!is_int($amount) || $amount <= 0) throw ApiError::validation(['amount' => 'Enter the amount received.']);
            $currency = (string) ($b['currency'] ?? '');
            $reference = trim((string) ($b['reference'] ?? ''));
            if (mb_strlen($reference) > 60) throw ApiError::validation(['reference' => 'Keep it under 60 characters.']);
            return $app->guard->idempotent($r, 'staff:' . $s['id'] . ':cash', function () use ($app, $s, $p, $amount, $currency, $reference, $r) {
                $apptId = $app->db->tx(function (Db $t) use ($app, $s, $p, $amount, $currency, $reference, $r) {
                    $row = $t->one('select pi.id, pi.method, pi.status, pi.currency, pi.outstanding, a.id as appointment_id, a.status as appt_status, a.reference
                                      from rayhab.payment_intents pi join rayhab.appointments a on a.id = pi.appointment_id
                                     where pi.id = ? for update of pi', [$p['id']]);
                    if (!$row) throw ApiError::notFound('No such payment.');
                    $offered = $row['method'] === 'cash' && $row['status'] === 'awaiting_payment' && in_array($row['appt_status'], ['approved', 'confirmed', 'completed'], true);
                    if (!$offered) throw ApiError::conflict('already_recorded', $row['status'] === 'paid' ? 'This cash payment is already recorded.' : 'Cash cannot be recorded for this payment.');
                    if ($currency !== $row['currency']) throw ApiError::validation(['amount' => 'Enter the amount received in ' . $row['currency'] . '.']);
                    $owed = (int) $row['outstanding'];
                    if ($amount > $owed) throw ApiError::validation(['amount' => 'That is more than the ' . Util::money($owed, $row['currency']) . ' owed.']);
                    $ref = $reference !== '' ? $reference : 'CASH-' . preg_replace('/^RQ-/', '', $row['reference']);
                    $t->query("insert into rayhab.payment_transactions (id, intent_id, provider, status, amount, currency, reference, recorded_by)
                               values (?, ?, 'cash', 'verified', ?, ?, ?, ?)", [Util::id('tx'), $row['id'], $amount, $row['currency'], $ref, $s['id']]);
                    Records::log($t, 'cash_recorded', $row['appointment_id'], ['kind' => 'staff', 'id' => $s['id'], 'name' => $s['name']],
                                 'Cash received, ' . Util::money($amount, $row['currency']) . ($amount < $owed ? ', ' . Util::money($owed - $amount, $row['currency']) . ' still owed' : ''),
                                 null, null, $r->id);
                    $app->payments->afterCredit($row['id'], $amount);
                    return $row['appointment_id'];
                });
                return Response::json(['payment' => Records::paymentRow($app->records->load($apptId, $s['role']))]);
            });
        });

        $app->get('/api/admin/audit', function (Request $r) use ($app, $staff) {
            $staff($r);
            $q = $r->query;
            $where = [];
            $params = [];
            if (!empty($q['type'])) { $where[] = 'e.type = ?'; $params[] = $q['type']; }
            if (!empty($q['appointment_id'])) { $where[] = 'e.appointment_id = ?'; $params[] = $q['appointment_id']; }
            $w = $where ? ' where ' . implode(' and ', $where) : '';
            [$size, $page, $offset] = self::page($q);
            $total = (int) $app->db->one('select count(*)::int as n from rayhab.events e' . $w, $params)['n'];
            $rows = $app->db->query('select e.id, e.at, e.type, e.actor_kind, e.actor_name, e.appointment_id, e.summary, a.reference
                                       from rayhab.events e left join rayhab.appointments a on a.id = e.appointment_id' . $w .
                                    " order by e.at desc, e.id desc limit $size offset $offset", $params);
            return Response::json(['items' => array_map([Records::class, 'eventView'], $rows), 'page' => $page, 'page_size' => $size, 'total' => $total]);
        });
    }

    /* One staff action on one appointment, in one transaction, with its
       message to the patient written to the outbox. */
    private static function act(App $app, array $s, string $apptId, string $action, array $body, string $requestId): void
    {
        $actor = ['kind' => 'staff', 'id' => $s['id'], 'name' => $s['name']];
        try {
            $app->db->tx(function (Db $t) use ($app, $s, $apptId, $action, $body, $requestId, $actor) {
                $a = $t->one('select a.*, s.name as service_name, s.duration_min, s.price_amount, s.currency as service_currency,
                                     pi.id as pay_id, pi.status as pay_status, extract(epoch from a.hold_expires_at)::bigint as hold_until
                                from rayhab.appointments a join rayhab.services s on s.id = a.service_id
                                join rayhab.payment_intents pi on pi.appointment_id = a.id
                               where a.id = ? for update of a', [$apptId]);
                if (!$a) throw ApiError::notFound('No such appointment.');
                if (!in_array($a['status'], self::ALLOWED[$action], true)) {
                    $verb = ['approve' => 'approved', 'decline' => 'declined', 'reschedule' => 'moved', 'cancel' => 'cancelled',
                             'complete' => 'marked completed', 'no_show' => 'marked no-show'][$action];
                    throw ApiError::conflict('invalid_transition', 'This appointment can no longer be ' . $verb . '. It is now ' . str_replace('_', ' ', $a['status']) . '.');
                }
                $m = $app->notify->row($apptId);
                $set = static fn(string $status, string $extra = '') => $t->query('update rayhab.appointments set status = ?, updated_at = now()' . $extra . ' where id = ?', [$status, $apptId]);
                $log = static fn(string $type, string $summary, string $next) => Records::log($t, $type, $apptId, $actor, $summary, $a['status'], $next, $requestId);

                if ($action === 'approve') {
                    if ($a['price_amount'] === null) throw ApiError::conflict('price_missing', 'Set a price for ' . $a['service_name'] . ' before approving, so the patient sees what to pay.');
                    if ($a['hold_until'] !== null && (int) $a['hold_until'] < time()) throw ApiError::conflict('hold_expired', 'The hold on this time has lapsed. Propose a time instead.');
                    if ($a['pay_status'] === 'not_selected') {
                        $t->query('update rayhab.payment_intents set amount = ?, outstanding = ?, currency = ?, updated_at = now() where id = ?',
                                  [(int) $a['price_amount'], (int) $a['price_amount'], $a['service_currency'], $a['pay_id']]);
                    }
                    $set('approved', ', hold_expires_at = null');
                    $link = $app->links->issue($apptId, new \DateTimeImmutable((string) $a['starts_at']));
                    $log('approved', 'Approved. WhatsApp sent with the payment link', 'approved');
                    $app->notify->whatsapp($m, 'approved', [$m['service_name'], Time::dayLabel($m['local_date'], true), $m['local_time']], $link, 'approved:' . $apptId . ':' . microtime(true));
                } elseif ($action === 'decline') {
                    $reason = trim((string) ($body['reason'] ?? ''));
                    if ($reason === '' || mb_strlen($reason) > 120) throw ApiError::validation(['reason' => 'Choose a reason.']);
                    $message = mb_substr(trim((string) ($body['message'] ?? '')), 0, 500);
                    $set('declined', ', hold_expires_at = null');
                    $app->links->revoke($apptId);
                    $log('declined', 'Declined: ' . $reason, 'declined');
                    $app->notify->whatsapp($m, 'declined', [$m['service_name'], $message !== '' ? $message : $reason], null, 'declined:' . $apptId);
                } elseif ($action === 'reschedule') {
                    $c = new Check($body);
                    $date = $c->match('date', Check::DAY, 'Choose a day.');
                    $time = $c->match('time', Check::TIME, 'Choose a time.');
                    $c->done();
                    $free = false;
                    foreach ($app->sched->slots($a['service_id'], $a['practitioner_id'], $a['mode'], $date, $apptId) as $x) {
                        if ($x['time'] === $time && $x['available']) $free = true;
                    }
                    if (!$free) throw ApiError::conflict('slot_taken', 'That time is not free.');
                    $start = Time::toUtc($date, $time);
                    $end = $start->modify('+' . (int) $a['duration_min'] . ' minutes');
                    $t->query("update rayhab.appointments set status = 'reschedule_requested', starts_at = ?::timestamptz, ends_at = ?::timestamptz,
                                      local_date = ?, local_time = ?, hold_expires_at = now() + make_interval(hours => ?), updated_at = now() where id = ?",
                              [$start->format(DATE_ATOM), $end->format(DATE_ATOM), $date, $time, $app->cfg->int('HOLD_HOURS'), $apptId]);
                    $link = $app->links->issue($apptId, $start);
                    $log('reschedule_proposed', 'New time proposed: ' . Time::dayLabel($date) . ' ' . $time, 'reschedule_requested');
                    $app->notify->whatsapp($m, 'new_time', [$m['service_name'], Time::dayLabel($date, true), $time], $link, 'newtime:' . $apptId . ':' . $date . $time);
                } elseif ($action === 'cancel') {
                    $reason = mb_substr(trim((string) ($body['reason'] ?? '')), 0, 500);
                    $set('cancelled', ', hold_expires_at = null');
                    $app->links->revoke($apptId);
                    $log('cancelled', 'Cancelled' . ($reason !== '' ? ': ' . $reason : ''), 'cancelled');
                    $app->notify->whatsapp($m, 'cancelled', [$m['service_name'], Time::dayLabel($m['local_date'], true), $m['local_time']], null, 'cancelled:' . $apptId);
                } elseif ($action === 'complete') {
                    $set('completed');
                    $log('completed', 'Marked completed', 'completed');
                } else {
                    $set('no_show');
                    $log('no_show', 'Marked no-show', 'no_show');
                }
            });
        } catch (\PDOException $e) {
            if (Db::code($e) === Db::EXCLUSION) throw ApiError::conflict('slot_taken', 'That time is no longer free.');
            throw $e;
        }
    }
}
