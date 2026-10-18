<?php
/* Field checks with the API's 422 shape: { errors: { field: message } }.
   Each rule returns a message, or null when the value is fine. */
declare(strict_types=1);

namespace Rayhab;

final class Check
{
    /** @var array<string,string> */
    private array $errors = [];

    public function __construct(private array $data) {}

    public function add(string $field, ?string $message): void
    {
        if ($message !== null && !isset($this->errors[$field])) $this->errors[$field] = $message;
    }

    public function done(): void
    {
        if ($this->errors) throw ApiError::validation($this->errors);
    }

    public function str(string $k): string { $v = $this->data[$k] ?? ''; return is_scalar($v) ? trim((string) $v) : ''; }
    public function raw(string $k): mixed { return $this->data[$k] ?? null; }

    public function name(string $k, string $what): string
    {
        $v = $this->str($k);
        $len = mb_strlen($v);
        $this->add($k, $v === '' ? 'Enter your ' . $what . '.' : ($len < 2 ? 'That looks too short.' : ($len > 80 ? 'That looks too long.'
            : (preg_match('/[A-Za-z\x{00C0}-\x{024F}\x{0600}-\x{06FF}]/u', $v) ? null : 'Use letters for your ' . $what . '.'))));
        return $v;
    }

    public function email(string $k, bool $required): ?string
    {
        $v = $this->str($k);
        if ($v === '') { if ($required) $this->add($k, 'Enter your email.'); return null; }
        $this->add($k, (mb_strlen($v) <= 160 && filter_var($v, FILTER_VALIDATE_EMAIL)) ? null : 'Check the email address.');
        return $v;
    }

    public function oneOf(string $k, array $allowed, string $message): string
    {
        $v = $this->str($k);
        $this->add($k, in_array($v, $allowed, true) ? null : $message);
        return $v;
    }

    public function match(string $k, string $re, string $message): string
    {
        $v = $this->str($k);
        $this->add($k, preg_match($re, $v) ? null : $message);
        return $v;
    }

    public function maxText(string $k, int $max, string $message): string
    {
        $v = $this->str($k);
        $this->add($k, mb_strlen($v) > $max ? $message : null);
        return $v;
    }

    public const DAY = '/^\d{4}-\d{2}-\d{2}$/';
    public const TIME = '/^[0-2]\d:[0-5]\d$/';
}
