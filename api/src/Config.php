<?php
/* Configuration, read once from the settings file and checked.

   On the server the file is /srv/rayhab/<env>/app.env (KEY=value lines,
   mode 640, see infra/env.example). Apache passes its path to PHP as
   RAYHAB_ENV_FILE; the cron worker gets it the same way. The API refuses to
   run with an incomplete or unsafe setup rather than fail on a patient. */
declare(strict_types=1);

namespace Rayhab;

final class Config
{
    private const DEFAULTS = [
        'DEPLOY_ENV' => 'development',
        'PUBLIC_ORIGIN' => 'http://localhost:4700',
        'EXTRA_ORIGINS' => '',
        'DATABASE_URL' => '',
        'DATABASE_MIGRATE_URL' => '',
        'APP_SECRET' => '',
        'COOKIE_SECURE' => 'true',
        'LOG_LEVEL' => 'info',
        'AUTH_DRIVER' => 'supabase',
        'SUPABASE_URL' => '',
        'SUPABASE_ANON_KEY' => '',
        'DEV_STAFF' => '',
        'SESSION_HOURS' => '12',
        'WHATSAPP_DRIVER' => 'log',
        'WA_TOKEN' => '', 'WA_PHONE_NUMBER_ID' => '', 'WA_APP_SECRET' => '', 'WA_VERIFY_TOKEN' => '',
        'WA_GRAPH_VERSION' => 'v21.0', 'WA_LANG' => 'en',
        'EMAIL_DRIVER' => 'log',
        'EMAIL_FROM' => 'Rayhab bookings <bookings@dr-rayhab.com>',
        'STAFF_EMAILS' => '',
        'WHISH_DRIVER' => 'disabled',
        'WHISH_BASE_URL' => '', 'WHISH_MERCHANT_ID' => '', 'WHISH_SECRET' => '',
        'LEAD_DAYS' => '1', 'HORIZON_DAYS' => '90', 'HOLD_HOURS' => '72', 'LINK_TTL_DAYS' => '14',
        'PAYMENT_DEADLINE_HOURS' => '24',
        'POLICY_CASH_TEXT' => 'Pay at reception when you come in.',
        'POLICY_WHISH_TEXT' => 'You pay now through Whish. Your booking is secured once Whish confirms the payment.',
        'CLINIC_NAME' => 'Rayhab Movement Clinic',
        'CLINIC_PHONE' => '+961 71 383 315',
        'CLINIC_LOCATION' => 'Rayhab Movement Clinic, Beirut',
        // How long personal data is kept, in days; 0 keeps it (Retention.php).
        'RETAIN_UNCONFIRMED_DAYS' => '183', 'RETAIN_ANSWERED_QUESTION_DAYS' => '365', 'RETAIN_MESSAGE_DAYS' => '90',
    ];

    /** @var array<string,string> */
    private array $v;
    /** @var string[] */
    public readonly array $origins;
    /** @var string[] */
    public readonly array $staffEmails;

    /** @param array<string,string> $values */
    public function __construct(array $values)
    {
        $this->v = array_merge(self::DEFAULTS, array_map('strval', $values));
        $problems = $this->check();
        if ($problems) throw new \RuntimeException("Configuration is unsafe or incomplete:\n  " . implode("\n  ", $problems));
        $o = parse_url($this->get('PUBLIC_ORIGIN'));
        $origin = $o['scheme'] . '://' . $o['host'] . (isset($o['port']) ? ':' . $o['port'] : '');
        $this->origins = array_values(array_filter(array_merge([$origin], self::list($this->get('EXTRA_ORIGINS')))));
        $this->staffEmails = self::list($this->get('STAFF_EMAILS'));
    }

    /** Reads a KEY=value file. Comments and blank lines are skipped; a value may be quoted. */
    public static function fromFile(string $path): self
    {
        if (!is_readable($path)) throw new \RuntimeException("Settings file $path is missing or not readable.");
        $values = [];
        foreach (file($path, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') continue;
            $eq = strpos($line, '=');
            if ($eq === false) continue;
            $k = trim(substr($line, 0, $eq));
            $val = trim(substr($line, $eq + 1));
            if (strlen($val) >= 2 && ($val[0] === '"' || $val[0] === "'") && $val[-1] === $val[0]) $val = substr($val, 1, -1);
            $values[$k] = $val;
        }
        return new self($values);
    }

    public static function fromEnvironment(): self
    {
        $file = getenv('RAYHAB_ENV_FILE') ?: ($_SERVER['RAYHAB_ENV_FILE'] ?? '');
        if (!$file) throw new \RuntimeException('RAYHAB_ENV_FILE is not set.');
        return self::fromFile($file);
    }

    public function get(string $k): string { return $this->v[$k] ?? ''; }
    public function int(string $k): int { return (int) $this->get($k); }
    public function bool(string $k): bool { return in_array(strtolower($this->get($k)), ['1', 'true', 'yes', 'on'], true); }
    public function env(): string { return $this->get('DEPLOY_ENV'); }

    /** @return string[] */
    private static function list(string $s): array
    {
        return array_values(array_filter(array_map('trim', explode(',', $s)), static fn($x) => $x !== ''));
    }

    /** @return string[] */
    private function check(): array
    {
        $p = [];
        $env = $this->get('DEPLOY_ENV');
        if (!in_array($env, ['development', 'test', 'staging', 'production'], true)) $p[] = 'DEPLOY_ENV must be development, test, staging or production';
        if (strlen($this->get('APP_SECRET')) < 32) $p[] = 'APP_SECRET must be at least 32 characters';
        if (!filter_var($this->get('PUBLIC_ORIGIN'), FILTER_VALIDATE_URL)) $p[] = 'PUBLIC_ORIGIN must be a URL';
        foreach (['AUTH_DRIVER' => ['supabase', 'dev'], 'WHATSAPP_DRIVER' => ['cloud', 'log', 'off'],
                  'EMAIL_DRIVER' => ['mail', 'log', 'off'], 'WHISH_DRIVER' => ['disabled', 'sandbox', 'whish']] as $k => $ok) {
            if (!in_array($this->get($k), $ok, true)) $p[] = "$k must be one of " . implode(', ', $ok);
        }
        $live = $env === 'production' || $env === 'staging';
        if ($live) {
            if ($this->get('DATABASE_URL') === '') $p[] = 'DATABASE_URL is required';
            if ($this->get('AUTH_DRIVER') !== 'supabase') $p[] = 'AUTH_DRIVER must be supabase outside development';
            if ($this->get('SUPABASE_URL') === '' || $this->get('SUPABASE_ANON_KEY') === '') $p[] = 'SUPABASE_URL and SUPABASE_ANON_KEY are required';
            if (!str_starts_with($this->get('PUBLIC_ORIGIN'), 'https://')) $p[] = 'PUBLIC_ORIGIN must be https';
            if (!$this->bool('COOKIE_SECURE')) $p[] = 'COOKIE_SECURE must stay on';
        }
        if ($env === 'production') {
            if ($this->get('WHISH_DRIVER') === 'sandbox') $p[] = 'WHISH_DRIVER=sandbox is not allowed in production';
            if ($this->get('WHATSAPP_DRIVER') === 'log') $p[] = 'WHATSAPP_DRIVER=log is not allowed in production (use cloud, or off)';
            if ($this->get('EMAIL_DRIVER') === 'log') $p[] = 'EMAIL_DRIVER=log is not allowed in production (use mail, or off)';
        }
        if ($this->get('WHATSAPP_DRIVER') === 'cloud') {
            foreach (['WA_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN'] as $k) {
                if ($this->get($k) === '') $p[] = "WHATSAPP_DRIVER=cloud needs $k";
            }
        }
        if ($this->get('EMAIL_DRIVER') === 'mail' && self::list($this->get('STAFF_EMAILS')) === []) $p[] = 'EMAIL_DRIVER=mail needs STAFF_EMAILS';
        if ($this->get('WHISH_DRIVER') === 'whish') {
            foreach (['WHISH_BASE_URL', 'WHISH_MERCHANT_ID', 'WHISH_SECRET'] as $k) {
                if ($this->get($k) === '') $p[] = "WHISH_DRIVER=whish needs $k";
            }
        }
        return $p;
    }
}
