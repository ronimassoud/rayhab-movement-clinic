# Privacy policy: working draft (not published)

**The page itself:** `site/privacy.html` is the patient-facing draft, built from this file and the code as of 2026-10-20. Review it there (on staging: `/privacy.html`). It is hidden from search engines, linked from nowhere, and its `data-draft` attribute stops any deploy to production until it is removed. To publish once approved: resolve every highlighted placeholder, remove `data-draft` and the draft banner, drop the noindex tag, and link the page from both forms and the footer.

**Status:** draft for the clinic and its legal adviser. It is not linked from
the site and must not be published until every item marked **[DECIDE]** or
**[LEGAL]** is resolved. It describes only what the website actually does
today, plus the booking backend that is planned but not yet built (marked
**[PLANNED]**). Nothing here is a claim of legal compliance.

Applicable law to review: Lebanon's Law No. 81 of 2018 on Electronic
Transactions and Personal Data, health-data rules, and the law of any country
whose residents are targeted (for example online consultations "for patients
outside Lebanon", which may bring the EU GDPR into scope). **[LEGAL]**

---

## Who we are

Rayhab Movement Clinic, run by Dr. Rayan Halimeh, physiotherapist.
- Legal entity name and registration: **[DECIDE]**
- Postal address: **[DECIDE]** (the site currently says only "Beirut" and "Aley")
- Contact for privacy questions: **[DECIDE]** (the site's email is a temporary
  personal Gmail address, `rayan.halimeh@gmail.com`; a clinic address is due)

## What the website collects, and why

Facts as built (verified in the code on 2026-10-15):

| Where | What is collected | Why |
|---|---|---|
| Booking request (`book.html` and the booking dialog) | Service, date and time requested, whether it is for the patient or their child, first and last name, email, phone/WhatsApp number, an optional free-text note ("a diagnosis, a Cobb angle, or just how it feels"), and a consent tick | To arrange the appointment |
| Contact form (`contact.html`) | First and last name, email, optional phone, the question | To reply |
| Both forms | A hidden spam-trap field and how long the form was open | To filter automated spam |

- The free-text fields may contain **health information** (a diagnosis, a
  Cobb angle, symptoms). This is sensitive data and needs its own legal basis
  and handling. **[LEGAL]**
- A booking may be made by a parent for a **child**. Rules on minors' data
  and parental consent need confirming. **[LEGAL]**
- The booking consent text currently reads: *"I agree to Rayhab storing these
  details to arrange my appointment. They are not shared with anyone outside
  the clinic."* Once the planned backend uses outside processors (hosting,
  database, WhatsApp, email), the second sentence will no longer be accurate
  and must change. **[DECIDE] [LEGAL]**

## What the website does not do

Verified in the code and in the browser on 2026-10-15:
- No analytics, advertising or tracking scripts.
- No cookies set by the site, and no use of browser storage.
- No third-party requests on page load. Fonts are served from the site itself.
- Social links (Instagram, TikTok, WhatsApp) are plain links; nothing is
  embedded and nothing loads from those services until a visitor clicks.

If analytics or embeds are added later, this section, and the consent
mechanism, must be revisited first.

## Where the data goes **[PLANNED]**

None of the forms send anything yet; the endpoints do not exist. When the
backend described in `docs/backend-architecture.md` is built, list here:
- the server and database host, and the country the data is stored in
  **[DECIDE] [LEGAL]** (cross-border transfer rules apply);
- each processor (for example a database provider, Meta for WhatsApp Business
  messages, a transactional email provider, a payment provider), with what
  each receives **[DECIDE]**;
- who at the clinic can see booking and enquiry data **[DECIDE]**.

## How long it is kept

**[DECIDE] [LEGAL]** Retention for: booking requests that never become
appointments, enquiries, appointment records, and any medical records (which
fall under separate health-record rules).

Already fixed in the system (verified in the code on 2026-10-20), and to be
stated in the policy:
- Server access logs (IP address, browser, pages visited): 14 days, then
  deleted. Payment-link tokens are never written to them.
- Database backups: the last 14 nightly copies, then deleted.
- Requests that never became appointments (declined, expired, or cancelled
  before being confirmed or paid), with their messages: 6 months (183 days)
  after their last change. **[LEGAL]** to confirm.
- Website questions, and patients' replies to the clinic's WhatsApp messages (which the admin shows next to them): 12 months after being answered. **[LEGAL]** to confirm. Photos, voice notes and documents sent on WhatsApp are not downloaded or kept.
- A patient who replies STOP gets no more WhatsApp messages from the booking system (2026-10-20).
- Message history (who was sent which message, delivery status): 90 days.
- Appointments that happened, and payments: kept for now; the legal minimum
  for clinical and financial records is **[LEGAL]**.
- The periods are settings (`RETAIN_*` in `app.env`), changed without code.
- Staff sign-in sessions: deleted when they expire (12 hours).

## Your rights

**[LEGAL]** List the rights that apply (access, correction, deletion,
objection, withdrawal of consent) and how to exercise them, once the legal
basis and contact address are settled.

What the system can do (2026-10-20): find everything held about a person by
phone or email, give them a copy, and erase it. Requests that never became
appointments are deleted completely; appointments that happened or were paid
keep their date, service and payment but lose name, contact details and note.
The clinic checks who is asking first (runbook, "Requests about personal data").

## Security

**[PLANNED]** Describe the actual measures once the backend exists. Do not
describe measures that are not in place. In the code as of 2026-10-20, and
true once the server runs as set up in `docs/production-runbook.md`:
- HTTPS only, with HSTS; TLS 1.2 or newer.
- Staff sign in with a password and an authenticator code; every change is
  recorded in an audit log.
- Nightly backups are encrypted with a key kept off the server, **once**
  `BACKUP_RECIPIENT` is set (runbook step 5.8). Until then, do not claim it.
- Error logs withhold email addresses, phone numbers and the values a
  database error can quote.
- No analytics, advertising or third-party scripts; the build fails if any
  are added.

## Changes

State how the policy will be updated and dated. **[DECIDE]**

## Once the booking backend is live (added 2026-10-18) **[LEGAL]**

The production setup in `docs/production-runbook.md` adds outside processors.
Each must be named in the policy, covered by a data processing agreement, and
reviewed against Law 81/2018 before real patient data is stored:

| Processor | What it holds or sees | Where |
|---|---|---|
| Supabase | The database (bookings, contact details, notes, payments, website questions) and staff sign-in | The region chosen for the project (recommended: Frankfurt, EU) |
| The VPS provider | The server that runs the site and the PHP API (Apache); requests pass through it, but the database is at Supabase | The server's region (recommended: Frankfurt, EU) |
| Meta (WhatsApp Business Platform) | Patient phone numbers and the message text: appointment day and time, payment links, decline reasons. Messages never name the service, so they don't reveal a condition | Meta's infrastructure |
| Resend (email) | Staff notices only: a booking reference and its day and time, or that a website question arrived. Questions themselves stay in the database, behind the admin sign-in | The provider's region |
| Whish Money (when online payment is on) | The payment, its amount and reference | Whish |

The booking consent line "They are not shared with anyone outside the clinic"
was not accurate once these are in use. **Applied on 2026-10-20** (consent
version `2026-10-20`), still for the clinic's legal adviser to approve:

> I agree to Rayhab storing these details to arrange my appointment. They are
> kept by the clinic and the services it uses to run bookings and send
> messages, and are not sold or used for marketing.

When the wording changes, change `CONSENT_VERSION` in
`site/assets/js/booking.js` too, so each stored request records which
wording the patient agreed to.
