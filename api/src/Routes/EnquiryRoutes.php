<?php
/* Website questions, and patients' WhatsApp replies (Inbound.php), in the admin.

     GET  /api/admin/enquiries?status=open|answered|all&q=&page=&page_size=
     POST /api/admin/enquiries/{id}/answered   { answered: true | false }

   Marking a question answered is bookkeeping, not a reply: the reply itself
   goes by email or WhatsApp from the clinic. It can be undone. */
declare(strict_types=1);

namespace Rayhab\Routes;

use Rayhab\ApiError;
use Rayhab\App;
use Rayhab\Records;
use Rayhab\Request;
use Rayhab\Response;
use Rayhab\Util;

final class EnquiryRoutes
{
    private const SELECT = 'select e.id, e.first_name, e.last_name, e.email, e.phone, e.message, e.created_at, e.handled_at, p.name as handled_by_name,
                                   e.channel, e.appointment_id, a.reference
                              from rayhab.enquiries e left join rayhab.practitioners p on p.id = e.handled_by
                              left join rayhab.appointments a on a.id = e.appointment_id';

    public static function view(array $e): array
    {
        return [
            'id' => $e['id'],
            'name' => trim($e['first_name'] . ' ' . $e['last_name']),
            'email' => $e['email'] ?: null,
            'phone' => $e['phone'] ?: null,
            'channel' => $e['channel'] ?? 'website',
            'appointment' => $e['appointment_id'] ? ['id' => $e['appointment_id'], 'reference' => $e['reference']] : null,
            'message' => $e['message'],
            'created_at' => Util::iso($e['created_at']),
            'status' => $e['handled_at'] ? 'answered' : 'open',
            'answered_at' => Util::iso($e['handled_at']),
            'answered_by' => $e['handled_by_name'] ? ['name' => $e['handled_by_name']] : null,
        ];
    }

    public static function register(App $app): void
    {
        $app->get('/api/admin/enquiries', function (Request $r) use ($app) {
            $app->guard->requireStaff($r);
            $q = $r->query;
            $where = [];
            $params = [];
            $status = $q['status'] ?? 'open';
            if ($status === 'open') $where[] = 'e.handled_at is null';
            elseif ($status === 'answered') $where[] = 'e.handled_at is not null';
            if (!empty($q['q'])) {
                $needle = '%' . str_replace(['%', '_'], '', mb_strtolower(trim($q['q']))) . '%';
                $where[] = "(lower(e.first_name || ' ' || e.last_name) like ? or lower(coalesce(e.email, '')) like ? or coalesce(e.phone, '') like ? or lower(e.message) like ?)";
                array_push($params, $needle, $needle, $needle, $needle);
            }
            $w = $where ? ' where ' . implode(' and ', $where) : '';
            [$size, $page, $offset] = AdminRoutes::page($q);
            $total = (int) $app->db->one('select count(*)::int as n from rayhab.enquiries e' . $w, $params)['n'];
            // Open ones oldest first (answer in order); answered ones newest first.
            $order = $status === 'open' ? 'e.created_at asc' : 'e.created_at desc';
            $rows = $app->db->query(self::SELECT . $w . " order by $order limit $size offset $offset", $params);
            return Response::json(['items' => array_map([self::class, 'view'], $rows), 'page' => $page, 'page_size' => $size, 'total' => $total]);
        });

        $app->post('/api/admin/enquiries/{id}/answered', function (Request $r, array $p) use ($app) {
            $s = $app->guard->requireStaff($r);
            $answered = $r->json()['answered'] ?? null;
            if (!is_bool($answered)) throw ApiError::validation(['answered' => 'Answer true or false.']);
            if (!preg_match('/^[0-9a-f-]{36}$/', $p['id'])) throw ApiError::notFound('No such question.');
            $row = $answered
                ? $app->db->one('update rayhab.enquiries set handled_at = coalesce(handled_at, now()), handled_by = coalesce(handled_by, ?) where id = ?::uuid returning id', [$s['id'], $p['id']])
                : $app->db->one('update rayhab.enquiries set handled_at = null, handled_by = null where id = ?::uuid returning id', [$p['id']]);
            if (!$row) throw ApiError::notFound('No such question.');
            Records::log($app->db, $answered ? 'enquiry_answered' : 'enquiry_reopened', null, ['kind' => 'staff', 'id' => $s['id'], 'name' => $s['name']],
                         $answered ? 'Marked a website question answered' : 'Reopened a website question');
            return Response::json(['enquiry' => self::view($app->db->one(self::SELECT . ' where e.id = ?::uuid', [$p['id']]))]);
        });
    }
}
