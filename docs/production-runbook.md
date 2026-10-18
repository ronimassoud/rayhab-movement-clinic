# Going live on dr-rayhab.com: the runbook

This takes the site from the GitHub Pages preview to the production setup.

| Part | What it is |
|---|---|
| Server | A Linux VPS: Ubuntu Server 26.04 LTS, Apache 2 and certbot |
| Booking API | Plain PHP under Apache (PHP-FPM); a cron job every minute does the background work |
| Database and staff sign-in | Supabase |
| Messaging and payments | WhatsApp, email and Whish |

Everything that can be prepared in code is already in this repository:

- **`api/`:** the PHP API and its worker, tested.
- **`infra/`:** the Apache sites, PHP settings, cron job, and the setup and deploy scripts.
- **`.github/workflows/`:** CI, plus a deploy workflow that runs only by hand, with approval.

The steps below are the ones that need you: accounts, payments, DNS and secrets.

Do them in order. Each step ends with a **check**. Allow about a day of work, plus waiting time for Meta to approve the WhatsApp templates and for Whish to grant merchant access.

```text
Patients / staff ──HTTP 80──> Apache: 301 to HTTPS
                 ──HTTPS 443──> Apache on the VPS ──> site files (static)
                                     │
                                     └── /api/* ──> PHP-FPM: api/public/index.php ──> Supabase (PostgreSQL + Auth)
                                                    cron, every minute: bin/worker.php ──> WhatsApp, email (msmtp), Whish
```

> Nothing here is legal advice. Before real patient data goes in, finish the open legal items in README.md ("Launch blockers"). In particular, review where the data is hosted under Lebanon's Law 81/2018.

---

## 1. Accounts you need

| Service | Why | Plan |
|---|---|---|
| A VPS provider (Hetzner Cloud or DigitalOcean) | The server | 2 vCPU, 2–4 GB RAM, 40–80 GB SSD, Ubuntu Server 26.04 LTS, in Frankfurt. About US$5–25 a month. |
| Supabase | Database, staff sign-in | **Free** to start: two projects (production and staging) fit the free limit. Upgrade production to **Pro** later, for Supabase's own daily backups and no pausing (see 5.8). |
| Meta Business + WhatsApp Business Platform | Patient messages | Free to set up; per-message fees apply. |
| Resend | Staff alerts (new requests, new website questions), by SMTP | **Free**: 3,000 emails a month, 100 a day, one sending domain. The clinic's notices are a handful a day. |
| Whish Money merchant account | Online payments | Ask Whish for merchant API documentation and sandbox access. |
| The registrar where `dr-rayhab.com` is registered | DNS | |

**Use the same region.** Put the VPS and Supabase in the same region (Frankfurt), so every database call is fast. **Check:** the Supabase project's region reads "Central EU (Frankfurt)".

## 2. The server

1. **Create the server.** Ubuntu Server 26.04 LTS, 2 vCPU, Frankfurt, and add your SSH public key.
2. **Note its addresses.** Write down the IPv4 address (and IPv6, if any).
3. **Sign in.** `ssh root@<ip>`, then create your own admin user with sudo:

   ```bash
   adduser roni && usermod -aG sudo roni && rsync -a ~/.ssh /home/roni/ && chown -R roni:roni /home/roni/.ssh
   ```

**Check:** `ssh roni@<ip>` works, and `sudo -v` asks for your password.

## 3. DNS

At the registrar, point these records at the server:

| Name | Type | Value |
|---|---|---|
| `dr-rayhab.com` | A | the server IPv4 |
| `www.dr-rayhab.com` | A | the server IPv4 |
| `staging.dr-rayhab.com` | A | the server IPv4 |
| (the same three) | AAAA | the server IPv6, if it has one |

**Check:** `dig +short dr-rayhab.com` and `dig +short staging.dr-rayhab.com` both print the server's IP. It can take an hour.

## 4. Provision the server

On the server, as your admin user:

```bash
git clone https://github.com/ronimassoud/rayhab-movement-clinic.git ~/rayhab && cd ~/rayhab
sudo ADMIN_EMAIL=you@example.com bash infra/scripts/provision.sh
```

The script sets up:

- updates
- the firewall (ports 22, 80 and 443 only)
- SSH with keys only, and no root login
- fail2ban
- Apache 2 with HTTP/2 and TLS, and PHP-FPM with the API's extensions
- Let's Encrypt certificates for all three names (certbot), renewed automatically
- msmtp, for outgoing email
- the cron worker
- a `deploy` user for CI
- `/srv/rayhab/{production,staging}`

It asks you to choose a password for the staging site.

**Check:**

- `https://dr-rayhab.com` shows "Coming soon." with a valid padlock.
- `https://staging.dr-rayhab.com` asks for the staging password.
- `http://dr-rayhab.com` redirects to `https://dr-rayhab.com`.
- `sudo ufw status` lists only OpenSSH and Apache Full.

## 5. Supabase

Do this for the **production** project, then again for **staging**.

### 5.1 Create the project

Region: Central EU (Frankfurt). Choose a strong database password and keep it in your password manager.

### 5.2 Enable the extension

Go to **Database > Extensions** and enable **btree_gist**. It is what makes double booking impossible at the database level.

### 5.3 Create the API's database role

In the SQL Editor, run this with a new strong password:

```sql
create role rayhab_app login password 'REPLACE-WITH-A-LONG-RANDOM-PASSWORD';
grant usage on schema extensions to rayhab_app;
```

The first deploy's migration grants this role access to the `rayhab` tables. The role can read and write data, but it cannot change the schema.

### 5.4 Keep the data private

Go to **Settings > API** and leave **Exposed schemas** as `public` only. Never add `rayhab`: the browser must never reach these tables. Nothing in the site uses Supabase's Data API.

### 5.5 Collect the connection strings

Go to **Connect > Session pooler**:

- **For `app.env`:** take the **session pooler** URL (port 5432) and replace the user with `rayhab_app.<project-ref>` and its password.
- **For `migrate.env`:** take the same URL with the `postgres` user and the database password.

### 5.6 Set up Auth

- Go to **Authentication > Providers > Email**. Keep email sign-in on, and turn **off** "Allow new users to sign up".
- Go to **Authentication > Users > Add user**, and create the staff account (for example Dr. Rayan Halimeh's work email) with a strong password.
- Copy the user's **UID**.
- Make sure the TOTP authenticator option is enabled. The admin requires it on every sign-in.

### 5.7 Find the API keys

Under **Settings > API**, take the **Project URL** and the **anon** key, for `SUPABASE_URL` and `SUPABASE_ANON_KEY`. They are used only by the server.

### 5.8 Backups and pausing (Free plan)

The Free plan keeps **no backups**. Until you upgrade, the server makes its own:

- Every night it dumps the `rayhab` schema to `/srv/rayhab/backups/<env>/` (`infra/scripts/backup.sh`, run by cron), compressed and readable only by `deploy`.
- It keeps the last 14 dumps.
- Copy one off the server now and then (step 12).

To restore a dump into a project, for example to try it on staging:

```bash
gunzip -c /srv/rayhab/backups/production/<file>.sql.gz | psql "<the staging project's postgres connection URL>"
```

Free projects are also **paused after a week without activity**. The cron worker queries the database every minute, which should keep it active. Still, check the project's status in the dashboard during the first weeks; a paused project is restored from the dashboard in a few minutes, and the site shows its "not available" messages meanwhile.

**When you upgrade production to Pro:** Supabase's daily backups start (keep the nightly dump too if you like a copy on your own server). Pausing no longer applies. Point-in-Time Recovery is an optional add-on. Nothing in the code or settings changes.

After the first deploy (step 10), link the staff account to the practitioner record in the SQL Editor:

```sql
update rayhab.practitioners
   set auth_user_id = 'PASTE-THE-UID', email = 'rayan@dr-rayhab.com'
 where id = 'pr-rayan';
```

**Check:** in step 10, signing in at `/admin/` asks for the password, then shows an authenticator QR code the first time.

## 6. Messages: email and WhatsApp

### 6.0 Email (Resend)

The API emails the clinic when a booking request or a website question arrives: a short notice with a link to the admin, never the patient's details. PHP hands the email to **msmtp**, which sends it through Resend's SMTP.

1. **Create the Resend account** (Free plan) and add the domain `dr-rayhab.com` under **Domains**.
2. **Verify the domain.** Resend shows the DNS records to add at the registrar: SPF (TXT), DKIM (TXT) and a return-path (MX). Optionally add DMARC too. Wait until Resend marks the domain verified. Until then it only sends to your own address.
3. **Create an API key** under **API Keys**, with **Sending access** only, for this domain. It is the SMTP password.
4. **Fill in msmtp.** Edit `/etc/msmtprc` on the server (`sudo nano /etc/msmtprc`). The provisioning script already set host `smtp.resend.com`, port 587 with STARTTLS and user `resend`. Replace `REPLACE-WITH-RESEND-API-KEY` with the key. The file is readable only by root and the web server.
5. **Turn sending on.** In `app.env`, set:
   - `EMAIL_DRIVER=mail`;
   - `EMAIL_FROM` to an address on the verified domain, for example `Rayhab bookings <bookings@dr-rayhab.com>`;
   - `STAFF_EMAILS` to who receives the notices, comma-separated.

**Check:** `echo "test" | sudo -u www-data msmtp you@example.com` delivers, and `/var/log/rayhab/msmtp.log` shows it sent.

### 6.1 Get a sender number

In **Meta Business Suite**, create (or use) the clinic's business, then add **WhatsApp** in Meta for Developers (an app of type Business). Register the clinic's sending number. It cannot also stay on the WhatsApp phone app.

### 6.2 Create a permanent token

Create a **System User** with the WhatsApp permissions and generate a **permanent token**. You now have the values for `app.env`:

| Value | `app.env` setting |
|---|---|
| The permanent token | `WA_TOKEN` |
| The Phone number ID | `WA_PHONE_NUMBER_ID` |
| The App secret (App settings > Basic) | `WA_APP_SECRET` |
| A random string you choose | `WA_VERIFY_TOKEN` |

### 6.3 Connect the webhook

Webhook URL: `https://dr-rayhab.com/api/webhooks/whatsapp`, with the verify token you chose. Subscribe to **messages**. Delivery receipts then appear in the outbox.

### 6.4 Submit the templates

All are category **Utility**, language **English** (`en`). Each must keep **exactly** this name and these variables. The wording can be adjusted, but keep the variables in order.

| Name | Body | Button |
|---|---|---|
| `rayhab_request_received` | Hello from Rayhab Movement Clinic. We have your request for {{1}} on {{2}} at {{3}} (Beirut time). This is a request, not yet a confirmed appointment; we will reply within one working day. | none |
| `rayhab_approved_choose_payment` | Good news: your {{1}} on {{2}} at {{3}} (Beirut time) is approved. Please choose how you would like to pay with the button below. The link is private to you. | URL, dynamic: `https://dr-rayhab.com/payment/#t={{1}}`, text "Choose how to pay" |
| `rayhab_request_declined` | Rayhab Movement Clinic: we are sorry, we cannot take your request for {{1}}. {{2}} You are welcome to request another time on our website. | none |
| `rayhab_new_time_proposed` | Rayhab Movement Clinic: the time you asked for {{1}} is not available. We can offer {{2}} at {{3}} (Beirut time). Please accept it or ask for another time with the button below. | URL, dynamic: as above, text "Answer" |
| `rayhab_appointment_cancelled` | Rayhab Movement Clinic: your {{1}} on {{2}} at {{3}} has been cancelled. Reply here if you have any questions. | none |
| `rayhab_payment_received` | Rayhab Movement Clinic: thank you, we have received your payment of {{1}} for {{2}} on {{3}}. See you soon. | none |
| `rayhab_appointment_reminder` | Reminder from Rayhab Movement Clinic: your {{1}} is on {{2}} at {{3}} (Beirut time), {{4}}. Wear clothes you can move in and bring any X-ray or report you have. | none |

If Meta refuses a `#` in the button URL, use `https://dr-rayhab.com/payment/?t={{1}}`. The payment page moves the token out of the address bar, and Apache keeps it out of its logs.

### 6.5 Turn sending on

Once all templates are approved, set `WHATSAPP_DRIVER=cloud`. Until then keep `off`: requests still work, and no messages go out. The admin's Requests list still shows everything, but patients won't receive approval links, so the clinic would have to send them by hand.

**Check:** a test request from your own phone number receives "rayhab_request_received". In the database, `select template, status, delivery_status from rayhab.notification_outbox order by id desc limit 5;` shows `sent` / `delivered`.

## 7. Whish

1. **Ask Whish for the merchant documentation.** You need their merchant API documentation and **sandbox** credentials, covering:
   - how to create a payment or hosted checkout, with a return URL;
   - how their callback is authenticated (signature or token);
   - how to query a payment's status;
   - the currencies, fees and refund rules.
2. **Implement the driver.** A developer fills in the `whish` branches of `createCheckout`, `fetchStatus` and `parseWebhook` in `api/src/Whish.php`, following the comments there, and adds tests. The rest of the payment flow is already built and tested against the sandbox stand-in.
3. **Until then, keep Whish disabled.** In production, keep `WHISH_DRIVER=disabled`: the payment page offers cash only. On staging, `WHISH_DRIVER=sandbox` lets you try the whole online flow with a stand-in checkout.

**Check:** on staging with the sandbox, paying shows "Verifying payment" and then "Payment received", and the admin shows "Paid · Whish".

## 8. The settings files on the server

For each environment, on the server:

```bash
sudo -u deploy nano /srv/rayhab/production/app.env      # fill in every value (see infra/env.example)
sudo -u deploy sh -c 'umask 077; echo "DATABASE_MIGRATE_URL=postgres://postgres.<ref>:<db-password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" > /srv/rayhab/production/migrate.env'
```

Generate `APP_SECRET` with `openssl rand -base64 48`. Use a different value for staging and for production.

Staging differences:

- `DEPLOY_ENV=staging`
- `PUBLIC_ORIGIN=https://staging.dr-rayhab.com`
- `WHISH_DRIVER=sandbox`
- its own Supabase project's values

**Who can read what:**

- `app.env` is mode 640, owner `deploy`, group `www-data`, so Apache's PHP and the cron worker can read it and nobody else.
- `migrate.env` is mode 600, `deploy` only. Just the deploy reads it, to run migrations as the schema owner.

**Check:**

- `ls -l /srv/rayhab/*/app.env /srv/rayhab/*/migrate.env` shows `-rw-r-----` (deploy www-data) and `-rw-------` (deploy).
- The API checks every value on each request, and answers 503 rather than run with anything missing or unsafe; the reason is in `/var/log/apache2/rayhab-production-error.log`.

## 9. GitHub

1. **Create a deploy key.** On your computer, `ssh-keygen -t ed25519 -f rayhab-deploy -N ""`. Add the `.pub` file's contents to `/home/deploy/.ssh/authorized_keys` on the server.
2. **Create the environments.** In the repository, go to **Settings > Environments** and create `staging` and `production`. On `production`, add **Required reviewers** (you), so nothing deploys there without your approval.
3. **Add the secrets** to each environment:

   | Secret | Value |
   |---|---|
   | `DEPLOY_SSH_KEY` | the private key file `rayhab-deploy` |
   | `DEPLOY_HOST` | the server IP or `dr-rayhab.com` |
   | `DEPLOY_KNOWN_HOSTS` | the output of `ssh-keyscan dr-rayhab.com` |
   | `STAGING_BASIC_AUTH` (staging only) | the staging password |

**Check:** **Actions > API CI** is green for the latest commit. It lints every PHP file, runs the API's tests on PostgreSQL 16, checks the Apache configuration with `apache2ctl -t`, and checks the shell scripts, the cron file and a deploy dry run.

## 10. First deploy

1. **Staging first.** Go to **Actions > Deploy to the server > Run workflow > staging**. It builds the site, runs the API's tests, copies both to the server, and there:
   - unpacks them into new release folders
   - migrates the database
   - switches the API to the new release and reloads PHP-FPM
   - checks `/api/health`
   - switches the site
   - smoke-tests

   If the health check fails it switches the API back, and the site stays as it was.
2. **Link the staff account.** Run the SQL at the end of step 5 on the staging project.
3. **Walk through it on `https://staging.dr-rayhab.com`:**
   1. Request an appointment with your own WhatsApp number.
   2. Sign in at `/admin/` and set up the authenticator.
   3. Approve the request. The WhatsApp message arrives with the link.
   4. Open the link, choose cash, and record the cash in the admin.
   5. Try the Whish sandbox.
   6. Propose a new time and answer it from the link.
   7. Send a question from the contact page; it appears in the admin's **Enquiries**, and the clinic's inbox gets a notice.
4. **Then production.** Run the same workflow with **production** and approve it. Link the staff account on the production project.
5. **Check production:**
   - `https://dr-rayhab.com/api/health` shows `{"ok":true}`.
   - `curl -I http://dr-rayhab.com` and `curl -I https://www.dr-rayhab.com` each answer one 301 to `https://dr-rayhab.com/`.
   - A missing page answers 404 with the branded page.
   - The pages have **no** `noindex` tag.
   - The page source has no `rayhab-demo`.
   - [securityheaders.com](https://securityheaders.com) shows the CSP, nosniff and referrer policy.
6. **Turn on HSTS.** When all of that holds, uncomment the `Strict-Transport-Security` line in `/etc/apache2/conf-available/rayhab.conf` and run `sudo apache2ctl configtest && sudo systemctl reload apache2`.

## 11. Prices and policy text

Prices are in minor units for USD (`8000` = $80) and whole pounds for LBP. Set them in the SQL Editor:

```sql
update rayhab.services set price_amount = 8000, currency = 'USD' where id in ('assessment', 'pain');
update rayhab.services set price_amount = 6000, currency = 'USD' where id in ('follow', 'online', 'sports', 'pain-follow');
```

The admin will not approve a request for a service without a price, so the patient always sees what they will pay.

The cash and Whish wording on the payment page, and the payment deadline, come from `POLICY_CASH_TEXT`, `POLICY_WHISH_TEXT` and `PAYMENT_DEADLINE_HOURS` in `app.env`. Set them to the clinic's actual policy. The API reads `app.env` on every request, so the change applies at once.

Opening hours live in `rayhab.working_hours` (weekday 0 is Sunday; times are Beirut time). The seed copies today's pattern: closed Sunday and Wednesday, Saturday mornings only. One-off closures (holidays, training) are better done from the admin's **Calendar > Block time**.

## 12. Running it

**Logs**

```bash
sudo tail -f /var/log/apache2/rayhab-production-error.log      # API errors (masked: no tokens, no patient details)
sudo tail -f /var/log/rayhab/worker-production.log             # what the cron worker did
sudo tail -f /var/log/apache2/rayhab-production-access.log     # requests (payment-link tokens are never logged)
```

**Settings** in `app.env` apply on the next request; there is nothing to restart. New code arrives only through a deploy.

**Monitoring**

- Add an uptime monitor (UptimeRobot or Better Stack, free) on `https://dr-rayhab.com/api/health`, alerting by email.
- Check messages that could not be delivered once a week:

  ```sql
  select id, template, last_error, created_at from rayhab.notification_outbox where status = 'dead' order by id desc;
  ```

**Updates**

- The server installs security updates by itself.
- Deploy new versions with the Deploy workflow.
- The server keeps the last five releases of the site and the API. To go back to the previous API by hand:

  ```bash
  ls /srv/rayhab/production/api/releases                     # pick the previous release
  sudo -u deploy ln -sfn /srv/rayhab/production/api/releases/<previous> /srv/rayhab/production/api/current
  sudo systemctl reload "$(cat /srv/rayhab/bin/fpm-service)"
  ```

  The site works the same way (`/srv/rayhab/production/site/current`). Or re-run the workflow from an older tag.

**Database changes** only ever add, never rename or drop, in the same release, so a rollback of the API keeps working on the newer schema.

**Secrets**

- Change `APP_SECRET`, `WA_TOKEN` or the database passwords by editing `app.env` / `migrate.env`; the SMTP password lives in `/etc/msmtprc`.
- Changing `APP_SECRET` signs out every staff member and invalidates links already in messages sent but not yet delivered.

**Backups**

- **On Free:** the nightly dumps in `/srv/rayhab/backups/` are the only backups, and they sit on the same server. Once a month, copy the newest one somewhere else (`scp deploy@dr-rayhab.com:/srv/rayhab/backups/production/<file> .`). The log is `/var/log/rayhab/backup.log`.
- **On Pro:** Supabase keeps daily backups as well.
- Either way, restore a copy into the staging project once a quarter (step 5.8), so you know a restore works.

**Limits on the free plans:**

| Plan | Limits | What it means here |
|---|---|---|
| Resend Free | 100 emails a day | Enough for the clinic's notices; a burst of spam questions would be refused by the API's rate limits first. |
| Supabase Free | 500 MB database | Years of bookings at this size. The dashboard shows usage under **Reports**. |

**Staff**

- Add staff in Supabase Auth.
- Then insert a practitioner row with their `auth_user_id`:
  - `role` is `admin`, `practitioner` or `reception`; reception cannot block times.
  - `bookable = false` for staff who do not see patients.

## 13. Before real patients use it

Go through README.md, "Launch blockers":

- the privacy policy and booking terms approved and published;
- the booking consent wording updated to name the processors, which are now Supabase, the VPS provider, Meta and the email provider. When it changes, also change `CONSENT_VERSION` in `site/assets/js/booking.js`;
- the clinic email;
- the address and opening hours;
- the payment policy;
- the clinical review of the articles;
- consent for case studies.
