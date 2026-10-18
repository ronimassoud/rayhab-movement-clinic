<?php
/* Migrations and the clinic's starting data.

   migrations/NNN_*.sql are applied in order, each once, each in its own
   transaction, by the deploy (bin/migrate.php) with the schema owner's
   connection, never the API's own. They only move forward and keep the
   previous release working (add, never rename or drop in one release).

   The seed fills what is missing and never overwrites what the clinic has
   since changed: the services, the practitioner and the opening hours the
   booking page shows (site/assets/js/booking.js). Prices are left empty:
   the clinic sets them (runbook, "Prices"). */
declare(strict_types=1);

namespace Rayhab;

final class Migrate
{
    public const PRACTITIONER = ['id' => 'pr-rayan', 'name' => 'Dr. Rayan Halimeh', 'title' => 'Physiotherapist, DPT'];

    private const SERVICES = [
        ['assessment', 'Scoliosis assessment', 60, 'Start here', ['clinic', 'online'], 'First visit. Three-dimensional assessment, movement screen, and the first version of your plan.'],
        ['follow', 'Scoliosis rehabilitation session', 45, '', ['clinic', 'online'], 'Coached corrective exercise and progression. For existing patients.'],
        ['online', 'Online scoliosis consultation', 40, '', ['online'], 'Imaging review, exercise guidance and a remote plan. For patients outside Lebanon.'],
        ['sports', 'Sports or general physiotherapy', 45, '', ['clinic', 'online'], 'Injury rehabilitation, return to sport, mobility and joint training.'],
        ['pain', 'Pain management assessment', 60, '', ['clinic', 'online'], 'Persistent or recurring pain: a full assessment, a clear explanation and a graded plan.'],
        ['pain-follow', 'Pain management follow-up', 45, '', ['clinic', 'online'], 'Coached graded activity, progression and updates to your home program. For existing patients.'],
    ];

    // Closed Sunday and Wednesday; Saturday mornings only.
    private const HOURS = [[1, '09:00', '12:00'], [1, '15:00', '18:00'], [2, '09:00', '12:00'], [2, '15:00', '18:00'],
                           [4, '09:00', '12:00'], [4, '15:00', '18:00'], [5, '09:00', '12:00'], [5, '15:00', '18:00'], [6, '09:00', '13:00']];

    /** @return string[] the migrations applied */
    public static function run(Db $db, ?callable $log = null): array
    {
        $log ??= static fn(string $m) => fwrite(STDOUT, $m . "\n");
        $db->exec('create schema if not exists rayhab; create table if not exists rayhab.schema_migrations (name text primary key, applied_at timestamptz not null default now())');
        $done = array_column($db->query('select name from rayhab.schema_migrations'), 'name');
        $applied = [];
        $files = glob(dirname(__DIR__) . '/migrations/[0-9][0-9][0-9]_*.sql') ?: [];
        sort($files);
        foreach ($files as $f) {
            $name = basename($f);
            if (in_array($name, $done, true)) continue;
            $db->tx(function (Db $t) use ($f, $name) {
                $t->exec((string) file_get_contents($f));
                $t->query('insert into rayhab.schema_migrations (name) values (?)', [$name]);
            });
            $applied[] = $name;
            $log('migrated ' . $name);
        }
        if (!$applied) $log('database is up to date');
        return $applied;
    }

    public static function seed(Db $db, ?callable $log = null): void
    {
        $log ??= static fn(string $m) => fwrite(STDOUT, $m . "\n");
        $db->tx(function (Db $t) {
            $p = self::PRACTITIONER;
            $t->query("insert into rayhab.practitioners (id, name, title, role) values (?, ?, ?, 'admin') on conflict (id) do nothing", [$p['id'], $p['name'], $p['title']]);
            foreach (self::SERVICES as $i => [$id, $name, $dur, $tag, $modes, $desc]) {
                $t->query('insert into rayhab.services (id, name, description, tag, duration_min, modes, sort) values (?, ?, ?, ?, ?, ?::text[], ?) on conflict (id) do nothing',
                          [$id, $name, $desc, $tag, $dur, Db::arrayLiteral($modes), $i]);
                $t->query('insert into rayhab.service_practitioners values (?, ?) on conflict do nothing', [$id, $p['id']]);
            }
            if ((int) $t->one('select count(*)::int as n from rayhab.working_hours where practitioner_id = ?', [$p['id']])['n'] === 0) {
                foreach (self::HOURS as [$d, $a, $b]) {
                    $t->query('insert into rayhab.working_hours (practitioner_id, weekday, start_time, end_time) values (?, ?, ?, ?)', [$p['id'], $d, $a, $b]);
                }
            }
        });
        $log('seed: services, practitioner and opening hours are present');
    }
}
