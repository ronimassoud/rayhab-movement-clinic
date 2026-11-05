# Going live on dr-rayhab.com: the runbook

The site and the booking API are hosted on **Vercel** (decided 2026-11-05).

| Part | What it is |
|---|---|
| Hosting | Vercel, **Pro** plan: the site from Vercel's network, the PHP API as a serverless function in Dublin (the `vercel-php` runtime), and Vercel Cron running the worker every minute |
| Database and staff sign-in | Supabase (Ireland) |
| Email | Resend, through its API |
| Later (phase 2) | WhatsApp and Whish |
| Backups | A nightly, encrypted GitHub Actions job while Supabase is on the Free plan |

Everything that can be prepared in code is in this repository:

- **`vercel.json`:** the function, the `/api` route, the every-minute cron, the security headers and redirects.
- **`infra/vercel/`:** the build guard (no draft pages or demo mode in production), `push-env.mjs` (your settings into Vercel) and the config check CI runs.
- **`api/`:** the PHP API and its worker, tested; `api/dev/` has the tools you run from your computer (`migrate.mjs`, `check.mjs`, `doctor.mjs`, `subject.mjs`).
- **`.github/workflows/`:** CI for the API and the site, and the nightly backup. Vercel deploys from Git by itself.

Do the steps in order. Each ends with a **check**.

```text
Patients / staff ──HTTPS──> Vercel (dr-rayhab.com; www redirects to it)
                              ├── site/ pages, from Vercel's network
                              ├── /api/*  ──> PHP function api/public/index.php (Dublin) ──> Supabase (Ireland)
                              └── Vercel Cron, every minute: /api/cron/worker ──> Resend (email); later WhatsApp, Whish
GitHub Actions, nightly: encrypted dump of the production database (kept 14 days)
```

**Deploys:** a push to `main` deploys production; a push to `redesign-2.0` deploys staging (`staging.dr-rayhab.com`). Merge to `main` only on "merge and deploy".

## Launch phases (decided 2026-11-05)

**Phase 1, now: cash only, patients emailed.** Whish depends on a third party and is not ready, so:

- the payment page offers only "Pay at the clinic" (`WHISH_DRIVER=disabled`);
- every message to patients goes by email through Resend (`PATIENT_CHANNEL=email`); replies go to `CLINIC_EMAIL`;
- the flow: the patient requests, Rayan approves in the admin, the patient gets an email with a private link and confirms "I'll pay at the clinic" (Rayan gets an email), and at the visit Rayan presses **Confirm cash received** in the admin (Payments, or the appointment), which records the receipt and emails the patient.

Both are settings in the connect files (step 4); phase 1 is the default.

**Phase 2, later:** WhatsApp (step 6, then `PATIENT_CHANNEL=whatsapp`) and Whish (step 7, then `WHISH_DRIVER=whish`). No code changes for the switch beyond the Whish driver itself; update the privacy and terms pages' **[PHASE 2]** passages at the same time.

**Production waits for the legal sign-off.** The privacy notice and booking terms are drafts; the Vercel build refuses to publish production while any page is marked `data-draft` (step 13). Staging works in full meanwhile.

**Resend Free:** 100 emails a day. A booking sends about six (to the patient and to Rayan), so roughly 15 bookings a day; upgrade the Resend plan before that becomes tight.

**Your secrets live in one file per environment,** `infra/connect.production.env` and `infra/connect.staging.env`, on your computer. Git never commits them; never paste their values into chat or email. From them:

| Command | What it does |
|---|---|
| `node infra/vercel/push-env.mjs <env>` | puts the settings into Vercel (step 4) |
| `node api/dev/migrate.mjs <env>` | creates or updates the database tables (step 8) |
| `node api/dev/check.mjs <env> [--email you@x]` | checks Supabase and Resend |
| `node api/dev/doctor.mjs <env> [--email you@x]` | checks the whole live setup, including prices and the staff account |

> Nothing here is legal advice. Before real patient data goes in, finish the open legal items (step 13). In particular, review where the data is hosted under Lebanon's Law 81/2018.

---

## 1. Accounts you need

| Service | Why | Plan |
|---|---|---|
| Vercel | Hosting: the site, the API, the worker | **Pro** (about US$20 a month per member). Hobby is for non-commercial use only, and its cron runs once a day. |
| Supabase | Database, staff sign-in | **Free** to start: two projects (production and staging). Upgrade production to **Pro** later, for Supabase's own daily backups and no pausing (see 5.8). |
| Resend | Email to patients and to the clinic | **Free**: 3,000 emails a month, 100 a day. |
| GitHub | The code, CI, the nightly backup | Exists: `ronimassoud/rayhab-movement-clinic`. |
| The registrar of `dr-rayhab.com` | DNS | |
| Phase 2: Meta (WhatsApp Business Platform), Whish Money | Patient WhatsApp messages; online payments | Later. |

**One region.** The API runs in Vercel's Dublin region (`vercel.json`, `"regions": ["dub1"]`), next to the Supabase projects in Ireland (eu-west-1), so every database call is short.

## 2. The Vercel project

1. **Sign up at [vercel.com](https://vercel.com)** and create a team on the **Pro** plan.
2. **Import the repository:** **Add New > Project > Import Git Repository**. Give Vercel's GitHub app access to `ronimassoud/rayhab-movement-clinic` (sign in to GitHub as **ronimassoud**, the owner).
3. **At import:** Framework Preset **Other**, Root Directory `./`. Leave the build and output settings alone: `vercel.json` sets them. Don't add environment variables here (step 4 does). Click **Deploy**.
   - The first production build **fails on purpose** while the privacy and terms pages are drafts: "Not deploying to production: these pages are drafts awaiting legal review." That is the guard working.
4. **Settings > Git:** Production Branch `main`.
5. **Settings > Deployment Protection:** on Pro, preview deployments (staging) need a Vercel sign-in by default. Keep it; to let Rayan test staging without a Vercel account, create a **Shareable Link** there.

**Check:** **Settings > Functions** shows the region **Dublin (dub1)**, and **Settings > Cron Jobs** lists `/api/cron/worker`, every minute.

## 3. Domains and DNS

In the project, **Settings > Domains**:

| Domain | Set to |
|---|---|
| `dr-rayhab.com` | Production |
| `www.dr-rayhab.com` | Redirect to `dr-rayhab.com` (308) |
| `staging.dr-rayhab.com` | Git branch `redesign-2.0` (Preview) |

Vercel then shows the DNS records to add at the registrar: usually an **A** record for the apex and **CNAME** records for `www` and `staging`. Add exactly what it shows. **Keep the Resend records** (`resend._domainkey`, `send`) as they are. Certificates come automatically.

**Check:** each domain shows **Valid Configuration** in Vercel (DNS can take an hour). `https://dr-rayhab.com` will show Vercel's error page until production deploys (step 10); that's expected.

## 4. Your settings into Vercel

On your computer, in the repository folder (Git Bash or PowerShell):

```bash
npx vercel login
npx vercel link
node infra/vercel/push-env.mjs staging
node infra/vercel/push-env.mjs production
```

`vercel link` asks for the team and the project from step 2. `push-env.mjs` reads your connect file, checks it, generates `APP_SECRET` and `CRON_SECRET` the first time (and saves them back into the file), and sets each value in Vercel without printing it:

- **staging** goes to Preview deployments of the branch `redesign-2.0`;
- **production** goes to Production.

The database owner's login (`DATABASE_MIGRATE_URL`) never goes to Vercel: it stays on your computer, for migrations.

Vercel applies new values to the **next** deployment: after any change, **Deployments > ⋯ > Redeploy** (or push a commit).

**Check:** **Settings > Environment Variables** lists the same names for Production and for Preview (`redesign-2.0`): `DEPLOY_ENV`, `PUBLIC_ORIGIN`, `APP_SECRET`, `CRON_SECRET`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `EMAIL_DRIVER`, `RESEND_API_KEY`, `EMAIL_FROM`, `STAFF_EMAILS`, `PATIENT_CHANNEL`, `WHISH_DRIVER`, `WHATSAPP_DRIVER`, `AUTH_DRIVER`.

## 5. Supabase

Do this for the **production** project, then again for **staging**.

### 5.1 Create the project

Sign up at [supabase.com](https://supabase.com) (the Free plan), then **New project**:

- **Name:** `rayhab-production` (later `rayhab-staging`).
- **Region:** Central EU (Frankfurt).
- **Database password:** a strong one, kept in your password manager. It goes into `DATABASE_MIGRATE_URL`.

### 5.2 and 5.3 Enable the extension and create the API's database role

Open **SQL Editor**, paste the contents of `infra/supabase/setup.sql`, replace `CHOOSE-A-LONG-RANDOM-PASSWORD` with a new password (letters and digits keep the URL simple), and **Run**. The last line should show one row, `rayhab_app`.

It does two things:

- It turns on **btree_gist**, which makes double booking impossible at the database level.
- It creates `rayhab_app`, the role the API signs in as. The first deploy's migration grants it access to the `rayhab` tables: it can read and write data, but not change the schema.

### 5.4 Keep the data private

Go to **Settings > API** and leave **Exposed schemas** as `public` only. Never add `rayhab`: the browser must never reach these tables. Nothing in the site uses Supabase's Data API.

### 5.5 Collect the connection strings

Click **Connect** at the top of the project, choose **Session pooler** (port 5432), and copy the URL. It looks like `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-…-eu-central-1.pooler.supabase.com:5432/postgres`. In your `infra/connect.production.env`:

- **`DATABASE_MIGRATE_URL`:** that URL with the database password from 5.1.
- **`DATABASE_URL`:** the same URL, but with the user `rayhab_app.<project-ref>` and the password from `setup.sql`.

### 5.6 Set up Auth

- Go to **Authentication > Providers > Email**. Keep email sign-in on, and turn **off** "Allow new users to sign up".
- Go to **Authentication > Users > Add user**, and create the staff account (for example Dr. Rayan Halimeh's work email) with a strong password.
- Copy the user's **UID**.
- Make sure the TOTP authenticator option is enabled. The admin requires it on every sign-in.

### 5.7 Find the API keys

Under **Project Settings > API** (or **API Keys**), copy into your connect file:

- **`SUPABASE_URL`:** the **Project URL**.
- **`SUPABASE_ANON_KEY`:** the **anon** key, or the newer **publishable** key.

Only the server uses them. Never copy the **service_role** or **secret** key anywhere: the API does not need it.

### 5.8 Backups and pausing (Free plan)

The Free plan keeps **no backups**, so a GitHub Actions job makes them (`.github/workflows/backup.yml`): every night it dumps the production `rayhab` schema, encrypts it to your public key, and keeps it 14 days as a workflow artifact. It refuses to run without the key: the repository is public, so only encrypted copies may be stored there.

1. **Make the key** on your own computer: install [age](https://github.com/FiloSottile/age) (`winget install FiloSottile.age` on Windows), then `age-keygen -o rayhab-backup-key.txt`. It prints `Public key: age1...`. Keep `rayhab-backup-key.txt` in your password manager and nowhere else: without it no backup can be opened.
2. **Add two repository secrets** (GitHub > the repository > **Settings > Secrets and variables > Actions > New repository secret**):
   - `BACKUP_DATABASE_URL`: the production `DATABASE_MIGRATE_URL` from your connect file;
   - `BACKUP_RECIPIENT`: the `age1...` public key.
3. **Run it once** after the production database exists (step 10): **Actions > Nightly database backup > Run workflow**.

To restore, download the artifact from the run, then:

```bash
age -d -i rayhab-backup-key.txt rayhab-production-*.sql.gz.age | gunzip | psql "<the target project's postgres connection URL>"
```

Restore into the **staging** project once a quarter, so you know a restore works.

**Pausing:** Free projects are paused after a week without activity. In production, Vercel Cron queries the database every minute, which keeps it active. **Staging will pause** when unused (Vercel runs cron only for production): before testing, check its status in the Supabase dashboard and **Restore** it if needed; that takes a few minutes.

**When you upgrade production to Pro:** Supabase's daily backups start and pausing no longer applies. Keep or drop the nightly job; nothing else changes.

After the database is set up (`migrate.mjs`, step 8 for staging, step 10 for production), create the staff user in **Authentication > Users > Add user** (Rayan's email and a strong password; copy its **UID**) and link it to the practitioner record in the SQL Editor:

```sql
update rayhab.practitioners
   set auth_user_id = 'PASTE-THE-UID', email = 'rayan@dr-rayhab.com'
 where id = 'pr-rayan';
```

**Check:** signing in at `/admin/` asks for the password, then shows an authenticator QR code the first time.

## 6. Messages: email and WhatsApp

### 6.0 Email (Resend)

In phase 1 every message to patients, and every notice to the clinic, is an email. The API sends them through **Resend's API** (`EMAIL_DRIVER=resend`, set by `push-env.mjs`). Patient emails never name the service; replies go to `CLINIC_EMAIL`.

1. **Create the Resend account** (Free plan) and add the domain `dr-rayhab.com` under **Domains**.
2. **Verify the domain.** Add the DNS records Resend shows (SPF, DKIM, return-path) at the registrar, and wait until it says **Verified**. Until then it sends only to your own address.
3. **Create an API key** under **API Keys**, with **Sending access** only. It starts with `re_`: `RESEND_API_KEY` in your connect file.
4. **Fill in the senders** in the connect file: `EMAIL_FROM` on the verified domain (for example `Rayhab bookings <bookings@dr-rayhab.com>`) and `STAFF_EMAILS`, comma-separated.

**Check:** `node api/dev/check.mjs production --email you@example.com` sends a test, and after the deploy `node api/dev/doctor.mjs production --email you@example.com` does the same through the API's own Resend driver; **Resend > Emails** shows both.

### 6.1 Get a sender number

In **Meta Business Suite**, create (or use) the clinic's business, then add **WhatsApp** in Meta for Developers (an app of type Business). Register a **separate number used only by the booking system** (decided 2026-10-20): not +961 71 383 315, which stays the clinic's own WhatsApp for talking to patients. The sending number must not already be on WhatsApp, and must receive an SMS or call for the code. Set its two-step PIN and keep it in the password manager.

Patients may still reply to it. The booking system handles that (`api/src/Inbound.php`):
- **STOP** (also UNSUBSCRIBE, `توقف`, `إيقاف`, arrêt) turns WhatsApp off for that number, drops messages still queued to it, and emails the staff a reference. A later booking asks for WhatsApp consent again.
- **Any other reply** appears in the admin's **Enquiries**, marked "WhatsApp reply", with the patient's latest booking. Answer it from the clinic's own WhatsApp (the button opens the chat), then mark it answered. The staff email only says a reply arrived. Photos and voice notes are not kept: the admin shows that one arrived.

### 6.2 Create a permanent token

Create a **System User** with the WhatsApp permissions and generate a **permanent token**. You now have the values; put them in the connect file and run `push-env.mjs` (step 4):

| Value | Connect-file setting |
|---|---|
| The permanent token | `WA_TOKEN` |
| The Phone number ID | `WA_PHONE_NUMBER_ID` |
| The App secret (App settings > Basic) | `WA_APP_SECRET` |
| A random string you choose | `WA_VERIFY_TOKEN` |

### 6.3 Connect the webhook

Webhook URL: `https://dr-rayhab.com/api/webhooks/whatsapp`, with the verify token you chose. Subscribe to **messages**. Delivery receipts then appear in the outbox, and patients' replies and STOP requests are handled as in 6.1.

### 6.4 Submit the templates

All are category **Utility**, language **English** (`en`). Each must keep **exactly** this name and these variables. The wording can be adjusted, but keep the variables in order, and don't name the service or the condition: next to a phone number, that would tell Meta about the patient's health. The patient sees the service on the payment page.

| Name | Body | Button |
|---|---|---|
| `rayhab_request_received` | Hello from Rayhab Movement Clinic. We have your appointment request for {{1}} at {{2}} (Beirut time). This is a request, not yet a confirmed appointment; we will reply within one working day. Reply STOP to stop these messages. | none |
| `rayhab_approved_choose_payment` | Good news: your appointment on {{1}} at {{2}} (Beirut time) is approved. Please choose how you would like to pay with the button below. The link is private to you. | URL, dynamic: `https://dr-rayhab.com/payment/#t={{1}}`, text "Choose how to pay" |
| `rayhab_request_declined` | Rayhab Movement Clinic: we are sorry, we cannot take your appointment request. {{1}} You are welcome to request another time on our website. | none |
| `rayhab_new_time_proposed` | Rayhab Movement Clinic: the time you asked for is not available. We can offer {{1}} at {{2}} (Beirut time). Please accept it or ask for another time with the button below. | URL, dynamic: as above, text "Answer" |
| `rayhab_appointment_cancelled` | Rayhab Movement Clinic: your appointment on {{1}} at {{2}} has been cancelled. Reply here if you have any questions. | none |
| `rayhab_payment_received` | Rayhab Movement Clinic: thank you, we have received your payment of {{1}} for your appointment on {{2}}. See you soon. | none |
| `rayhab_appointment_reminder` | Reminder from Rayhab Movement Clinic: your appointment is on {{1}} at {{2}} (Beirut time), {{3}}. Wear clothes you can move in and bring any X-ray or report you have. | none |

If Meta refuses a `#` in the button URL, use `https://dr-rayhab.com/payment/?t={{1}}`. The payment page moves the token out of the address bar, but Vercel's request log for that page holds the token (step 12).

### 6.5 Turn sending on

Once all templates are approved, set `WHATSAPP_DRIVER=cloud` and `PATIENT_CHANNEL=whatsapp` in the connect file, run `push-env.mjs`, and redeploy. Until then keep `off`: requests still work, and no messages go out. The admin's Requests list still shows everything, but patients won't receive approval links, so the clinic would have to send them by hand.

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

## 8. Staging: database, staff account, first test

1. **Restore the staging Supabase project** if the dashboard shows it paused (5.8).
2. **Create the tables and starting data:** `node api/dev/migrate.mjs staging`.
3. **Deploy staging:** push to `redesign-2.0`, or **Deployments > Redeploy** the latest `redesign-2.0` deployment (needed after step 4). Its build log ends "preview: noindex and demo mode on 82 of 82 pages".
4. **Rayan's staff account** on the staging project: the user and the SQL at the end of step 5.
5. **Prices** on staging (step 11).
6. **The doctor:** `node api/dev/doctor.mjs staging --email you@example.com`. It ends "Everything needed is in place." (it notes that the worker hasn't run: Vercel runs cron only in production).
7. **Walk through it on `https://staging.dr-rayhab.com`** (signed in to Vercel, or with the Shareable Link):
   1. Request an appointment with your own email address. The "We have your appointment request" email arrives, and the clinic's address gets "New booking request".
   2. Sign in at `/admin/` as Rayan and set up the authenticator.
   3. Approve the request. The "Your appointment is approved" email arrives with the private link.
   4. Open the link and press **Confirm, I'll pay at the clinic**. The clinic gets "… confirmed: the patient will pay at the clinic".
   5. In the admin, **Payments > Confirm cash received**. The patient gets "Payment received".
   6. Propose a new time for another request and answer it from the link.
   7. Send a question from the contact page; it appears in the admin's **Enquiries**.

**Check:** every step above behaved as described. `?demo=1` also works on staging, for showing the flows with sample data.

## 9. GitHub

Nothing to set up for deploys: Vercel deploys from Git. The workflows:

- **Site CI** and **API CI**, on every push: the browser-script and API tests, the built files current, every link resolving, nothing loading from another site, and `vercel.json` (function, route, cron, headers, script hashes).
- **Live check**, after every successful Vercel deployment (`infra/vercel/check-live.mjs`): production always; staging once the repository secret `VERCEL_BYPASS` holds the value from Vercel **Settings > Deployment Protection > Protection Bypass for Automation**. A red run means the live site is missing a header or a protection: fix it, or roll back (step 10).
- **Nightly database backup** (5.8).

The old GitHub Pages copy (`ronimassoud.github.io/rayhab-movement-clinic`) no longer updates. Turn it off: **Settings > Pages > Unpublish** (or set the source to None).

**Check:** **Actions** shows Site CI and API CI green for the latest commit.

## 10. Production (after the legal sign-off)

1. **Legal sign-off** (step 13), then publish the two pages: resolve their placeholders, remove `data-draft`, the draft banner and the `noindex` tag, and link them from both forms and the footer.
2. **Restore** the production Supabase project if paused, then **create the tables**: `node api/dev/migrate.mjs production`.
3. **Merge and deploy:** merge `redesign-2.0` into `main`. Vercel builds production; the log ends "production: 82 pages, no drafts, no demo mode".
4. **Rayan's staff account** on the production project (step 5), and the **prices** (step 11).
5. **The doctor:** `node api/dev/doctor.mjs production --email you@example.com`.
6. **Run the backup once** (5.8).
7. **Check production:**
   - `https://dr-rayhab.com/api/health` shows `{"ok":true}`, and within two minutes `https://dr-rayhab.com/api/health/worker` answers 200 (the cron worker runs).
   - `https://www.dr-rayhab.com` redirects to `https://dr-rayhab.com/`.
   - A missing page answers 404 with the branded page.
   - The pages have **no** `noindex` tag and no `rayhab-demo`.
   - **Actions > Live check** passed for this deploy. It runs by itself after every production deploy and checks what the site really sends: the security headers, `no-store` and `noindex` on the admin and payment pages, the redirects, the 404 page, the API (staff data and the cron route refused without credentials) and TLS 1.2 or newer only. By hand: `node infra/vercel/check-live.mjs https://dr-rayhab.com --production`.
   - A real booking from your own email address, end to end, as in step 8.
8. **Lengthen HSTS** after a week with all of this holding: in `vercel.json`, change `max-age=86400` to `max-age=31536000`, then merge and deploy.

**If a production deploy goes wrong:** **Deployments**, pick the last good one, **Instant Rollback**. It takes seconds. A rollback does not undo database migrations; they only ever add, so the older code keeps working.

## 11. Prices and policy text

Prices are in minor units for USD (`8000` = $80) and whole pounds for LBP. Set them in each project's SQL Editor:

```sql
update rayhab.services set price_amount = 8000, currency = 'USD' where id in ('assessment', 'pain');
update rayhab.services set price_amount = 6000, currency = 'USD' where id in ('follow', 'online', 'sports', 'pain-follow');
```

The admin will not approve a request for a service without a price, so the patient always sees what they will pay.

The payment page's wording comes from `POLICY_CASH_TEXT` (and later `POLICY_WHISH_TEXT`): add them to the connect file, run `push-env.mjs`, and redeploy.

Opening hours live in `rayhab.working_hours` (weekday 0 is Sunday; times are Beirut time). The seed copies today's pattern: closed Sunday and Wednesday, Saturday mornings only. One-off closures are better done from the admin's **Calendar > Block time**.

## 12. Running it

**Logs:** Vercel > the project > **Logs**: the API's requests and errors, and the cron runs (**Settings > Cron Jobs** shows each one). Error lines withhold email addresses, phone numbers and the values a database error can quote. Vercel keeps runtime logs only a short time; for an incident, export what matters at once (`incident-response.md`). The private link's token never reaches these logs: the payment page keeps it in the `#` part of its address, which browsers never send, and the API receives it in the `X-Payment-Token` request header, not the path.

**Settings** change in the connect file, then `push-env.mjs` and a redeploy. New code arrives only through Git.

**Database changes:** when a deploy brings a new file in `api/migrations`, run `node api/dev/migrate.mjs <env>` **before** that deploy. Migrations only ever add, never rename or drop, so the running code keeps working on the newer schema.

**Incidents:** a lost device, a leaked key, a message to the wrong person, a possible breach: follow [`incident-response.md`](incident-response.md). Fill in its contacts (section 1) before launch.

**Monitoring**

- Add an uptime monitor (UptimeRobot or Better Stack, free), alerting by email, on:
  - `https://dr-rayhab.com/api/health`: the site, the API and the database answer;
  - `https://dr-rayhab.com/api/health/worker`: the worker finished a run in the last five minutes (503 when it has stopped: messages, reminders and expiring holds are then waiting).
- When sign-in is blocked for an address after too many attempts, the staff addresses get one email ("sign-in attempts blocked") per hour. Repeated emails mean someone is trying passwords.
- Check messages that could not be delivered once a week:

  ```sql
  select id, template, last_error, created_at from rayhab.notification_outbox where status = 'dead' order by id desc;
  ```

**How long data is kept.** The worker deletes old personal data each hour: requests that never became appointments after 183 days, answered website questions after 365, message history after 90 (`RETAIN_*`; 0 keeps that kind forever). Appointments that happened, and payments, are kept. Each deletion run leaves one "Old data deleted (schedule)" entry, with counts only, in the admin's **Activity**. Backups follow 14 days behind.

**Requests about personal data**

A patient may ask what the clinic holds about them, or for it to be erased.

1. **Check it is them.** Reply on the email address or number the request is about, and ask them to confirm from it. Note the request and its date (the incident log template in `incident-response.md` works as a form).
2. **See what is held:** `node api/dev/subject.mjs production find --phone "+961 70 000 000" --email them@example.com`. Every booking made its own patient record; this finds them all.
3. **For a copy:** the same with `export`, redirected to a file (`> request.json`). Send it to them securely, then delete the file.
4. **To erase:** `erase` shows what would happen; add `--yes` to do it. Requests that never became appointments, their questions and message records are deleted; appointments that happened or were paid are kept without name, phone, email or note. Cancel an upcoming appointment in the admin first.
5. **Tell them it is done**, and note the date. Backups still hold the data for up to 14 days.

**Secrets:** change them in the connect file, run `push-env.mjs`, redeploy. A new `APP_SECRET` signs out every staff member and invalidates links in messages not yet sent. Database passwords: in Supabase (and `setup.sql` for `rayhab_app`), then the connect file. The backup secrets live in GitHub (5.8).

**Limits**

| Plan | Limits | What it means here |
|---|---|---|
| Vercel Pro | Generous function and cron allowances | The every-minute worker is about 43,000 short runs a month; the dashboard shows usage. |
| Resend Free | 100 emails a day | About 15 bookings a day in phase 1; upgrade before then. |
| Supabase Free | 500 MB database; pauses when idle | Years of bookings at this size; production stays active through the worker. |

**Staff:** add them in Supabase Auth, then insert a practitioner row with their `auth_user_id`: `role` is `admin`, `practitioner` or `reception` (reception sees no patient notes and cannot block times); `bookable = false` for staff who do not see patients.

## 13. Before real patients use it

Go through README.md, "Launch blockers":

- the privacy policy and booking terms approved and published;
- the processor agreements for phase 1: Supabase, Vercel and Resend (Meta and Whish join in phase 2). If the consent wording changes, also change `CONSENT_VERSION` in `site/assets/js/booking.js`;
- the clinic email;
- the address and opening hours;
- the payment policy;
- the clinical review of the articles;
- consent for case studies.
