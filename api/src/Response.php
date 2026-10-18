<?php
declare(strict_types=1);

namespace Rayhab;

final class Response
{
    /** @var array<string,string> */
    public array $headers = ['Content-Type' => 'application/json; charset=utf-8', 'Cache-Control' => 'no-store'];
    /** @var list<array{0:string,1:string,2:array<string,mixed>}> */
    public array $cookies = [];

    public function __construct(public int $status = 200, public string $body = '') {}

    public static function json(mixed $data, int $status = 200): self
    {
        return new self($status, (string) json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    public static function html(string $html, int $status = 200): self
    {
        $r = new self($status, $html);
        $r->headers['Content-Type'] = 'text/html; charset=utf-8';
        return $r;
    }

    public static function redirect(string $to, int $status = 303): self
    {
        $r = new self($status, '');
        $r->headers['Location'] = $to;
        return $r;
    }

    public function cookie(string $name, string $value, array $opts): self { $this->cookies[] = [$name, $value, $opts]; return $this; }

    /** @return mixed the decoded JSON body (tests) */
    public function data(): mixed { return json_decode($this->body, true); }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers as $k => $v) header($k . ': ' . $v);
        foreach ($this->cookies as [$n, $v, $o]) setcookie($n, $v, $o);
        echo $this->body;
    }
}
