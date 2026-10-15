// Beirut time: calendar days, offsets and daylight saving.
// Lebanon leaves summer time at 00:00 on the last Sunday of October and
// returns at 00:00 on the last Sunday of March.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../site/assets/js/api/time.js');

test('offset label follows Beirut summer and winter time', () => {
  assert.equal(T.offsetLabel('2026-10-24', '09:00'), 'GMT+3');
  assert.equal(T.offsetLabel('2026-10-25', '09:00'), 'GMT+2');
  assert.equal(T.offsetLabel('2027-03-27', '09:00'), 'GMT+2');
  assert.equal(T.offsetLabel('2027-03-28', '09:00'), 'GMT+3');
});

test('a Beirut wall time becomes the right instant across both changes', () => {
  assert.equal(new Date(T.toUtc('2026-10-24', '09:00')).toISOString(), '2026-10-24T06:00:00.000Z');
  assert.equal(new Date(T.toUtc('2026-10-26', '09:00')).toISOString(), '2026-10-26T07:00:00.000Z');
  assert.equal(new Date(T.toUtc('2027-03-29', '17:15')).toISOString(), '2027-03-29T14:15:00.000Z');
});

test('instant back to Beirut date and time round-trips', () => {
  for (const [d, t] of [['2026-10-25', '00:30'], ['2026-12-31', '23:45'], ['2027-03-28', '09:00']]) {
    assert.deepEqual(T.fromInstant(T.toUtc(d, t)), { date: d, time: t });
  }
});

test('today is the Beirut date, not the visitor clock', () => {
  // 22:30 UTC on 14 Oct is already 01:30 on 15 Oct in Beirut (GMT+3).
  assert.equal(T.today(Date.UTC(2026, 9, 14, 22, 30)), '2026-10-15');
  // 21:30 UTC on 30 Oct is 23:30 the same day in Beirut (GMT+2 by then).
  assert.equal(T.today(Date.UTC(2026, 9, 30, 21, 30)), '2026-10-30');
});

test('calendar arithmetic ignores daylight saving', () => {
  assert.equal(T.addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(T.addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(T.addDays('2027-03-27', 2), '2027-03-29');
  assert.equal(T.daysBetween('2026-10-20', '2026-11-03'), 14);
  assert.equal(T.dow('2026-10-25'), 0);   // Sunday
});

test('the "your time" hint appears only when the clocks differ', () => {
  assert.equal(T.localHint('2026-10-20', '09:00', 'Asia/Beirut'), '');
  assert.equal(T.localHint('2026-10-20', '09:00', 'Europe/Istanbul'), '');   // also GMT+3 that day
  assert.equal(T.localHint('2026-10-20', '09:00', 'Europe/Paris'), '08:00');
  assert.equal(T.localHint('2026-10-20', '09:00', 'America/New_York'), '02:00');
  assert.equal(T.localHint('2026-10-20', '01:00', 'America/Los_Angeles'), '15:00 on Mon 19 Oct');
});

test('calendar files are written in UTC', () => {
  assert.equal(T.icsStamp(T.toUtc('2026-11-02', '15:00')), '20261102T130000Z');
});
