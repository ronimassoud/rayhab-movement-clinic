<?php
/* Outgoing HTTPS calls (Supabase Auth, WhatsApp, Whish), through curl. */
declare(strict_types=1);

namespace Rayhab;

final class HttpClient
{
    /**
     * @param array<string,string> $headers
     * @return array{status:int,json:array<string,mixed>,error:string}
     */
    public static function json(string $method, string $url, array $headers = [], mixed $body = null, int $timeout = 15): array
    {
        $ch = curl_init($url);
        $h = ['Accept: application/json'];
        foreach ($headers as $k => $v) $h[] = $k . ': ' . $v;
        $opts = [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout,
                 CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_FOLLOWLOCATION => false];
        if ($body !== null) {
            $opts[CURLOPT_POSTFIELDS] = is_string($body) ? $body : json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $h[] = 'Content-Type: application/json';
        }
        $opts[CURLOPT_HTTPHEADER] = $h;
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = $raw === false ? curl_error($ch) : '';
        curl_close($ch);
        $json = is_string($raw) ? json_decode($raw, true) : null;
        return ['status' => $raw === false ? 0 : $status, 'json' => is_array($json) ? $json : [], 'error' => $error];
    }
}
