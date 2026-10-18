<?php
/* The database: PostgreSQL through PDO, plain SQL with ? placeholders.

   In production it is Supabase (session pooler); in CI a postgres:16
   service; on a developer's computer PGlite behind its socket server
   (api/dev). Every table lives in the private schema "rayhab", which
   Supabase's Data API does not expose. */
declare(strict_types=1);

namespace Rayhab;

use PDO;
use PDOException;

final class Db
{
    public const UNIQUE = '23505';
    public const EXCLUSION = '23P01';

    private int $depth = 0;

    public function __construct(private PDO $pdo) {}

    /* postgres://user:pass@host:port/db?sslmode=require -> PDO */
    public static function connect(string $url): self
    {
        $u = parse_url($url);
        if (!$u || empty($u['host'])) throw new \RuntimeException('DATABASE_URL is not a postgres:// URL.');
        parse_str($u['query'] ?? '', $q);
        $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s;sslmode=%s', $u['host'], $u['port'] ?? 5432,
                       ltrim($u['path'] ?? '/postgres', '/') ?: 'postgres', $q['sslmode'] ?? 'prefer');
        $pdo = new PDO($dsn, urldecode($u['user'] ?? ''), urldecode($u['pass'] ?? ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Emulated: works through any Supabase pooler mode, and allows
            // several statements in one exec (migrations).
            PDO::ATTR_EMULATE_PREPARES => true,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
        $pdo->exec("set search_path to rayhab, extensions, public; set application_name to 'rayhab-api'");
        return new self($pdo);
    }

    /** @return list<array<string,mixed>> */
    public function query(string $sql, array $params = []): array
    {
        $st = $this->pdo->prepare($sql);
        foreach (array_values($params) as $i => $v) {
            $type = is_int($v) ? PDO::PARAM_INT : (is_bool($v) ? PDO::PARAM_BOOL : (is_null($v) ? PDO::PARAM_NULL : PDO::PARAM_STR));
            $st->bindValue($i + 1, is_array($v) ? self::arrayLiteral($v) : $v, $type);
        }
        $st->execute();
        return $st->columnCount() ? $st->fetchAll() : [];
    }

    /** @return array<string,mixed>|null */
    public function one(string $sql, array $params = []): ?array
    {
        return $this->query($sql, $params)[0] ?? null;
    }

    public function exec(string $sql): void { $this->pdo->exec($sql); }

    /* A transaction; nested calls join the outer one. */
    public function tx(callable $fn): mixed
    {
        if ($this->depth > 0) return $fn($this);
        $this->pdo->beginTransaction();
        $this->depth++;
        try {
            $r = $fn($this);
            $this->pdo->commit();
            return $r;
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $e;
        } finally {
            $this->depth--;
        }
    }

    public static function code(\Throwable $e): string
    {
        return $e instanceof PDOException ? (string) ($e->errorInfo[0] ?? $e->getCode()) : '';
    }

    /* A PHP list as a PostgreSQL array literal: ['a','b'] -> {"a","b"} */
    public static function arrayLiteral(array $a): string
    {
        return '{' . implode(',', array_map(static fn($x) => '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], (string) $x) . '"', $a)) . '}';
    }
}
