# Terms for booking requests: decisions needed (not published)

**The page itself:** `site/terms.html` is the patient-facing draft, "Booking, payment and cancellation", written from this file and the booking system as built on 2026-10-20; the decisions below are its highlighted placeholders. Review it on staging at `/terms.html`. Like the privacy page, it is hidden from search engines, linked from nowhere, and its `data-draft` attribute stops any deploy to production until removed. Once approved: resolve the placeholders, remove `data-draft`, the banner and the noindex tag, and link it from the booking review step, the payment page and the footer.

**Found while drafting it, and decided:** the site promises a reply within one working day, but a requested time was held for only 24 hours, so a request made on a Saturday afternoon lapsed before a Monday reply. The hold is now 72 hours (`HOLD_HOURS`, 2026-10-20), which covers a weekend; a proposed new time is held as long.

**Status:** not a terms-and-conditions document. The site sells nothing
online, has no accounts and takes no payment today, so full website terms are
not yet needed. What *is* needed before launch is a short, accurate statement
of the booking rules, because the booking flow makes promises a patient will
rely on. This page lists those promises and the decisions behind them. No
legal text is invented here.

## What the site currently promises (verified 2026-10-15)

- A booking is a **request**, not a confirmed appointment; nothing is reserved
  until the clinic confirms.
- The clinic **replies by WhatsApp within one working day**.
- **Nothing is charged online** at the request stage.
- After confirmation the patient **chooses how to pay: at the clinic, or
  online where offered, through a secure link** (from the planned backend).
- Requests can be made from the day after today up to **90 days** ahead.

Each of these must be true in practice before launch.

## Decisions needed **[DECIDE]**

1. **Response time.** Can the clinic actually reply within one working day,
   every working day? What are the working days and hours? (None are shown on
   the site.)
2. **Hold policy.** Is a requested slot held while the clinic reviews it? For
   how long? (Also open in `docs/backend-architecture.md`, section 15.)
3. **Payment.** Cash at the clinic only, or Whish online as well? Before or
   after the session? In USD, LBP or both? The success screen's step 3 says
   "at the clinic, or online where offered"; narrow it once decided.
4. **Cancellation and no-shows.** How much notice is needed to cancel or
   reschedule, and is there any fee? Nothing is stated today.
5. **Online consultations.** Which platform, which countries, and whether
   anything differs for patients outside Lebanon.
6. **Minors.** Requests can be made "for my child". Who must attend and who
   consents to treatment?
7. **Prices.** Should prices be shown before a request? None are today.

## Once decided

Publish the answers as a short "Booking and cancellation" section, linked from
the booking flow's review step and the footer, written plainly and checked by
the clinic's legal adviser. **[LEGAL]**
