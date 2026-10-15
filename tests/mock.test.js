// The demo backend keeps the rules the real one must keep (README.md,
// "Acceptance checks"), so the pages are never shown a state that the real
// server could not produce.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../site/assets/js/api/mock.js');

const staff = { 'X-CSRF-Token': 'demo-csrf' };
const mock = (scenario) => M.create({ instant: true, scenario: scenario || 'success' });

test('choosing cash never marks the payment paid', async () => {
  const m = mock();
  const r = await m.handle('POST', '/payment-selection/demo-approved', { method: 'cash' });
  assert.equal(r.status, 200);
  assert.equal(r.body.payment.method, 'cash');
  assert.equal(r.body.payment.status, 'awaiting_payment');
});

test('cash is recorded once, however often it is sent', async () => {
  const m = mock();
  const a = m.tokenAppt('demo-cash');
  const id = a.payment.id, amount = a.payment.outstanding;
  const url = '/admin/payments/' + id + '/confirm-cash';
  const one = await m.handle('POST', url, { amount, currency: 'USD' }, { ...staff, 'Idempotency-Key': 'k1' });
  assert.equal(one.body.payment.status, 'paid');
  const again = await m.handle('POST', url, { amount, currency: 'USD' }, { ...staff, 'Idempotency-Key': 'k1' });
  assert.equal(again.status, 200);                       // same key: the same result
  const other = await m.handle('POST', url, { amount, currency: 'USD' }, { ...staff, 'Idempotency-Key': 'k2' });
  assert.equal(other.status, 409);                       // new key: refused, already recorded
  assert.equal(a.payment.transactions.filter(t => t.provider === 'cash').length, 1);
  assert.deepEqual(a.payment.actions, []);
});

test('coming back from Whish is not proof of payment', async () => {
  const m = mock();
  await m.handle('POST', '/payment-selection/demo-approved', { method: 'whish' });
  const co = await m.handle('POST', '/payments/whish/create', { token: 'demo-approved' });
  assert.ok(co.body.checkout_url);
  const back = await m.handle('GET', '/payment-selection/demo-approved');
  assert.equal(back.body.payment.status, 'awaiting_payment');
  m.settleWhish(m.tokenAppt('demo-approved'), 'failed');
  const failed = await m.handle('GET', '/payment-selection/demo-approved');
  assert.equal(failed.body.payment.status, 'awaiting_payment');
  assert.equal(failed.body.can_retry, true);
});

test('a verified Whish payment closes the financial case, not the appointment', async () => {
  const m = mock();
  for (let i = 0; i < 3; i++) await m.handle('GET', '/payment-selection/demo-verifying');
  const a = m.tokenAppt('demo-verifying');
  assert.equal(a.payment.status, 'paid');
  assert.ok(a.financial_closed_at);
  assert.equal(a.status, 'confirmed');                   // not completed
});

test('a request is only ever "requested", and a slot is taken once', async () => {
  const m = mock();
  const day = (await m.handle('GET', '/admin/appointments?status=requested', null, staff)).body.items[0].local_date;
  let slots = (await m.handle('GET', '/availability?service_id=assessment&date=' + day)).body.slots;
  const free = slots.find(s => s.available);
  const body = { service_id: 'assessment', mode: 'clinic', date: day, time: free.time, first_name: 'A', last_name: 'B',
                 phone: '+9613123456', consents: { storage: true, whatsapp: true, version: 'x' } };
  const r = await m.handle('POST', '/appointments', body);
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'requested');
  const twice = await m.handle('POST', '/appointments', body);
  assert.equal(twice.status, 409);
  slots = (await m.handle('GET', '/availability?service_id=assessment&date=' + day)).body.slots;
  assert.equal(slots.find(s => s.time === free.time).available, false);
});

test('the honeypot and missing consent are refused', async () => {
  const m = mock();
  assert.equal((await m.handle('POST', '/appointments', { website: 'x', consents: { storage: true, whatsapp: true } })).status, 400);
  assert.equal((await m.handle('POST', '/appointments', { consents: { storage: true } })).status, 422);
});

test('only offered actions are accepted', async () => {
  const m = mock();
  const done = (await m.handle('GET', '/admin/appointments?status=completed', null, staff)).body.items[0];
  const r = await m.handle('POST', '/admin/appointments/' + done.id + '/approve', {}, staff);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'invalid_transition');
});

test('staff changes need the CSRF token, and an ended session says so', async () => {
  const m = mock();
  const req = (await m.handle('GET', '/admin/appointments?status=requested', null, staff)).body.items[0];
  assert.equal((await m.handle('POST', '/admin/appointments/' + req.id + '/approve', {}, {})).status, 403);
  const gone = mock('session_expired');
  const r = await gone.handle('POST', '/admin/appointments/' + req.id + '/approve', {}, staff);
  assert.equal(r.status, 401);
  assert.ok(r.body.login_url);
});

test('expired and unknown payment links', async () => {
  const m = mock();
  assert.equal((await m.handle('GET', '/payment-selection/demo-expired')).status, 410);
  assert.equal((await m.handle('GET', '/payment-selection/nope-nope')).status, 404);
});
