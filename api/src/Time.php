<?php
declare(strict_types=1);

namespace Rayhab;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;

/* Beirut calendar days and wall times. A day is "yyyy-mm-dd" and a time is
   "HH:MM", both as the clinic reads them; PHP's own Asia/Beirut rules turn
   them into instants, summer time and winter time alike. */
final class Time
{
    public const TZ = 'Asia/Beirut';
    private const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    private const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    private const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    private const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    public static function tz(): DateTimeZone { return new DateTimeZone(self::TZ); }

    public static function today(?int $now = null): string
    {
        return (new DateTimeImmutable('@' . ($now ?? time())))->setTimezone(self::tz())->format('Y-m-d');
    }

    private static function day(string $iso): DateTimeImmutable
    {
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', $iso, new DateTimeZone('UTC'));
        if (!$d) throw new \InvalidArgumentException("Not a day: $iso");
        return $d;
    }

    public static function addDays(string $iso, int $n): string { return self::day($iso)->modify(($n >= 0 ? '+' : '') . $n . ' day')->format('Y-m-d'); }
    public static function daysBetween(string $a, string $b): int { return (int) round((self::day($b)->getTimestamp() - self::day($a)->getTimestamp()) / 86400); }
    public static function dow(string $iso): int { return (int) self::day($iso)->format('w'); }

    /* A Beirut day and wall time as a UTC instant. */
    public static function toUtc(string $date, string $time): DateTimeImmutable
    {
        return (new DateTimeImmutable($date . ' ' . $time, self::tz()))->setTimezone(new DateTimeZone('UTC'));
    }

    /** @return array{date:string,time:string} */
    public static function fromInstant(mixed $v): array
    {
        $d = ($v instanceof DateTimeInterface ? DateTimeImmutable::createFromInterface($v) : new DateTimeImmutable((string) $v))->setTimezone(self::tz());
        return ['date' => $d->format('Y-m-d'), 'time' => $d->format('H:i')];
    }

    /* "Mon 19 Oct", or "Monday 19 October". */
    public static function dayLabel(string $iso, bool $full = false): string
    {
        $d = self::day($iso);
        $w = (int) $d->format('w');
        $m = (int) $d->format('n') - 1;
        return $full ? self::DOW_FULL[$w] . ' ' . $d->format('j') . ' ' . self::MON_FULL[$m]
                     : self::DOW[$w] . ' ' . $d->format('j') . ' ' . self::MON[$m];
    }

    public static function toMin(string $hhmm): int { [$h, $m] = array_map('intval', explode(':', $hhmm)); return $h * 60 + $m; }
    public static function fromMin(int $m): string { return sprintf('%02d:%02d', intdiv($m, 60), $m % 60); }
}
