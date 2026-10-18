<?php
/* Small shared pieces: ids, tokens, hashing, sealing, money, Beirut time. */
declare(strict_types=1);

namespace Rayhab;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;

final class Util
{
    public static function id(string $prefix): string { return $prefix . '_' . self::b64url(random_bytes(9)); }

    /* A token for a link: 256 bits, URL-safe. */
    public static function token(): string { return self::b64url(random_bytes(32)); }

    public static function b64url(string $b): string { return rtrim(strtr(base64_encode($b), '+/', '-_'), '='); }
    public static function unb64url(string $s): string { return (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

    public static function sha256(string $s): string { return hash('sha256', $s); }
    public static function hmac(string $secret, string $s): string { return hash_hmac('sha256', $s, $secret); }

    /* AES-256-GCM with a key derived from APP_SECRET: for values that must be
       kept a short while but must not be readable at rest. */
    public static function seal(string $secret, string $plain): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $body = openssl_encrypt($plain, 'aes-256-gcm', hash('sha256', 'rayhab-seal:' . $secret, true), OPENSSL_RAW_DATA, $iv, $tag);
        return implode('.', array_map([self::class, 'b64url'], [$iv, $tag, (string) $body]));
    }
    public static function unseal(string $secret, string $sealed): string
    {
        [$iv, $tag, $body] = array_map([self::class, 'unb64url'], explode('.', $sealed) + [1 => '', 2 => '']);
        $plain = openssl_decrypt($body, 'aes-256-gcm', hash('sha256', 'rayhab-seal:' . $secret, true), OPENSSL_RAW_DATA, $iv, $tag);
        if ($plain === false) throw new \RuntimeException('Sealed value could not be opened.');
        return $plain;
    }

    /* "$80", "$80.50", "LBP 7,000,000". USD amounts are cents. */
    public static function money(int $amount, string $currency): string
    {
        if ($currency === 'USD') return '$' . preg_replace('/\.00$/', '', number_format($amount / 100, 2, '.', ''));
        return $currency . ' ' . number_format($amount);
    }

    /* An instant from the database (or anything DateTime reads) as ISO 8601 UTC. */
    public static function iso(mixed $v): ?string
    {
        if ($v === null || $v === '') return null;
        $d = $v instanceof DateTimeInterface ? $v : new DateTimeImmutable((string) $v);
        return $d->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }
}
