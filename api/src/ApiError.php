<?php
declare(strict_types=1);

namespace Rayhab;

/* Requests, responses and the API's error shape:

     { "error": { "code": "slot_taken", "message": "…" }, ...extra }

   The pages branch on the code and the status, never on the wording. */
final class ApiError extends \RuntimeException
{
    /** @param array<string,mixed> $extra */
    public function __construct(public int $status, public string $errorCode, string $message, public array $extra = [])
    {
        parent::__construct($message);
    }

    public function body(): array { return ['error' => ['code' => $this->errorCode, 'message' => $this->getMessage()]] + $this->extra; }

    /** @param array<string,string> $errors */
    public static function validation(array $errors, string $message = 'Some details need fixing.'): self
    {
        return new self(422, 'validation', $message, ['errors' => $errors]);
    }
    public static function conflict(string $code, string $message): self { return new self(409, $code, $message); }
    public static function notFound(string $message = 'Not found.'): self { return new self(404, 'not_found', $message); }
    public static function forbidden(string $code, string $message): self { return new self(403, $code, $message); }
}
