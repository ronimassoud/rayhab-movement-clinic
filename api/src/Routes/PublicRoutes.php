<?php
/* Public booking endpoints (README.md, "API contracts: patient booking").

     GET  /api/services
     GET  /api/availability?service_id=&practitioner_id=&mode=&date=
     POST /api/appointments
     POST /api/enquiries */
declare(strict_types=1);

namespace Rayhab\Routes;

use Rayhab\ApiError;
use Rayhab\App;
use Rayhab\Check;
use Rayhab\Db;
use Rayhab\Records;
use Rayhab\Request;
use Rayhab\Response;
use Rayhab\Time;
use Rayhab\Util;

final class PublicRoutes
{
    public static function register(App $app): void
    {
        $app->get('/api/services', function () use ($app) {
            $services = array_map(static fn($s) => [
                'id' => $s['id'], 'name' => $s['name'], 'description' => $s['description'], 'tag' => $s['tag'],
                'duration_min' => $s['duration_min'],
                'price' => $s['price_amount'] === null ? null : ['amount' => $s['price_amount'], 'currency' => $s['currency']],
                'modes' => $s['modes'], 'practitioner_ids' => $s['practitioner_ids'],
            ], $app->sched->services());
            $practitioners = $app->db->query('select id, name, title from rayhab.practitioners where active and bookable order by name');
            return Response::json(['services' => $services, 'practitioners' => $practitioners, 'timezone' => Time::TZ]);
        });

        $app->get('/api/availability', function (Request $r) use ($app) {
            $q = $r->query;
            $mode = ($q['mode'] ?? '') === 'online' ? 'online' : 'clinic';
            $slots = $app->sched->slots((string) ($q['service_id'] ?? ''), ($q['practitioner_id'] ?? '') ?: null, $mode, (string) ($q['date'] ?? ''));
            return Response::json([
                'date' => $q['date'] ?? null, 'service_id' => $q['service_id'] ?? null, 'practitioner_id' => ($q['practitioner_id'] ?? '') ?: null,
                'mode' => $mode, 'timezone' => Time::TZ,
                'slots' => array_map(static fn($s) => ['time' => $s['time'], 'available' => $s['available']], $slots),
            ]);
        });

        $app->post('/api/appointments', function (Request $r) use ($app) {
            $app->guard->origin($r);
            $app->guard->limit('appt-ip:' . $r->ip, 5, 60);
            return $app->guard->idempotent($r, 'appointments', fn() => self::book($app, $r));
        });

        $app->post('/api/enquiries', function (Request $r) use ($app) {
            $app->guard->origin($r);
            $app->guard->limit('enq-ip:' . $r->ip, 5, 60);
            return $app->guard->idempotent($r, 'enquiries', function () use ($app, $r) {
                $b = $r->json();
                if (!empty($b['website'])) throw new ApiError(400, 'rejected', 'Request rejected.');
                $c = new Check($b);
                $first = $c->name('first_name', 'first name');
                $last = $c->name('last_name', 'last name');
                $email = $c->email('email', true);
                $phone = $c->str('phone');
                if ($phone !== '' && !preg_match('/^[0-9+()\-\s]{8,30}$/', $phone)) $c->add('phone', 'Check the number.');
                $msg = $c->str('message');
                $c->add('message', mb_strlen($msg) < 10 ? 'Add a little more detail.' : (mb_strlen($msg) > 2000 ? 'Keep it under 2000 characters.' : null));
                $c->done();
                $app->db->tx(function (Db $t) use ($app, $first, $last, $email, $phone, $msg) {
                    $t->query('insert into rayhab.enquiries (first_name, last_name, email, phone, message) values (?, ?, ?, ?, ?)',
                              [$first, $last, $email, $phone ?: null, $msg]);
                    // The question itself stays behind the admin sign-in; email only says one arrived.
                    $app->notify->staff('enquiry', 'New website question',
                        "A new question arrived through the website's contact form.\n\nRead and answer it: " . $app->notify->adminUrl('#/enquiries') . "\n");
                });
                return Response::json(['status' => 'received'], 201);
            });
        });
    }

    private static function book(App $app, Request $r): Response
    {
        $b = $r->json();
        if (!empty($b['website'])) throw new ApiError(400, 'rejected', 'Request rejected.');
        $c = new Check($b);
        $serviceId = $c->match('service_id', '/^[\w-]{1,40}$/', 'Choose a service.');
        $practitionerId = $c->str('practitioner_id') ?: null;
        $forWhom = $c->oneOf('for_whom', ['me', 'child'], 'Choose who the appointment is for.');
        $mode = $c->oneOf('mode', ['clinic', 'online'], 'Choose the clinic or online.');
        $date = $c->match('date', Check::DAY, 'Choose a day.');
        $time = $c->match('time', Check::TIME, 'Choose a time.');
        $first = $c->name('first_name', 'first name');
        $last = $c->name('last_name', 'last name');
        $phone = $c->match('phone', '/^\+[1-9]\d{7,14}$/', 'Enter a WhatsApp number with its country code.');
        $email = $c->email('email', false);
        $note = $c->maxText('note', 2000, 'Keep it under 2000 characters.');
        $consents = $c->raw('consents');
        if (!is_array($consents) || ($consents['storage'] ?? null) !== true || ($consents['whatsapp'] ?? null) !== true
            || !is_string($consents['version'] ?? null) || $consents['version'] === '' || strlen($consents['version']) > 40) {
            $c->add('consents', 'Consent is required.');
        }
        $c->done();
        if (is_numeric($b['elapsed_ms'] ?? null) && (int) $b['elapsed_ms'] < 3000) error_log('[rayhab] booking sent very fast');

        // At most five requests a day from one number.
        $recent = $app->db->one("select count(*)::int as n from rayhab.appointments a join rayhab.patients p on p.id = a.patient_id
                                  where p.phone_e164 = ? and a.created_at > now() - interval '1 day'", [$phone]);
        if ((int) $recent['n'] >= 5) throw new ApiError(429, 'rate_limited', 'Too many requests for this number today.');

        $svc = $app->sched->service($serviceId);
        if (!$svc) throw ApiError::validation(['service_id' => 'Unknown service.']);
        $slot = null;
        foreach ($app->sched->slots($serviceId, $practitionerId, $mode, $date) as $s) if ($s['time'] === $time) $slot = $s;
        if (!$slot || !$slot['available']) throw ApiError::conflict('slot_taken', 'That time is no longer available.');
        $pid = $practitionerId && in_array($practitionerId, $slot['practitioners'], true) ? $practitionerId : $slot['practitioners'][0];
        $start = Time::toUtc($date, $time);
        $end = $start->modify('+' . $svc['duration_min'] . ' minutes');

        try {
            return $app->db->tx(function (Db $t) use ($app, $r, $svc, $pid, $mode, $forWhom, $date, $time, $first, $last, $phone, $email, $note, $consents, $start, $end) {
                $patient = $t->one('insert into rayhab.patients (first_name, last_name, phone_e164, email) values (?, ?, ?, ?) returning id',
                                   [$first, $last, $phone, $email]);
                $ref = $t->one("select 'RQ-' || nextval('rayhab.reference_seq') as r")['r'];
                $id = Util::id('apt');
                $appt = $t->one("insert into rayhab.appointments (id, reference, patient_id, practitioner_id, service_id, mode, for_whom,
                                   starts_at, ends_at, local_date, local_time, status, note, hold_expires_at,
                                   consent_storage_at, consent_whatsapp_at, consent_version)
                                 values (?, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz, ?, ?, 'requested', ?, now() + make_interval(hours => ?), now(), now(), ?)
                                 returning hold_expires_at, consent_whatsapp_at",
                                [$id, $ref, $patient['id'], $pid, $svc['id'], $mode, $forWhom, $start->format(DATE_ATOM), $end->format(DATE_ATOM),
                                 $date, $time, $note, $app->cfg->int('HOLD_HOURS'), $consents['version']]);
                $t->query('insert into rayhab.payment_intents (id, appointment_id, amount, currency, outstanding) values (?, ?, ?, ?, ?)',
                          [Util::id('pay'), $id, $svc['price_amount'] ?? 0, $svc['currency'], $svc['price_amount'] ?? 0]);
                Records::log($t, 'requested', $id, ['kind' => 'patient', 'name' => $first . ' ' . $last],
                             'Requested ' . $svc['name'] . ' for ' . Time::dayLabel($date) . ' ' . $time, null, 'requested', $r->id);
                $msg = ['id' => $id, 'phone_e164' => $phone, 'consent_whatsapp_at' => $appt['consent_whatsapp_at']];
                $app->notify->whatsapp($msg, 'request_received', [Time::dayLabel($date, true), $time], null, 'received:' . $id);
                $app->notify->staff('new_request', 'New booking request ' . $ref,
                    "A new booking request is waiting for your reply.\n\n" . $ref . ': ' . Time::dayLabel($date, true) . ' at ' . $time
                    . ' (Beirut time), ' . ($mode === 'online' ? 'online' : 'at the clinic') . ".\n\nReview it: " . $app->notify->adminUrl('#/requests') . "\n",
                    $id, 'new_request:' . $id);
                return Response::json(['status' => 'requested', 'id' => $id, 'reference' => $ref, 'hold_expires_at' => Util::iso($appt['hold_expires_at'])], 201);
            });
        } catch (\PDOException $e) {
            if (Db::code($e) === Db::EXCLUSION) throw ApiError::conflict('slot_taken', 'That time is no longer available.');
            throw $e;
        }
    }
}
