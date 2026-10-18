<!--
  Backend architecture handoff, as supplied by the project owner (2026-10-15)
  for the separate server-side developer. Kept verbatim below this note.

  Read it together with README.md, "Launch and backend handoff", which is the
  source of truth for what the frontend actually sends and expects today.
  Two corrections against the current site:
    * the booking page is site/book.html (served at /book.html), not
      site/booking.html or /booking/;
    * the frontend calls the endpoints documented in README.md with the field
      names listed there; align the server with those, or change both together.
  Everything in this document is a proposal, not a description of something
  that exists.

  Superseded in part (2026-10-18): the production stack chosen is a basic
  Ubuntu Server 26.04 VPS with Apache 2 and certbot (port 80 redirects to
  HTTPS) and a plain PHP API under PHP-FPM, with a cron worker, instead of
  Fastify, Nginx and Docker. Supabase stays for PostgreSQL and staff Auth.
  The implementation is in api/ and infra/; the steps are in
  docs/production-runbook.md.
-->

# Rayhab Movement Clinic — Backend Developer Handoff (README)

**Production domain:** https://dr-rayhab.com  
**Infrastructure:** Private Linux VPS / dedicated server with SSH access  
**Clinic market:** Lebanon  
**Responsibility:** Separate server-side developer  
**Frontend specification:** `Rayhab_Frontend_Implementation.md`

> This README contains **recommendations and proposed contracts**, not claims about an already deployed backend. Coordinate API response formats and state transitions with the frontend developer before implementation. The current Whish merchant documentation and clinic-specific legal requirements must be verified before production.

## Responsibility boundary

**Backend developer owns:** VPS/reverse proxy, backend runtime, database and migrations, practitioner authentication/authorization, scheduling constraints, API contracts, Whish merchant integration, cash receipt persistence, WhatsApp and email delivery, background jobs, audit logging, monitoring, backup/recovery, and security/privacy implementation.

**Frontend developer owns:** Existing HTML/Tailwind/vanilla JS website, booking UX, payment selection UX, practitioner admin interface, and API consumption. Do not require a frontend framework migration.

## Proposed repository structure

```text
rayhab-movement-clinic/
├── site/                         # Existing static frontend and generated pages
│   ├── booking.html
│   ├── admin/                    # Frontend developer
│   ├── payment/                  # Frontend developer
│   └── assets/
├── src/
│   ├── js/                       # Existing JS plus frontend API clients
│   └── css/                      # Existing modular styles
├── content/                      # Existing Python content generators
├── server/                       # Backend developer
│   ├── src/
│   │   ├── app.ts
│   │   ├── routes/
│   │   │   ├── availability.ts
│   │   │   ├── appointments.ts
│   │   │   ├── admin.ts
│   │   │   ├── payments.ts
│   │   │   └── whish-webhook.ts
│   │   ├── services/
│   │   │   ├── scheduling.ts
│   │   │   ├── whish.ts
│   │   │   ├── whatsapp.ts
│   │   │   └── email.ts
│   │   ├── auth/
│   │   ├── db/
│   │   └── workers/
│   ├── tests/
│   ├── Dockerfile
│   └── package.json
├── supabase/                     # Backend developer, if Supabase selected
│   └── migrations/
├── infra/                        # Backend developer
│   ├── nginx/
│   └── compose.yaml
├── .github/workflows/            # Existing CI; coordinate deployment changes
├── Rayhab_Frontend_Implementation.md
└── README.md                     # This handoff
```

All added paths are proposals. Preserve existing project naming conventions and build scripts.

---

## Detailed backend architecture and implementation recommendations

## 1. Executive recommendation

Preserve the existing static website and add a secure, independently deployed booking backend. The recommended production architecture is:

- **Frontend:** existing hand-authored HTML, Tailwind CSS v4, custom CSS, vanilla JavaScript, and locally bundled GSAP.
- **Reverse proxy:** Nginx on the existing VPS, terminating HTTPS and routing `/api/*` to a private backend service.
- **Backend:** Node.js LTS, TypeScript, Fastify, schema validation, and Drizzle ORM.
- **Database:** PostgreSQL managed by Supabase, **conditional on legal/data-residency review**; otherwise deploy PostgreSQL on an appropriately controlled infrastructure.
- **Staff identity:** Supabase Auth, with MFA and backend-enforced authorization; reassess auth provider if Supabase cannot be used.
- **Messaging:** Meta WhatsApp Business Cloud API for approved template notifications; transactional email for staff alerts.
- **Payments:** Whish Money merchant integration for online payments; manually recorded cash receipts for in-clinic payments.
- **Jobs:** PostgreSQL-backed transactional outbox and background worker for messages, retries, reminders, and payment reconciliation.
- **Deployment:** Docker Compose for backend/worker, GitHub Actions CI/CD with controlled SSH deployment, staging and production isolation.

**Do not migrate to Next.js or React solely for booking.** The current frontend is adequate. **Do not put Whish secrets, WhatsApp credentials, or privileged database keys in browser JavaScript.**

### Architecture at a glance

```text
Patients / physiotherapist
          |
          v
https://dr-rayhab.com  (HTTPS)
          |
          v
     Nginx on VPS
       |         \
       |          +-- /api/* --> Fastify API (private container)
       |                          |       |         |
       +-- static HTML/CSS/JS     |       |         +--> Whish merchant API
                                  |       +------------> WhatsApp Cloud API
                                  +--------------------> PostgreSQL
                                                        ^
                                                        |
                                                Background worker
                                               (outbox, retries, reminders)

Staff: /admin/ --> authenticated API --> authorized database operations
Patient: /payment/ --> scoped booking token --> payment selection API
Whish: webhook/callback --> authenticated API --> verified transaction update
```

## 2. Existing website and what stays unchanged

The website currently includes:

- About ten manually authored HTML pages under `site/`, including Home, About, Services, Results, Contact, Education, scoliosis hub, Booking, and 404.
- Python-generated scoliosis articles, topic pages, and service pages from JSON in `content/` using `build_articles.py`, `build_topics.py`, and `build_services.py`.
- Tailwind CSS v4 compiled into `site/assets/css/rayhab.css`, plus hand-written modular styles in `src/css/`.
- Bricolage Grotesque headings and Public Sans body type.
- Vanilla JavaScript in `ui.js`, `booking.js`, `modal.js`, and `contact.js`.
- Locally bundled GSAP 3.13 with ScrollTrigger and SplitText; motion code in `motion.js`.
- Build utilities such as `stamp.py`, `navcards.py`, and `motion_tags.py`.
- GitHub Actions that rebuild CSS, stamp asset versions, check internal links, and prepare the published `site/` output.
- Development work on `redesign-2.0`, with production promotion through `main`.

**Change in hosting assumption:** the live site is served from a private Linux VPS at `dr-rayhab.com`, not GitHub Pages. GitHub can remain the source repository and CI/CD runner.

Keep the existing content-generation and animation systems. Extend `booking.js` to request availability and submit bookings to `/api/`; introduce separate JavaScript modules for API requests, admin operations, and payment selection.

## 3. Infrastructure and runtime

### 3.1 Nginx

- Serve static site files from the built `site/` directory.
- Reverse-proxy `/api/` to Fastify on an internal Docker network or loopback interface.
- Enforce HTTPS, HSTS after validation, secure response headers, reasonable request limits, and rate limiting on public booking/token endpoints.
- Configure webhook routes without browser-oriented authentication, but require provider-specific webhook authentication and replay protection.
- Configure health-check paths and upstream timeouts; never expose the backend container's port directly to the internet.

### 3.2 Backend

Use a TypeScript Fastify service with modules for:

1. Public availability and booking requests.
2. Staff authentication/authorization and practitioner schedule management.
3. Appointment approvals, declines, cancellations, and rescheduling.
4. Payment method selection and Whish payment initiation.
5. Whish callback verification and reconciliation.
6. Cash receipt recording and financial closure.
7. Notification jobs, audit events, and operational reporting.

Use strict input validation, request correlation IDs, structured logs, safe error responses, and database transactions around state changes.

### 3.3 Database choice

**Preferred:** Supabase-managed PostgreSQL, if hosting region, data processing terms, security controls, and Lebanese healthcare requirements are approved. The Fastify server should be the business-logic boundary and access PostgreSQL using appropriately restricted credentials. Supabase Auth may be used for staff identity.

**Fallback:** self-hosted or separately managed PostgreSQL on approved infrastructure, with a corresponding authentication solution. Do not treat a VPS located outside Lebanon or a Supabase region as automatically compliant. Confirm legal requirements before uploading real patient records.

### 3.4 Background jobs

Use a durable PostgreSQL-backed job queue or transactional outbox. The API writes an appointment status change and its notification event in the same transaction; a worker delivers WhatsApp/email and retries transient failures. Record attempts, provider message IDs, outcomes, and dead-letter/failure states. Avoid sending messages inside a database transaction.

## 4. End-to-end appointment workflow

### Stage 1 — Patient selects an appointment

1. The patient visits `/booking/` and selects service, practitioner (if applicable), date, and time.
2. `booking.js` fetches server-generated availability from `GET /api/availability`.
3. Patient provides name, phone, email if needed, and WhatsApp communication consent.
4. The frontend calls `POST /api/appointments`.
5. The backend validates service duration, schedule rules, timezone, booking notice, and availability **inside a database transaction**.
6. A new appointment is recorded as `requested`; its slot is reserved or tentatively held according to the configured policy.
7. A staff notification job is queued; the patient sees a request-received message, **not a premature confirmation**.

### Stage 2 — Practitioner reviews request

1. Practitioner receives an email containing a secure dashboard link, not patient medical details.
2. Practitioner logs into `/admin/` with MFA.
3. Dashboard lists requested appointments and their relevant service/date/contact information.
4. Practitioner approves, declines, or proposes a different slot.
5. Server checks authorization, allowed state transition, and slot integrity before saving the decision.
6. Approved booking generates a patient WhatsApp notification job; declined booking releases its slot and triggers the appropriate patient message.

### Stage 3 — Patient chooses payment method

The approval WhatsApp message includes a **short-lived, high-entropy link** to `/payment/` (for example, an opaque token, not an appointment ID that can be guessed). The server stores only a hash of the token, enforces expiry and scoped use, and reveals only the minimum appointment summary.

The patient chooses:

- **Whish online payment:** backend creates a payment intent and requests a hosted payment link/session from Whish, subject to its official merchant API contract.
- **Cash at clinic:** backend records `payment_method = cash` and `payment_status = awaiting_payment`; the appointment remains scheduled under the clinic's cash-payment policy.

Do not let the browser set an amount or change a payment status directly. Prices are calculated server-side from approved service/pricing records.

### Stage 4A — Whish online payment

1. Patient follows the Whish checkout link.
2. Whish processes the payment and may redirect the browser to a return page.
3. A browser redirect is **not** proof of payment.
4. Backend receives the provider's authenticated callback/webhook **if supported by the merchant contract**, validates it, and/or verifies the transaction through the official status API.
5. Backend atomically records the verified transaction, updates the outstanding balance, and sets payment status to `paid` when fully settled.
6. Duplicate callbacks are safely ignored using unique provider transaction/event references and idempotent processing.
7. Staff dashboard updates; practitioner receives a payment-success notification if configured.
8. Financial closure is recorded automatically only after all reconciliation requirements are met.

**Integration dependency:** obtain Whish's current official merchant API documentation, test credentials, supported currencies, payment-link API, callback authentication method, status-query method, refund rules, and sandbox access. Do not assume particular endpoints or webhook signatures until confirmed.

### Stage 4B — Cash at clinic

1. The patient chooses cash and sees a confirmation of the selected method.
2. Dashboard displays `Cash · Awaiting payment` and the amount due.
3. When money is received, an authorized practitioner or cashier selects **Confirm Cash Received**.
4. Backend requires explicit confirmation, validates the amount/currency and permissions, and creates a cash receipt transaction.
5. The database records `received_by`, `received_at`, amount, currency, and audit event.
6. If fully paid, payment status changes to `paid`; financial closure occurs after reconciliation.
7. The patient may receive a payment receipt/acknowledgment according to clinic policy.

If partial cash payments are allowed, track the remaining balance and do not close prematurely. Decide whether cash is due before or after the treatment session.

### Stage 5 — Appointment completion

**Clinical appointment completion and financial closure are different.** An online prepayment can close the financial record before treatment. The clinical appointment becomes `completed` only when the treatment has occurred and the practitioner records it. Track no-shows, cancellations, and refunds separately.

## 5. Availability and double-booking prevention

Calculate available times dynamically using:

- Practitioner working hours and exceptions.
- Service duration and buffers.
- Existing appointments and active holds.
- Holidays, breaks, blocked dates, and optionally treatment-room capacity.
- Minimum advance notice and maximum booking horizon.

Store timestamps in UTC; interpret schedules and display times in `Asia/Beirut`, respecting daylight-saving changes. The server must make the final decision about availability.

**Concurrency requirement:** use PostgreSQL transactions and an exclusion constraint over practitioner/time ranges (or an equivalent atomic reservation mechanism). Two requests for overlapping times must not both become valid reservations. For pending approvals, define a documented hold/expiry policy and how it interacts with staff response deadlines. An expiration worker must release abandoned holds safely.

## 6. Recommended PostgreSQL schema

| Table | Purpose / key fields |
|---|---|
| `patients` | ID, name, normalized phone, email, consent timestamps |
| `practitioners` | ID, staff auth subject, active flag, role |
| `services` | ID, name, duration, currency, price, buffers |
| `working_hours` | Practitioner, weekday, local start/end times |
| `schedule_exceptions` | Practitioner, date/time range, reason/type |
| `appointments` | ID, patient, practitioner, service, UTC start/end, appointment status, hold expiry |
| `appointment_events` | Appointment, actor, event type, old/new status, timestamp |
| `payment_intents` | Appointment, method, amount, currency, outstanding balance, payment status |
| `payment_transactions` | Intent, provider, external reference, amount, currency, verification state, timestamps |
| `cash_receipts` | Payment intent, amount, currency, received_by, received_at |
| `notification_outbox` | Event type, recipient, template, payload reference, processing state |
| `notification_logs` | Provider message ID, delivery attempts, status, errors |
| `audit_logs` | Actor, action, entity, before/after summary, timestamp, request ID |

Add unique indexes for external provider transaction IDs, constrained foreign keys, and appropriate retention controls. Avoid storing detailed medical notes in booking/payment tables. If medical intake is added later, treat it as a separate higher-sensitivity data domain.

### State models

**Appointment:** `requested` → `approved` → `confirmed` → `completed`; alternatives include `declined`, `cancelled`, `expired`, `no_show`, and `reschedule_requested` as needed.

**Payment:** `not_selected`, `awaiting_payment`, `paid`, `refunded`; failed online attempts should be stored on individual `payment_transactions`, while the balance remains outstanding. Use a separate `financial_closed_at` field instead of making `closed` a payment status.

**Payment method:** `whish`, `cash`, or `null` before selection.

Enforce transitions in backend code and database constraints; don't rely on frontend badges.

## 7. API surface (proposed, not existing)

### Public endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/services` | Public service catalog |
| GET | `/api/availability?service_id=...&date=...` | Computed available slots |
| POST | `/api/appointments` | Validate and submit booking request |
| GET | `/api/payment-selection/:token` | Minimal booking summary for scoped token |
| POST | `/api/payment-selection/:token` | Choose Whish or cash |
| POST | `/api/payments/whish/create` | Server-side checkout creation, with scoped authorization |
| POST | `/api/webhooks/whish` | Provider callback with verified authentication |

### Staff endpoints (authenticated and role-checked)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/admin/appointments` | List/filter bookings |
| POST | `/api/admin/appointments/:id/approve` | Approve request |
| POST | `/api/admin/appointments/:id/decline` | Decline request |
| POST | `/api/admin/appointments/:id/reschedule` | Propose/change slot |
| GET | `/api/admin/availability` | Practitioner schedule management |
| PATCH | `/api/admin/availability` | Update working hours/exceptions |
| GET | `/api/admin/payments` | Payment dashboard |
| POST | `/api/admin/payments/:id/confirm-cash` | Record authorized cash receipt |
| GET | `/api/admin/audit` | Authorized activity review |

Rate-limit public requests, protect state-changing endpoints against CSRF where cookie authentication is used, and validate every payload. Never expose private patient records using a guessable ID.

## 8. Admin dashboard

**URL:** `https://dr-rayhab.com/admin/`

Build with the existing HTML/Tailwind/custom CSS/vanilla JS design system. The dashboard should include:

1. **Overview:** today's appointments, pending approvals, unpaid balance, paid appointments, alerts.
2. **Appointment requests:** review, approve, decline, propose a different time.
3. **Calendar:** daily/weekly schedule, working hours, blocked times, holidays.
4. **Payments:** Whish status, cash awaiting receipt, payment history, failed attempts, refunds.
5. **Patient directory:** minimal contact/appointment records with appropriate access restrictions.
6. **Audit and settings:** staff roles, notification templates, clinic policies, activity history.

Suggested payment labels: `Not selected`, `Whish · Awaiting payment`, `Cash · Awaiting payment`, `Paid · Whish`, `Paid · Cash`, `Refunded`.

A staff member can confirm **cash**, but cannot manually mark an unverified Whish payment as provider-confirmed. Any administrative adjustment should require elevated permission, a reason, and a distinct audit event.

## 9. WhatsApp and email

Use the official Meta WhatsApp Business Cloud API. Obtain a business account, approved sender, patient consent, and approved message templates for business-initiated notifications.

**Approval message concept:**

> Your appointment at Rayhab Movement Clinic has been approved for [date] at [time]. Please choose your payment method using this secure link: [link].

**Other messages:** booking request received (optional), declined/reschedule proposed, payment received, appointment reminder, cancellation.

Use transactional email for staff alerts with a secure dashboard link. Avoid sending clinical notes, sensitive medical history, or unnecessary identifiers by email or WhatsApp. Record message attempts and delivery state. Implement retry limits, deduplication, and alerts for persistent failure.

## 10. Security and privacy

Because the application handles clinic/patient information, complete a Lebanon-specific legal and privacy review before production. In particular, review Law No. 81/2018, applicable health-data rules, regulator expectations, data-transfer restrictions, retention requirements, and processor contracts. Do not assume that encryption or a hosting provider's generic compliance statement settles these questions.

Minimum technical controls:

- TLS/HTTPS, secure headers, encrypted backups, and tested restore procedures.
- Least-privilege database users; no public PostgreSQL port.
- Staff MFA and backend role-based authorization.
- Restricted patient record access, audited privileged operations.
- Secrets stored only in protected server/CI environments, never in browser bundles or Git.
- Rate limiting, bot protection, token expiration, input validation, safe error handling.
- Webhook signature/authentication validation, replay defense, unique event IDs.
- Transactional payment updates and immutable-ish audit history.
- Minimal patient data collection, documented consent and retention rules.
- Security patching, dependency scanning, log redaction, and incident-response procedures.

## 11. Deployment and environments

### Recommended runtime services

```text
nginx                 # public HTTPS/static site/reverse proxy
rayhab-api            # Fastify/TypeScript application, private
rayhab-worker         # queue processor, reminders, reconciliation
postgresql            # managed Supabase OR approved separately hosted database
```

Use Docker Compose for API and worker; Nginx can run on the host or as a controlled container. Keep staging separate from production with distinct databases, API keys, Whish test credentials, WhatsApp test setup, and email recipients.

### CI/CD

1. Commit changes to `redesign-2.0`.
2. Run CSS compilation, Python content generators, `stamp.py`, shared page injection, link checks, linting, unit tests, and integration tests.
3. Build versioned backend images and static assets.
4. Promote reviewed changes to `main` with deployment approval.
5. Deploy over SSH to the VPS using restricted deployment credentials.
6. Run reviewed database migrations with a backup and rollback plan.
7. Verify health checks and smoke tests before declaring success.
8. Retain prior application images and monitor errors after release.

**Database rollback caution:** application rollback does not automatically reverse schema/data migrations. Prefer backward-compatible migrations and a deliberate recovery plan.

## 12. Suggested repository additions

```text
rayhab-movement-clinic/
├── site/
│   ├── booking.html
│   ├── admin/
│   │   ├── index.html
│   │   └── appointments.html
│   ├── payment/
│   │   └── index.html
│   └── assets/
├── src/
│   ├── css/
│   └── js/
│       ├── booking.js
│       ├── modal.js
│       ├── admin.js
│       └── api/
│           ├── availability.js
│           ├── appointments.js
│           └── payments.js
├── server/
│   ├── src/
│   │   ├── app.ts
│   │   ├── routes/
│   │   ├── modules/
│   │   │   ├── booking/
│   │   │   ├── availability/
│   │   │   ├── payments/
│   │   │   ├── notifications/
│   │   │   └── auth/
│   │   ├── integrations/
│   │   │   ├── whish/
│   │   │   ├── whatsapp/
│   │   │   └── email/
│   │   └── worker/
│   ├── migrations/
│   └── tests/
├── infra/
│   ├── docker-compose.yml
│   └── nginx/
├── content/
├── .github/workflows/
└── package.json
```

Paths are proposed. Adjust to the actual repository layout before coding.

## 13. Delivery roadmap

### Release 1 — Booking foundation

- Finalize data model, privacy assessment, and infrastructure.
- Build migrations, service catalog, practitioner availability, collision prevention, and booking submission API.
- Connect existing booking UI to live availability.
- Test timezone/DST and simultaneous booking requests.

**Acceptance:** a patient can request a genuinely available slot and duplicate overlapping reservations are prevented.

### Release 2 — Practitioner dashboard

- Staff login/MFA and permissions.
- Booking review, approval, decline, rescheduling, availability controls.
- Email alerts and audit history.

**Acceptance:** practitioner decisions are authenticated, auditable, and reflected immediately in the database.

### Release 3 — WhatsApp and payment selection

- WhatsApp Business setup and template approval.
- Secure patient payment-selection link and page.
- Cash selection and unpaid tracking.
- Notification queue/retries.

**Acceptance:** an approved patient can choose Whish or cash; cash is visible as unpaid until recorded.

### Release 4 — Whish and financial closure

- Integrate official Whish sandbox and merchant API.
- Verify callbacks/payment status; implement reconciliation and idempotency.
- Cash receipt confirmation, refunds/cancellations as applicable.
- Production monitoring, backup restore drills, and security testing.

**Acceptance:** verified Whish payment or authorized cash receipt closes the financial record exactly once; clinical appointment status remains separate.

## 14. Critical test scenarios

- Two patients simultaneously request overlapping slots.
- Patient selects a time that becomes unavailable before submission.
- Practitioner approves an expired or already reassigned hold.
- WhatsApp delivery fails and worker retries without duplicate sends.
- Patient opens an expired or reused payment-selection token.
- Patient selects cash, then requests to switch to Whish.
- Whish payment fails, times out, or is abandoned.
- Whish callback is delivered twice or arrives out of order.
- Browser reports payment success but provider verification fails.
- Cash receipt is submitted twice by staff.
- Unauthorized staff attempts to view another practitioner's restricted records.
- Partial payment, refund, cancellation, and no-show flows.
- Beirut daylight-saving transition and UTC conversion.
- VPS restart during queued notifications or payment callback processing.
- Restore a database backup and reconcile provider transactions afterward.

## 15. Decisions required before production

1. **Whish contract:** obtain current official API documentation, merchant credentials, sandbox, currencies, fees, webhook and reconciliation details.
2. **Payment policy:** decide whether Whish requires advance payment and whether cash is payable before or after treatment.
3. **Appointment hold policy:** decide approval deadlines, reservation expiry, and what happens if no payment method is chosen.
4. **Currency:** confirm USD, LBP, or both and how prices/settlement are recorded.
5. **Clinic roles:** practitioner only, or practitioner plus receptionist/cashier/admin.
6. **Hosting/legal review:** confirm where health-related data may be hosted and transferred.
7. **Notification consent:** approve WhatsApp templates, consent wording, and fallback channel.
8. **Clinical workflow:** define how `completed`, `no_show`, cancellations, and refunds are handled.

## 16. Final recommendation

Deploy the **existing static Rayhab frontend on the current VPS**, with **Nginx + Fastify/TypeScript API + PostgreSQL + durable background worker**. Use **Supabase-managed PostgreSQL/Auth only if approved for the clinic's data-handling requirements**, integrate **Whish via its official merchant API**, and send appointment messages through **Meta WhatsApp Cloud API**.

The physiotherapist's dashboard should be the operational control center: approve appointments, manage availability, see payment methods and outstanding balances, confirm cash receipts, and review automatically verified Whish payments. **Payment closure and clinical completion remain independent, fully audited states.**

This design adds the required booking and payment capabilities without replacing the site's current frontend or content-generation pipeline.
