<!--
  Frontend booking specification, as supplied by the project owner
  (2026-10-15). Kept verbatim below this note.

  What was built against it, and the API contracts the pages use, are in
  README.md, "Launch and backend handoff". Differences from the proposed
  paths: the booking page is site/book.html (not booking.html); the API
  modules live in site/assets/js/api/ (the site has no src/js); the admin
  is one page, site/admin/index.html, with #/sections rather than separate
  appointments.html and payments.html files.
-->

# Rayhab Movement Clinic — Frontend Booking Experience

**Website:** https://dr-rayhab.com  
**Market:** Lebanon  
**Document owner:** Website / frontend development  
**Backend handoff:** See `README.md` for server-side architecture, proposed API contracts, data model, and deployment recommendations.

## 1. Scope and ownership

This document specifies the **patient-facing booking experience**, **payment-method selection experience**, and **physiotherapist admin interface**. It intentionally does **not** prescribe how to provision the VPS, implement PostgreSQL, build the API, process Whish callbacks, or deliver WhatsApp messages. Those responsibilities belong to the separate backend developer and are documented in `README.md`.

### Frontend scope

- Retain the existing website's visual identity, HTML structure, Tailwind CSS v4, custom CSS, vanilla JavaScript, and GSAP animations.
- Extend the existing booking flow to display service and practitioner availability provided by an API.
- Present booking request and approval states clearly; never imply an unapproved request is confirmed.
- Build a secure-link landing page where patients select **Whish online payment** or **cash at clinic**.
- Build the physiotherapist's responsive admin interface for appointments, approvals, schedule views, payment tracking, and cash-receipt confirmation.
- Integrate against a documented API contract provided by the backend developer, with loading, error, expired-link, and retry states.
- Add accessible interactions, localization-ready strings, and automated frontend checks.

### Outside frontend scope

- Database provisioning and schema migrations
- VPS, Nginx, Docker, and server runtime configuration
- Authentication implementation, session issuance, and authorization enforcement
- Whish merchant API integration and payment verification
- WhatsApp Cloud API templates, delivery, and retries
- Email delivery, background jobs, webhook processing, and reconciliation
- Healthcare data hosting/compliance determination

The frontend **must not** embed merchant secrets, WhatsApp credentials, privileged database keys, or trust browser-side status changes as proof of payment.

## 2. Existing website: preserve the stack

| Area | Current implementation | Frontend decision |
|---|---|---|
| Public pages | Handwritten HTML in `site/` | Preserve |
| Generated pages | Python scripts in `content/` | Preserve |
| Styling | Tailwind v4 CLI + modular CSS in `src/css/` | Extend existing components |
| Fonts | Bricolage Grotesque and Public Sans | Preserve |
| Interactions | `ui.js`, `booking.js`, `modal.js`, `contact.js` | Extend booking and modal logic |
| Animation | Locally bundled GSAP 3.13 | Preserve; respect reduced-motion preferences |
| Builds | `npm run build`, Python stamp/nav/motion scripts | Preserve |
| Validation | `.github/scripts/check_links.py` | Extend tests for new routes |
| Hosting | Private Linux VPS, `dr-rayhab.com` | Backend developer manages server changes |

Do **not** migrate the frontend to Next.js or React solely for this booking feature.

## 3. Patient booking journey

1. **Select service.** Display treatment name, duration, price/currency, and optional practitioner choice. The server remains authoritative for price and duration.
2. **Select date.** Render a mobile-friendly calendar with unavailable days disabled. Display times in Lebanon's local time zone (`Asia/Beirut`).
3. **Select available time.** Request available slots from the API for the selected service, practitioner, and date. Show a loading skeleton and an empty state when no slots exist.
4. **Enter contact information.** Collect only essential fields: name, contact number with country code, email if needed, and communication consent. Avoid medical history in the initial form.
5. **Review and request.** Show service, date, time, contact details, and a clear button labeled **Request Appointment**. Revalidate with the server on submission.
6. **Pending approval screen.** Confirm that the request was **received**, not that the appointment was approved. Explain that the physiotherapist will review it and the patient will be contacted.
7. **Approval notification.** Once the backend processes approval, the patient receives WhatsApp instructions and a secure link to choose a payment method.
8. **Payment choice.** On the clinic website, select Whish or cash. Render the appropriate next step and updated state returned by the API.
9. **Final state.** For Whish, display **Payment pending verification** until the server confirms success. For cash, display **Appointment confirmed, payment due at clinic** only if that matches the backend booking policy.

### Suggested booking interface states

`idle`, `loading_availability`, `availability_loaded`, `no_slots`, `submitting`, `request_received`, `request_failed`, `slot_no_longer_available`, `session_expired`.

Handle slot contention with a helpful message and a one-click refresh of availability. Disable duplicate submissions while a request is in flight.

## 4. Payment selection page

**Suggested route:** `https://dr-rayhab.com/payment/` (exact URL coordinated with backend).

This page opens from a secure, time-limited WhatsApp link. The backend validates the token and returns only the information needed to display the appointment.

### Display

- Clinic name and consistent branding
- Appointment service, practitioner, date, local time, and price
- Current appointment approval state
- Payment methods: **Pay Online with Whish** and **Pay Cash at the Clinic**
- Explanation of cash collection timing and any payment deadline
- A clear confirmation action

### Whish selection

- Submit the choice to the backend.
- Receive an authorized checkout URL and navigate to it.
- On return, show **Verifying payment** until a status API reports verified payment.
- Show `paid`, `awaiting_payment`, `failed_attempt`, or `expired` states as appropriate.
- Offer a retry option only when the backend permits it.

### Cash selection

- Submit the choice to the backend.
- Display **Cash selected · Awaiting payment** and any appointment confirmation details supplied by the backend.
- Do not mark the balance as paid merely because the patient selected cash.

### Error and edge states

- Invalid or expired payment link
- Appointment cancelled or declined
- Method selection already finalized
- Whish unavailable or checkout initialization failed
- Patient leaves checkout before paying
- Payment verification delayed
- Network loss or request timeout

No sensitive patient information should be placed in analytics events, query parameters beyond an opaque token, or browser storage.

## 5. Physiotherapist admin dashboard

**Suggested route:** `https://dr-rayhab.com/admin/`.

The backend developer supplies the authenticated session and authorization checks. The frontend supplies the dashboard layout and API-driven interactions.

### Dashboard sections

**Overview:** Today's appointments, requests awaiting approval, outstanding balances, payments received, and relevant alerts.

**Appointment requests:** Patient contact summary, service, practitioner, proposed time, and actions to approve, decline, or suggest an alternative time. Display confirmation dialogs for consequential actions.

**Calendar:** Day/week schedule with clear status indicators; controls to request schedule updates or mark blocked times through the API.

**Payments:** Appointment, payment method, amount/currency, payment status, receipt reference, and last update. Distinguish Whish-verified payments from manually confirmed cash receipts.

**Cash collection:** Show a **Confirm Cash Received** action only when the backend says the staff member is permitted. Ask for confirmation and optionally amount/reference; send to the API and update from the returned authoritative state.

**Activity history:** Display meaningful changes such as approved, declined, payment selected, payment verified, cash recorded, cancelled, and financial case closed.

### Recommended dashboard statuses

| Dimension | Display examples |
|---|---|
| Appointment | Requested, Approved, Confirmed, Completed, Declined, Cancelled, No-show |
| Payment method | Not selected, Whish, Cash |
| Payment | Awaiting payment, Paid, Failed attempt, Refunded |
| Financial closure | Open, Closed |

**Financial closure is not clinical completion.** A paid appointment should not automatically be marked as a completed treatment session.

### UX requirements

- Responsive on mobile, tablet, and desktop
- Search and filters for appointment date, status, practitioner, and payment method
- Loading skeletons, empty states, clear error messages, and optimistic UI only for reversible actions
- Confirmation prompts for approvals, cancellations, and cash receipt actions
- Server-authoritative refresh after mutations; prevent duplicate submissions
- Accessible form labels, keyboard support, focus management, and contrast
- No patient data cached in shared browser storage

## 6. Frontend/API coordination contract

The frontend developer should agree on a typed API contract with the backend developer before connecting real data. At minimum, define:

- Availability request/response fields and local-time representation
- Booking submission payload and returned request identifier/status
- Admin appointment list/detail response shapes
- Approve/decline mutation responses and errors
- Secure payment-link validation response
- Payment-method selection response
- Whish checkout initialization response
- Read-only payment-status polling response
- Cash receipt confirmation request/response
- Authentication session and unauthorized/expired-session behavior
- Stable machine-readable error codes, pagination, and idempotency behavior

**Frontend rule:** show statuses returned by the API; never infer payment success from a redirect, button click, or locally stored value.

## 7. Proposed frontend project additions

```text
site/
  booking.html                 # Existing booking page; enhance in place
  admin/
    index.html                 # Practitioner dashboard
    appointments.html          # Appointment management
    payments.html              # Payment review
  payment/
    index.html                 # Secure payment-method selection
src/
  js/
    booking.js                 # Existing booking flow
    modal.js                   # Existing dialogs
    admin.js                   # New admin UI
    payment.js                 # New patient payment-choice UI
    api/
      client.js                # Fetch wrapper, errors, timeouts
      availability.js          # Availability reads
      appointments.js          # Booking requests and admin mutations
      payments.js              # Payment choice and status reads
  css/
    ...                        # Existing modular styles
    booking-flow.css           # Extend existing booking styles as appropriate
README.md                      # Backend developer handoff and full project structure
```

Paths are proposed, not assertions about existing files. Fit new modules into the repository's actual conventions. Preserve the Python content generators and current build/stamping process.

## 8. Frontend testing and acceptance criteria

- Availability updates when service, practitioner, or date changes.
- The calendar handles Beirut daylight-saving transitions correctly.
- A slot that becomes unavailable is rejected gracefully without false confirmation.
- Submitting twice does not create two visible successful requests.
- Approval and decline states display correctly after backend updates.
- Secure payment link errors and expiration have helpful screens.
- Whish success is shown **only** after backend verification.
- Cash selection displays unpaid until an authorized receipt is recorded.
- Dashboard payment status refreshes correctly after both payment methods.
- Cash receipt action cannot be repeated accidentally in the UI.
- The entire experience is usable on narrow mobile screens.
- Existing pages, GSAP effects, internal links, and generated content still build correctly.
- Browser bundle contains no backend or payment-provider secrets.

## 9. Frontend delivery order

1. Confirm API contract and backend status definitions.
2. Integrate live availability into the existing booking interface.
3. Implement booking request submission and pending-approval UX.
4. Build the secure payment selection page.
5. Build the admin dashboard and appointment approval views.
6. Add payment status views and cash confirmation UI.
7. Test with mocked responses, then staging APIs, then production.

## 10. Backend handoff

The separate developer should use **`README.md`** for the proposed server architecture, schema, API routes, Whish integration, WhatsApp messaging, deployment, security, and project structure. This frontend document deliberately limits itself to user-facing requirements and API coordination.
