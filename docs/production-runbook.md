# Going live on dr-rayhab.com: the runbook

This takes the site from the GitHub Pages preview to the production setup.

| Part | What it is |
|---|---|
| Server | A Linux VPS running Nginx |
| Booking API and worker | Docker containers on that server |
| Database and staff sign-in | Supabase |
| Messaging and payments | WhatsApp, email and Whish |

Everything that can be prepared in code is already in this repository:

- **`server/`:** the API and the worker, tested.
- **`infra/`:** the server, Nginx and Docker setup.
- **`.github/workflows/`:** CI, plus a deploy workflow that runs only by hand, with approval.

The steps below are the ones that need you: accounts, payments, DNS and secrets.

Do them in order. Each step ends with a **check**. Allow about a day of work, plus waiting time for Meta to approve the WhatsApp templates and for Whish to grant merchant access.

```text
Patients / staff ──HTTPS──> Nginx on the VPS ──> site files (static)
                                  │
                                  └── /api/* ──> API container (127.0.0.1:3000) ──> Supabase (PostgreSQL + Auth)
                                                 worker container ──> WhatsApp, email, Whish
```

> Nothing here is legal advice. Before real patient data goes in, finish the open legal items in README.md ("Launch blockers"). In particular, review where the data is hosted under Lebanon's Law 81/2018.

---

## 1. Accounts you need

| Service | Why | Plan |
|---|---|---|
| A VPS provider (Hetzner Cloud or DigitalOcean) | The server | 2 vCPU, 4 GB RAM, 80 GB SSD, Ubuntu 24.04 LTS, in Frankfurt. About US$10–25 a month. |
| Supabase | Database, staff sign-in | **Pro** (daily backups, never pauses). Two projects: production and staging. |
| Meta Business + WhatsApp Business Platform | Patient messages | Free to set up; per-message fees apply. |
| An email provider with SMTP (Postmark, Resend or Amazon SES) | Staff alerts, website questions | The free tier is enough to start. |
| Whish Money merchant account | Online payments | Ask Whish for merchant API documentation and sandbox access. |
| The registrar where `dr-rayhab.com` is registered | DNS | |

**Use the same region.** Put the VPS and Supabase in the same region (Frankfurt), so every database call is fast. **Check:** the Supabase project's region reads "Central EU (Frankfurt)".

## 2. The server

1. **Create the server.** Ubuntu 24.04 LTS, 2 vCPU / 4 GB, Frankfurt, and add your SSH public key.
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
- Docker
- Nginx and Let's Encrypt certificates for all three names
- a `deploy` user for CI
- `/srv/rayhab/{production,staging}`

It asks you to choose a password for the staging site.

**Check:**

- `https://dr-rayhab.com` shows "Coming soon." with a valid padlock.
- `https://staging.dr-rayhab.com` asks for the staging password.
- `sudo ufw status` lists only OpenSSH and Nginx Full.

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

### 5.8 Turn on backups

On Pro, daily backups are automatic. Consider the Point-in-Time Recovery add-on for production.

After the first deploy (step 10), link the staff account to the practitioner record in the SQL Editor:

```sql
update rayhab.practitioners
   set auth_user_id = 'PASTE-THE-UID', email = 'rayan@dr-rayhab.com'
 where id = 'pr-rayan';
```

**Check:** in step 10, signing in at `/admin/` asks for the password, then shows an authenticator QR code the first time.

## 6. WhatsApp

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

If Meta refuses a `#` in the button URL, use `https://dr-rayhab.com/payment/?t={{1}}`. The payment page moves the token out of the address bar, and Nginx keeps it out of its logs.

### 6.5 Turn sending on

Once all templates are approved, set `WHATSAPP_DRIVER=cloud`. Until then keep `off`: requests still work, and no messages go out. The admin's Requests list still shows everything, but patients won't receive approval links, so the clinic would have to send them by hand.

**Check:** a test request from your own phone number receives "rayhab_request_received". In the database, `select template, status, delivery_status from rayhab.notification_outbox order by id desc limit 5;` shows `sent` / `delivered`.

## 7. Whish

1. **Ask Whish for the merchant documentation.** You need their merchant API documentation and **sandbox** credentials, covering:
   - how to create a payment or hosted checkout, with a return URL;
   - how their callback is authenticated (signature or token);
   - how to query a payment's status;
   - the currencies, fees and refund rules.
2. **Implement the driver.** A developer fills in `realWhish()` in `server/src/integrations/whish.ts`, following the comments there, and adds tests. The rest of the payment flow is already built and tested against the sandbox stand-in.
3. **Until then, keep Whish disabled.** In production, keep `WHISH_DRIVER=disabled`: the payment page offers cash only. On staging, `WHISH_DRIVER=sandbox` lets you try the whole online flow with a stand-in checkout.

**Check:** on staging with the sandbox, paying shows "Verifying payment" and then "Payment received", and the admin shows "Paid · Whish".

## 8. The settings files on the server

For each environment, on the server, as root or with sudo:

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

Let the server pull the API image. Do this once, as `deploy`. You need a GitHub **classic token** with only `read:packages`:

```bash
sudo -u deploy docker login ghcr.io -u <your-github-username>
```

**Check:**

- `ls -l /srv/rayhab/*/app.env /srv/rayhab/*/migrate.env` shows `-rw-------`, owned by deploy.
- The API checks every value when it starts, and stops with a list of what is missing.

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

**Check:** **Actions > Server CI** is green for the latest commit. It runs the API's tests on PostgreSQL, builds the image, and checks the Nginx, Compose and shell files.

## 10. First deploy

1. **Staging first.** Go to **Actions > Deploy to the server > Run workflow > staging**. It builds the site and the image, then on the server:
   - migrates the database
   - starts the API and worker
   - checks `/api/health`
   - switches the site
   - smoke-tests

   It rolls itself back if the health check fails.
2. **Link the staff account.** Run the SQL at the end of step 5 on the staging project.
3. **Walk through it on `https://staging.dr-rayhab.com`:**
   1. Request an appointment with your own WhatsApp number.
   2. Sign in at `/admin/` and set up the authenticator.
   3. Approve the request. The WhatsApp message arrives with the link.
   4. Open the link, choose cash, and record the cash in the admin.
   5. Try the Whish sandbox.
   6. Propose a new time and answer it from the link.
4. **Then production.** Run the same workflow with **production** and approve it. Link the staff account on the production project.
5. **Check production:**
   - `https://dr-rayhab.com/api/health` shows `{"ok":true}`.
   - `curl -I http://dr-rayhab.com` and `curl -I https://www.dr-rayhab.com` each answer one 301 to `https://dr-rayhab.com/`.
   - A missing page answers 404 with the branded page.
   - The pages have **no** `noindex` tag.
   - The page source has no `rayhab-demo`.
   - [securityheaders.com](https://securityheaders.com) shows the CSP, nosniff and referrer policy.
6. **Turn on HSTS.** When all of that holds, uncomment the `Strict-Transport-Security` line in `/etc/nginx/sites-available/dr-rayhab.com` and run `sudo nginx -t && sudo systemctl reload nginx`.

## 11. Prices and policy text

Prices are in minor units for USD (`8000` = $80) and whole pounds for LBP. Set them in the SQL Editor:

```sql
update rayhab.services set price_amount = 8000, currency = 'USD' where id in ('assessment', 'pain');
update rayhab.services set price_amount = 6000, currency = 'USD' where id in ('follow', 'online', 'sports', 'pain-follow');
```

The admin will not approve a request for a service without a price, so the patient always sees what they will pay.

The cash and Whish wording on the payment page, and the payment deadline, come from `POLICY_CASH_TEXT`, `POLICY_WHISH_TEXT` and `PAYMENT_DEADLINE_HOURS` in `app.env`. Set them to the clinic's actual policy, then restart the API (step 12, "Restart").

Opening hours live in `rayhab.working_hours` (weekday 0 is Sunday; times are Beirut time). The seed copies today's pattern: closed Sunday and Wednesday, Saturday mornings only. One-off closures (holidays, training) are better done from the admin's **Calendar > Block time**.

## 12. Running it

**Logs**

```bash
cd /srv/rayhab/bin && docker compose -p rayhab-production --env-file ../production/compose.env -f compose.yaml logs -f --tail 100
```

**Restart** after changing `app.env`:

```bash
cd /srv/rayhab/bin && docker compose -p rayhab-production --env-file ../production/compose.env -f compose.yaml up -d --force-recreate
```

**Monitoring**

- Add an uptime monitor (UptimeRobot or Better Stack, free) on `https://dr-rayhab.com/api/health`, alerting by email.
- Check messages that could not be delivered once a week:

  ```sql
  select id, template, last_error, created_at from rayhab.notification_outbox where status = 'dead' order by id desc;
  ```

**Updates**

- The server installs security updates by itself.
- Deploy new versions with the Deploy workflow.
- Docker images keep the last versions, so a rollback is:

  ```bash
  sudo -u deploy /srv/rayhab/bin/deploy.sh production ghcr.io/ronimassoud/rayhab-movement-clinic-server:<previous-tag> <a site tarball>
  ```

  Or re-run the workflow from an older tag.

**Database changes** only ever add, never rename or drop, in the same release, so a rollback of the API keeps working on the newer schema.

**Secrets**

- Change `APP_SECRET`, `WA_TOKEN` or the database passwords by editing `app.env` / `migrate.env`, then restarting (above).
- Changing `APP_SECRET` signs out every staff member and invalidates links already in messages sent but not yet delivered.

**Backups**

- Supabase keeps daily backups on Pro.
- Restore a copy into the staging project once a quarter, so you know a restore works.

**Staff**

- Add staff in Supabase Auth.
- Then insert a practitioner row with their `auth_user_id`:
  - `role` is `admin`, `practitioner` or `reception`; reception cannot block times.
  - `bookable = false` for staff who do not see patients.

## 13. Before real patients use it

Go through README.md, "Launch blockers":

- the privacy policy and booking terms approved and published;
- the booking consent wording updated to name the processors, which are now Supabase, Meta and the email provider. When it changes, also change `CONSENT_VERSION` in `site/assets/js/booking.js`;
- the clinic email;
- the address and opening hours;
- the payment policy;
- the clinical review of the articles;
- consent for case studies.
