# Privacy policy: working draft (not published)

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

## Your rights

**[LEGAL]** List the rights that apply (access, correction, deletion,
objection, withdrawal of consent) and how to exercise them, once the legal
basis and contact address are settled.

## Security

**[PLANNED]** Describe the actual measures once the backend exists (HTTPS,
access control, encrypted backups). Do not describe measures that are not in
place.

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
| Meta (WhatsApp Business Platform) | Patient phone numbers and the message text | Meta's infrastructure |
| Resend (email) | Staff notices only: a booking reference, the service and time, or that a website question arrived. Questions themselves stay in the database, behind the admin sign-in | The provider's region |
| Whish Money (when online payment is on) | The payment, its amount and reference | Whish |

The booking consent line "They are not shared with anyone outside the clinic"
is not accurate once these are in use. A suggested replacement, for the
clinic's legal adviser to approve:

> I agree to Rayhab storing these details to arrange my appointment. They are
> kept by the clinic and the services it uses to run bookings and send
> messages, and are not sold or used for marketing.

When the wording changes, change `CONSENT_VERSION` in
`site/assets/js/booking.js` too, so each stored request records which
wording the patient agreed to.
