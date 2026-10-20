/* Rayhab, status words.

   Every status the booking API can return, and the words and badge tone the
   pages show for it, in one place. The admin and payment pages read only
   from here, so a status is never named two ways, and a translation is a
   second copy of STRINGS rather than a hunt through the scripts.

   The API is the authority on status. These maps only say how to show it;
   nothing in the browser decides one. An unknown value is shown as it came,
   in neutral, rather than guessed at.

   Plain script: window.RayhabLabels. Under Node: module.exports. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RayhabLabels = api;
})(this, function () {
  'use strict';

  // tone: neutral | pending | info | success | warn | danger
  var APPOINTMENT = {
    requested:            { label: 'Requested', tone: 'pending' },
    approved:             { label: 'Approved', tone: 'info' },
    confirmed:            { label: 'Confirmed', tone: 'success' },
    completed:            { label: 'Completed', tone: 'neutral' },
    declined:             { label: 'Declined', tone: 'danger' },
    cancelled:            { label: 'Cancelled', tone: 'danger' },
    no_show:              { label: 'No-show', tone: 'warn' },
    expired:              { label: 'Expired', tone: 'neutral' },
    reschedule_requested: { label: 'New time proposed', tone: 'pending' }
  };

  var METHOD = {
    none:  { label: 'Not selected', tone: 'neutral' },
    whish: { label: 'Whish', tone: 'info' },
    cash:  { label: 'Cash', tone: 'info' }
  };

  /* Payment status. A failed online attempt is not a payment status: it is
     recorded on the attempt, and the balance stays awaiting payment. The
     pages show it as a flag next to the status (see attemptFlag). */
  var PAYMENT = {
    not_selected:     { label: 'Not selected', tone: 'neutral' },
    awaiting_payment: { label: 'Awaiting payment', tone: 'pending' },
    paid:             { label: 'Paid', tone: 'success' },
    refunded:         { label: 'Refunded', tone: 'neutral' }
  };

  var ATTEMPT = {
    failed:    { label: 'Failed attempt', tone: 'danger' },
    abandoned: { label: 'Checkout left unpaid', tone: 'warn' },
    pending:   { label: 'Verifying with Whish', tone: 'pending' }
  };

  var FINANCIAL = {
    open:   { label: 'Open', tone: 'neutral' },
    closed: { label: 'Closed', tone: 'success' }
  };

  var EVENT = {
    requested:          'Request received',
    approved:           'Approved',
    declined:           'Declined',
    reschedule_proposed:'New time proposed',
    rescheduled:        'Rescheduled',
    confirmed:          'Confirmed',
    cancelled:          'Cancelled',
    completed:          'Marked completed',
    no_show:            'Marked no-show',
    payment_selected:   'Payment method selected',
    checkout_started:   'Whish checkout started',
    payment_failed:     'Whish payment failed',
    payment_verified:   'Whish payment verified',
    cash_recorded:      'Cash received recorded',
    refunded:           'Refunded',
    financial_closed:   'Financial case closed',
    time_blocked:       'Time blocked',
    block_removed:      'Blocked time removed',
    reschedule_accepted:'New time accepted',
    reschedule_rejected:'New time declined by the patient',
    expired:            'Expired',
    enquiry_answered:   'Website question answered',
    enquiry_reopened:   'Website question reopened',
    signed_in:          'Signed in',
    viewed:             'Record opened',
    whatsapp_opt_out:   'Turned off WhatsApp messages',
    retention:          'Old data deleted (schedule)',
    subject_erased:     'Personal data erased (request)'
  };

  var STRINGS = {
    'service.any_practitioner': 'Any practitioner',
    'money.free': 'No charge'
  };

  function pick(map, key) {
    if (key == null || key === '') key = map === METHOD ? 'none' : key;
    return map[key] || { label: key ? String(key).replace(/_/g, ' ') : '—', tone: 'neutral' };
  }

  /* "Cash · Awaiting payment", "Paid · Whish", "Not selected". The labels
     the backend README suggests for the payments dashboard. */
  function paymentSummary(method, status) {
    if (!method || status === 'not_selected') return 'Not selected';
    var m = pick(METHOD, method).label;
    if (status === 'paid') return 'Paid · ' + m;
    if (status === 'refunded') return 'Refunded · ' + m;
    return m + ' · ' + pick(PAYMENT, status).label;
  }

  function attemptFlag(lastAttempt) {
    if (!lastAttempt || !lastAttempt.status || lastAttempt.status === 'succeeded') return null;
    return ATTEMPT[lastAttempt.status] || null;
  }

  // "$80.00", "LBP 7,000,000". Amounts arrive in minor units for USD and
  // whole pounds for LBP, as the API documents.
  function money(amount, currency) {
    if (amount == null || !currency) return '';
    var cur = String(currency).toUpperCase();
    if (cur === 'USD') return '$' + (amount / 100).toFixed(2).replace(/\.00$/, '');
    try {
      return cur + ' ' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount);
    } catch (e) { return cur + ' ' + amount; }
  }

  function t(key) { return STRINGS[key] || key; }

  return {
    APPOINTMENT: APPOINTMENT, METHOD: METHOD, PAYMENT: PAYMENT, ATTEMPT: ATTEMPT,
    FINANCIAL: FINANCIAL, EVENT: EVENT, STRINGS: STRINGS,
    appointment: function (s) { return pick(APPOINTMENT, s); },
    method: function (s) { return pick(METHOD, s); },
    payment: function (s) { return pick(PAYMENT, s); },
    financial: function (closedAt) { return closedAt ? FINANCIAL.closed : FINANCIAL.open; },
    event: function (s) { return EVENT[s] || String(s || '').replace(/_/g, ' '); },
    paymentSummary: paymentSummary, attemptFlag: attemptFlag, money: money, t: t
  };
});
