<?php
declare(strict_types=1);

namespace Rayhab;

/* A send that failed: worth retrying (network, 429, 5xx) or not (a bad number, a template not approved). */
final class SendError extends \RuntimeException
{
    public function __construct(string $message, public bool $retry) { parent::__construct($message); }
}
