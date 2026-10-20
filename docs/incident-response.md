# Incident response plan

**What this is for:** anything that may have exposed, changed or lost
patient data, or that stops the clinic taking bookings: a lost phone with
the admin open, a leaked password or key, a message sent to the wrong
person, a published photo whose consent was withdrawn, a server break-in,
or a provider telling us *they* were breached.

**How to use it:** follow the first-hour steps in order, then the playbook
that fits. Write everything down as you go (section 7). When in doubt, treat
it as an incident: a false alarm costs an hour, and a missed breach can cost
far more.

Commands and paths refer to `docs/production-runbook.md`. Items marked
**[DECIDE]** need the clinic's answer, and **[LEGAL]** its legal adviser's,
before launch. Nothing here is legal advice.

---

## 1. People

| Role | Who | Reach them by |
|---|---|---|
| **Incident lead:** decides, keeps the log, speaks for the clinic | **[DECIDE]** (normally Dr. Rayan Halimeh) | **[DECIDE]** |
| **Technical lead:** contains and investigates; has server and Supabase access | **[DECIDE]** (whoever runs the server) | **[DECIDE]** |
| **Backup technical contact** | **[DECIDE]** | **[DECIDE]** |
| **Legal adviser:** decides who must be told, and when | **[DECIDE]** | **[DECIDE]** |

Keep this table, with phone numbers, somewhere you can reach without the
admin or the server, such as a printed page or a shared note.

**Providers**, through their own dashboards (you need to be signed in):

| Provider | Holds | Where to report or get help |
|---|---|---|
| Supabase | The database and staff sign-in | Dashboard, **Support** |
| VPS host **[DECIDE]** | The server, logs, backups | Its control panel's support |
| Resend | Staff notice emails | Dashboard, **Help** |
| Meta (WhatsApp Business) | Patient numbers and messages | Meta Business Suite, **Help** |
| GitHub | The code, the deploy workflow and its secrets | github.com/support |
| Whish (once online payment is on) | Payments | Its merchant contact **[DECIDE]** |

## 2. How serious is it?

| Level | Examples | Act |
|---|---|---|
| **1: Breach likely** | Someone outside the clinic saw or downloaded patient data; a database password or the server is compromised; backups were exposed | Now, whatever the hour |
| **2: Breach possible** | A lost phone or laptop that was signed in to the admin; a leaked key that may not have been used; repeated "sign-in attempts blocked" emails; a message to the wrong number | Within a few hours |
| **3: No data exposed** | The site or the worker is down (`/api/health/worker` answers 503); a failed backup; a provider outage | The same working day |

Start at the higher level if unsure; move down once the facts allow.

## 3. The first hour, any incident

1. **Open the incident log** (section 7). Write the time, who noticed, and
   what they saw.
2. **Tell the incident lead and the technical lead.**
3. **Preserve evidence before changing anything.** Logs on the server are
   deleted after 14 days, so copy them now:

   ```bash
   sudo tar czf /root/incident-$(date -u +%Y%m%dT%H%MZ).tgz /var/log/apache2/rayhab /var/log/rayhab
   ```

   Copy the file off the server (`scp`), then delete it from the server.
   It contains IP addresses and request details, so keep it in encrypted
   storage, share it only with the people investigating, and delete it
   when the incident is closed.

   In Supabase, look at the **Logs** (Auth and Postgres) while they are still
   there: the Free plan keeps them only a short time. Export or screenshot
   what matters.
4. **Contain** with the matching playbook (section 4). Prefer steps that can
   be undone: signing everyone out, or taking the API offline, loses nothing.
5. **Do not** delete records, wipe the server or contact anyone outside the
   clinic yet, except a provider whose help you need to contain it. Who to
   tell is decided in section 5.

### Containment switches

| To | Do this | Undo |
|---|---|---|
| Sign every staff member out | SQL Editor: `delete from rayhab.staff_sessions; delete from rayhab.auth_pending;` | They sign in again |
| Lock one staff account | SQL Editor: `update rayhab.practitioners set active = false where id = '<id>';` (it also ends their sessions). Then in Supabase **Authentication > Users**, reset their password, or delete the user | `active = true`; for a deleted user, create them again and link them (runbook step 5) |
| Take the API offline (the pages stay up; the forms say something went wrong and point people to WhatsApp, and the admin can't sign in) | `sudo systemctl stop "$(cat /srv/rayhab/bin/fpm-service)"` and `sudo mv /etc/cron.d/rayhab /root/rayhab.cron` | `sudo mv /root/rayhab.cron /etc/cron.d/rayhab` and `sudo systemctl start "$(cat /srv/rayhab/bin/fpm-service)"` |
| Take the whole site offline | `sudo a2dissite dr-rayhab.com && sudo systemctl reload apache2` | `sudo a2ensite dr-rayhab.com && sudo systemctl reload apache2` |
| Stop all patient messages | In `app.env`, `WHATSAPP_DRIVER=off`; `EMAIL_DRIVER=off` for staff email | Set them back |
| Cancel all payment links | SQL Editor: `update rayhab.payment_links set revoked_at = now() where revoked_at is null;` | Not undoable; patients need new links from the clinic |

## 4. Playbooks

### 4.1 A device with the admin open is lost or stolen, or a staff password may be known

1. Lock the account (containment switches). Sign everyone out if unsure
   whose device it was.
2. In Supabase, reset the password. Remove the person's authenticator: in
   the user's details if the dashboard offers it, otherwise delete and
   re-create the user and link it again (runbook step 5). The person enrolls
   a new authenticator at their next sign-in.
3. Check **Activity** in the admin, and `rayhab.events`, from when the device
   was lost: any approvals, cash records or schedule changes nobody
   remembers making?
4. Sessions last 12 hours at most, and every account needs the authenticator
   code, so a lost phone alone usually gives nothing more. A lost phone that
   *is* the authenticator, together with a known password, is level 1.

### 4.2 Repeated "sign-in attempts blocked" emails

1. One email is usually someone mistyping. Several within a day means someone
   is trying passwords.
2. Find the address in the access log:
   `sudo grep '/api/admin/login' /var/log/apache2/rayhab/production-access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head`
3. Block it on the server: `sudo ufw deny from <address>`.
4. Ask every staff member to confirm they still have their own authenticator,
   and to change their password if it is used anywhere else.

### 4.3 A secret leaked

A secret pasted into chat, email or a ticket, committed to git, or seen on a
screen share. Change the secret first, then work out whether anyone used it.
Removing it from git history does not help once it was pushed: treat it as
public.

| Secret | Change it | Then check |
|---|---|---|
| Database password, `rayhab_app` (`DATABASE_URL`) | Run `infra/supabase/setup.sql` with a new password (edit the copy you paste, not the repo file); update `DATABASE_URL` in the connect file; `push-settings.sh` | Supabase Postgres logs for connections not from the server |
| Database password, `postgres` (`DATABASE_MIGRATE_URL`) | Supabase **Database > Settings > Reset database password**; update the connect file; `push-settings.sh` | As above. This login can read and change everything: level 1 |
| `APP_SECRET` | Empty it in the connect file; `push-settings.sh` makes a new one | It signs everyone out, and payment links in messages not yet delivered stop working |
| Resend API key | Resend **API Keys**: create a new one, delete the old; update the connect file; `push-settings.sh` | Resend's sending log for emails the clinic did not send |
| WhatsApp token (`WA_TOKEN`) | Meta Business **System users**: generate a new token; edit `app.env` by hand | WhatsApp Manager for messages the clinic did not send |
| Whish keys | Whish merchant settings **[DECIDE]**; edit `app.env` | Whish transactions |
| Deploy key (GitHub `DEPLOY_SSH_KEY`) | Remove its line from `/home/deploy/.ssh/authorized_keys`; make a new key pair (runbook step 9) | `sudo last`, `/var/log/auth.log`, and GitHub Actions runs nobody started |
| Backup private key (`rayhab-backup-key.txt`) | Make a new key; put the public half in `BACKUP_RECIPIENT`; `push-settings.sh` | Where existing backup copies are stored: anyone with them and the old key can read them, so delete the old copies |
| The Supabase anon key | Public by design: no action needed unless it was the **service_role** key, which the clinic never uses. If that leaked, rotate the project's API keys in Supabase | |

### 4.4 The server may be broken into

Level 1. Signs include unknown logins in `sudo last`, files changed outside a
deploy, unknown processes, or the host reporting abuse from the server.

1. Take the site offline (containment switches), but do not delete anything.
2. Ask the VPS host for a **snapshot** of the server as it is: that is the
   evidence.
3. Change **every** secret in 4.3: the server could read them all.
4. Build a **new** server from `infra/scripts/provision.sh` (runbook step 4)
   and deploy to it. Never clean up and reuse a compromised server.
5. The database lives at Supabase, not on the server, but the server held
   its password: check Supabase's logs for what that login did.
6. The 14 nightly backups on the server: if they were encrypted
   (`BACKUP_RECIPIENT` set), the attacker could not read them; if not, treat
   them as exposed.

### 4.5 A message or email went to the wrong person, or said too much

Examples: a patient's phone number was mistyped, so their booking messages
went to someone else; a decline reason included medical details.

1. Find what was sent: SQL Editor,
   `select template, recipient, payload, sent_at from rayhab.notification_outbox where appointment_id = '<id>' order by id;`
2. Correct the number on the booking, and revoke its payment link if one was
   sent:
   `update rayhab.payment_links set revoked_at = now() where appointment_id = '<id>' and revoked_at is null;`
3. Usually level 2: one person, limited details. Record it, and let the
   adviser decide whether the patient must be told (section 5).

### 4.6 A published case study must come down

Consent withdrawn, the wrong photo, or a name that should not be there.

1. Remove the case from `site/results.html` (and its images from
   `site/assets/img/cases/`), then "merge and deploy": staging updates in
   minutes, and production at its next deploy, which you run straight away.
2. The images stay in the public repository's history and in search engine
   caches. Ask the developer to purge them from the history (or make the
   repository private), and use Google's **Remove outdated content** tool for
   the cached copies.
3. Record the date of the request and of each removal; confirm to the
   patient when it is done.

### 4.7 A provider tells us they had a breach

1. Read their notice for what was affected, and whether the clinic's project,
   account or data is named.
2. Do what they advise (usually rotate the keys: 4.3).
3. Treat it as level 2 until it is clear whether clinic data was involved,
   and go through section 5 with the adviser.

### 4.8 Data lost or damaged

1. Take the API offline, so nothing more changes.
2. On the Free plan the server's nightly backups are the only copies: restore
   the latest good one into the **staging** project first, check it, then
   into production (runbook step 5.8). On Pro, Supabase's backups also work.
3. Bookings made since that backup are missing: list them from the staff
   notice emails and WhatsApp history, and contact those patients.

### 4.9 The site or worker is down (level 3)

1. `https://dr-rayhab.com/api/health` failing: the API or the database.
   Check `sudo tail -50 /var/log/apache2/rayhab/production-error.log` and the
   Supabase status page; a paused Free project is restored from the
   dashboard.
2. `/api/health/worker` answering 503: the cron worker has stopped, so
   messages, reminders and expiring holds are all waiting. Check
   `/var/log/rayhab/worker-production.log`, and that `/etc/cron.d/rayhab`
   exists.
3. Run the doctor (runbook step 8.4).

## 5. Who must be told **[LEGAL]**

The adviser decides, case by case, using the incident log. The questions
they will ask:

- Whose data, how many people, and which details: contact details only, or
  health information (notes, questions, case photos)?
- Was it seen, copied, changed or lost? Is it still exposed?
- Was it encrypted or otherwise unreadable to whoever got it?

**To settle before launch, with the adviser:**

| Who | When it applies | Deadline |
|---|---|---|
| Lebanon's Ministry of Economy and Trade, or another authority under Law 81/2018 | **[LEGAL]** | **[LEGAL]** |
| An EU supervisory authority, if GDPR applies (online patients in the EU) | A breach likely to put people at risk | 72 hours from becoming aware, under GDPR |
| The affected patients | When there is a real risk to them; always worth considering for health data | **[LEGAL]**: without undue delay |
| Processors (Supabase, Resend, Meta, the host) | When their systems were involved | As their terms require |

### Wording for patients (adapt with the adviser)

> We are writing to let you know about a problem that affected your details
> held by Rayhab Movement Clinic. On [date], [what happened, in one
> sentence]. This involved your [which details]. [What we have done]. [What
> you may want to do, if anything]. If you have questions, contact
> [name] at [contact]. We are sorry this happened.

Send it from the clinic, by the channel the patient uses with the clinic,
and record when each one was sent.

## 6. Closing an incident

1. **Back to normal:** undo the containment switches once the cause is fixed.
2. **Review within two weeks:** what happened, why, what worked, what didn't.
   Fix the cause, not just the symptom, and update this plan and the runbook.
3. **Delete** the evidence copies (section 3, step 3) once the adviser agrees
   they are no longer needed.
4. **Close the log** with the date and who closed it.

Once a year, walk through one scenario on paper (4.1 is a good first one)
with the people in section 1, and update the contacts.

## 7. Incident log

One per incident, kept with the clinic's records (not in this repository, as
it may name patients):

```
Incident:            short name, date opened
Level:               1 / 2 / 3, and any changes with the reason
Noticed by, when:
Timeline:            time (with time zone), what was seen or done, by whom
Data involved:       which records or kinds of data; how many people
Containment:         which switches, when
Evidence kept:       what, where, who has access
Cause:
Notifications:       who was told, when, how, and the adviser's reasoning,
                     including decisions not to notify
Closed:              date, by whom; review notes
```
