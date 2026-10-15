// Every status the API can return has words and a tone.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../site/assets/js/api/labels.js');

test('appointment statuses from the spec all have labels', () => {
  const want = { requested: 'Requested', approved: 'Approved', confirmed: 'Confirmed', completed: 'Completed',
                 declined: 'Declined', cancelled: 'Cancelled', no_show: 'No-show' };
  for (const [k, v] of Object.entries(want)) assert.equal(L.appointment(k).label, v);
});

test('payment summaries match the dashboard wording', () => {
  assert.equal(L.paymentSummary(null, 'not_selected'), 'Not selected');
  assert.equal(L.paymentSummary('cash', 'awaiting_payment'), 'Cash · Awaiting payment');
  assert.equal(L.paymentSummary('whish', 'awaiting_payment'), 'Whish · Awaiting payment');
  assert.equal(L.paymentSummary('whish', 'paid'), 'Paid · Whish');
  assert.equal(L.paymentSummary('cash', 'paid'), 'Paid · Cash');
  assert.equal(L.paymentSummary('whish', 'refunded'), 'Refunded · Whish');
});

test('a failed online attempt is a flag, not a payment status', () => {
  assert.equal(L.payment('failed_attempt').tone, 'neutral');   // unknown: shown neutral, not guessed
  assert.equal(L.attemptFlag({ status: 'failed' }).label, 'Failed attempt');
  assert.equal(L.attemptFlag({ status: 'succeeded' }), null);
  assert.equal(L.attemptFlag(null), null);
});

test('financial closure is separate from the appointment', () => {
  assert.equal(L.financial(null).label, 'Open');
  assert.equal(L.financial('2026-10-15T10:00:00Z').label, 'Closed');
});

test('money', () => {
  assert.equal(L.money(8000, 'USD'), '$80');
  assert.equal(L.money(8050, 'USD'), '$80.50');
  assert.equal(L.money(7000000, 'LBP'), 'LBP 7,000,000');
});
