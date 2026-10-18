<?php
/* The patient's secure link: https://dr-rayhab.com/payment/#t={token}.
   256 random bits, stored only as a SHA-256 hash, scoped to one
   appointment, expiring. Issuing a new link revokes the previous one. */
declare(strict_types=1);

namespace Rayhab;

final class Links
{
    public function __construct(private Db $db, private Config $cfg) {}

    public function issue(string $appointmentId, \DateTimeInterface $startsAt): string
    {
        $t = Util::token();
        // LINK_TTL_DAYS, and never beyond the day after the appointment.
        $expires = min(time() + $this->cfg->int('LINK_TTL_DAYS') * 86400, $startsAt->getTimestamp() + 86400);
        $this->db->query('update rayhab.payment_links set revoked_at = now() where appointment_id = ? and revoked_at is null', [$appointmentId]);
        $this->db->query('insert into rayhab.payment_links (token_hash, appointment_id, expires_at) values (?, ?, to_timestamp(?))',
                         [Util::sha256($t), $appointmentId, $expires]);
        return $t;
    }

    public function revoke(string $appointmentId): void
    {
        $this->db->query('update rayhab.payment_links set revoked_at = now() where appointment_id = ? and revoked_at is null', [$appointmentId]);
    }

    /* The appointment a token opens, or why it does not. */
    public function resolve(string $t): string
    {
        $invalid = new ApiError(404, 'link_invalid', 'This link is not recognized.');
        if (!preg_match('/^[A-Za-z0-9_-]{20,128}$/', $t)) throw $invalid;
        $row = $this->db->one('select appointment_id, (revoked_at is not null or expires_at < now()) as gone
                                 from rayhab.payment_links where token_hash = ?', [Util::sha256($t)]);
        if (!$row) throw $invalid;
        if ($row['gone'] === true || $row['gone'] === 't' || $row['gone'] === 1) throw new ApiError(410, 'link_expired', 'This link has expired.');
        $this->db->query('update rayhab.payment_links set last_used_at = now() where token_hash = ?', [Util::sha256($t)]);
        return $row['appointment_id'];
    }
}
