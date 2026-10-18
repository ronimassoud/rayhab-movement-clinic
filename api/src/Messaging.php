<?php
/* WhatsApp (Meta WhatsApp Business Cloud API) and email.

   Email goes through PHP's mail(), which on the server hands it to msmtp,
   configured with the clinic's SMTP provider (runbook, "Email"). Each has a
   "log" driver for development, which writes what would have been sent to
   the PHP error log, and "off", which records the message as skipped.
   Production requires the real drivers or "off" (Config). */
declare(strict_types=1);

namespace Rayhab;

class Messaging
{
    public function __construct(private Config $cfg) {}

    /** @return array{id:?string,skipped:bool} */
    public function whatsapp(string $to, string $template, array $params, ?string $linkToken): array
    {
        $driver = $this->cfg->get('WHATSAPP_DRIVER');
        if ($driver === 'off') return ['id' => null, 'skipped' => true];
        if ($driver === 'log') {
            // In development the link is printed, so the payment page can be opened from the log.
            $link = $linkToken === null ? 'no' : ($this->cfg->env() === 'development'
                ? rtrim($this->cfg->get('PUBLIC_ORIGIN'), '/') . '/payment/#t=' . $linkToken : 'yes');
            error_log('[whatsapp] to ' . substr($to, 0, 5) . '… ' . (Notify::TEMPLATES[$template] ?? $template) . ' ' . json_encode($params, JSON_UNESCAPED_UNICODE) . ' link: ' . $link);
            return ['id' => 'log-' . time(), 'skipped' => false];
        }
        $components = [];
        if ($params) $components[] = ['type' => 'body', 'parameters' => array_map(static fn($t) => ['type' => 'text', 'text' => (string) $t], $params)];
        // The approved template's URL button is https://dr-rayhab.com/payment/#t={{1}}; the token is its suffix.
        if ($linkToken !== null) $components[] = ['type' => 'button', 'sub_type' => 'url', 'index' => '0', 'parameters' => [['type' => 'text', 'text' => $linkToken]]];
        $r = HttpClient::json('POST', 'https://graph.facebook.com/' . $this->cfg->get('WA_GRAPH_VERSION') . '/' . $this->cfg->get('WA_PHONE_NUMBER_ID') . '/messages',
            ['Authorization' => 'Bearer ' . $this->cfg->get('WA_TOKEN')],
            ['messaging_product' => 'whatsapp', 'to' => ltrim($to, '+'), 'type' => 'template',
             'template' => ['name' => Notify::TEMPLATES[$template] ?? $template, 'language' => ['code' => $this->cfg->get('WA_LANG')], 'components' => $components]]);
        if ($r['status'] === 0) throw new SendError('WhatsApp unreachable: ' . $r['error'], true);
        if ($r['status'] < 200 || $r['status'] >= 300) {
            throw new SendError('WhatsApp ' . $r['status'] . ': ' . ($r['json']['error']['message'] ?? 'error'), $r['status'] === 429 || $r['status'] >= 500);
        }
        return ['id' => $r['json']['messages'][0]['id'] ?? null, 'skipped' => false];
    }

    /** @return array{id:?string,skipped:bool} */
    public function email(string $to, string $subject, string $text, ?string $replyTo = null): array
    {
        $driver = $this->cfg->get('EMAIL_DRIVER');
        if ($driver === 'off') return ['id' => null, 'skipped' => true];
        if ($driver === 'log') {
            error_log('[email] to ' . $to . ': ' . $subject);
            return ['id' => 'log-' . time(), 'skipped' => false];
        }
        $headers = ['From' => $this->cfg->get('EMAIL_FROM'), 'Content-Type' => 'text/plain; charset=UTF-8', 'MIME-Version' => '1.0'];
        if ($replyTo && filter_var($replyTo, FILTER_VALIDATE_EMAIL)) $headers['Reply-To'] = $replyTo;
        $ok = mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $text, $headers);
        if (!$ok) throw new SendError('mail() could not hand the message to msmtp', true);
        return ['id' => 'mail-' . time(), 'skipped' => false];
    }
}
