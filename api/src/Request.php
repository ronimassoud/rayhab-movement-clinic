<?php
declare(strict_types=1);

namespace Rayhab;

final class Request
{
    /** @var array<string,mixed>|null */
    private ?array $json = null;
    public string $id;

    /**
     * @param array<string,string> $query
     * @param array<string,string> $headers lower-case names
     * @param array<string,string> $cookies
     */
    public function __construct(
        public string $method,
        public string $path,
        public array $query = [],
        public array $headers = [],
        public array $cookies = [],
        public string $body = '',
        public string $ip = '127.0.0.1',
    ) {
        $this->id = bin2hex(random_bytes(5));
    }

    public static function fromGlobals(): self
    {
        $headers = [];
        foreach ($_SERVER as $k => $v) {
            if (str_starts_with($k, 'HTTP_')) $headers[strtolower(str_replace('_', '-', substr($k, 5)))] = (string) $v;
        }
        if (isset($_SERVER['CONTENT_TYPE'])) $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        $path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/';
        return new self(strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')), $path, array_map('strval', $_GET),
                        $headers, array_map('strval', $_COOKIE), (string) file_get_contents('php://input'),
                        (string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    }

    public function header(string $name): string { return $this->headers[strtolower($name)] ?? ''; }

    /** The JSON body as an array; a body that is not JSON is a 400. */
    public function json(): array
    {
        if ($this->json !== null) return $this->json;
        if (trim($this->body) === '') return $this->json = [];
        $ct = $this->header('content-type');
        if ($ct !== '' && stripos($ct, 'application/x-www-form-urlencoded') !== false) {
            parse_str($this->body, $form);
            return $this->json = $form;
        }
        $d = json_decode($this->body, true);
        if (!is_array($d)) throw new ApiError(400, 'bad_request', 'The request could not be read.');
        return $this->json = $d;
    }
}
