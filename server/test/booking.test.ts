// Patient booking: README.md, "API contracts: patient booking", and
// acceptance checks 1 to 8.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { booking, call, fullDay, setup, type Ctx } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.app.close(); await ctx.db.close(); });

describe('catalog and availability', () => {
  it('lists services with prices, modes and the practitioner', async () => {
    const r = await call(ctx, { url: '/api/services' });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.services.map((s: any) => s.id)).toEqual(['assessment', 'follow', 'online', 'sports', 'pain', 'pain-follow']);
    expect(b.services[0]).toMatchObject({ duration_min: 60, price: { amount: 8000, currency: 'USD' }, practitioner_ids: ['pr-rayan'] });
    expect(b.services[2].modes).toEqual(['online']);
    expect(b.practitioners).toEqual([{ id: 'pr-rayan', name: 'Dr. Rayan Halimeh', title: 'Physiotherapist, DPT' }]);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('offers the clinic grid on an open day, nothing on a closed one or out of range', async () => {
    const day = fullDay(2);
    const r = await call(ctx, { url: `/api/availability?service_id=assessment&mode=clinic&date=${day}` });
    expect(r.json().slots.map((s: any) => s.time)).toEqual(
      new Date(day).getUTCDay() === 6 ? ['09:00', '10:00', '11:00', '12:00'] : ['09:00', '10:00', '11:00', '15:00', '16:00', '17:00']);
    let sunday = fullDay(1); while (new Date(sunday).getUTCDay() !== 0) sunday = new Date(Date.parse(sunday) + 86400000).toISOString().slice(0, 10);
    expect((await call(ctx, { url: `/api/availability?service_id=assessment&mode=clinic&date=${sunday}` })).json().slots).toEqual([]);
    expect((await call(ctx, { url: `/api/availability?service_id=online&mode=clinic&date=${day}` })).json().slots).toEqual([]);
    expect((await call(ctx, { url: `/api/availability?service_id=assessment&mode=clinic&date=2020-01-06` })).json().slots).toEqual([]);
    expect((await call(ctx, { url: `/api/availability?service_id=nope&mode=clinic&date=${day}` })).statusCode).toBe(422);
  });
});

describe('POST /api/appointments', () => {
  it('stores a request and answers "requested" with a reference', async () => {
    const r = await call(ctx, { url: '/api/appointments', body: booking({ time: '10:00' }) });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'requested', reference: expect.stringMatching(/^RQ-\d+$/) });
    const row = await ctx.db.one<any>('select status, consent_version, consent_whatsapp_at from rayhab.appointments where id = $1', [r.json().id]);
    expect(row.status).toBe('requested');
    expect(row.consent_version).toBe('2026-10-15');
    expect(row.consent_whatsapp_at).toBeTruthy();
    const out = await ctx.db.query<any>('select channel, template from rayhab.notification_outbox where appointment_id = $1 order by id', [r.json().id]);
    expect(out.map((o) => o.channel + ':' + o.template)).toEqual(['whatsapp:request_received', 'email:new_request']);
    // The time is now taken for everyone else.
    const slots = (await call(ctx, { url: `/api/availability?service_id=assessment&mode=clinic&date=${fullDay()}` })).json().slots;
    expect(slots.find((s: any) => s.time === '10:00').available).toBe(false);
  });

  it('puts field messages under the right fields (422)', async () => {
    const r = await call(ctx, { url: '/api/appointments', body: booking({ email: 'not-an-email', phone: '71383315', first_name: 'M' }) });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('validation');
    expect(Object.keys(r.json().errors).sort()).toEqual(['email', 'first_name', 'phone']);
    const c = await call(ctx, { url: '/api/appointments', body: booking({ consents: { storage: true, whatsapp: false, version: 'x' } }) });
    expect(c.statusCode).toBe(422);
    expect(c.json().errors).toHaveProperty('consents');
  });

  it('rejects the honeypot and other origins, stores nothing', async () => {
    const before = (await ctx.db.one<any>('select count(*)::int as n from rayhab.appointments'))!.n;
    expect((await call(ctx, { url: '/api/appointments', body: booking({ website: 'spam.example', time: '11:00' }) })).statusCode).toBe(400);
    expect((await call(ctx, { url: '/api/appointments', body: booking({ time: '11:00' }), headers: { origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await ctx.db.one<any>('select count(*)::int as n from rayhab.appointments'))!.n).toBe(before);
  });

  it('two requests for one slot at the same moment: one succeeds, one gets 409', async () => {
    const day = fullDay(3);
    const [a, b] = await Promise.all([
      call(ctx, { url: '/api/appointments', body: booking({ date: day, time: '15:00', phone: '+96170000201' }) }),
      call(ctx, { url: '/api/appointments', body: booking({ date: day, time: '15:00', phone: '+96170000202' }) })
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect([a, b].find((x) => x.statusCode === 409)!.json().error.code).toBe('slot_taken');
  });

  it('the database itself refuses an overlap, whatever the application checked', async () => {
    const row = await ctx.db.one<any>(`select practitioner_id, starts_at, ends_at, patient_id, service_id from rayhab.appointments where status = 'requested' limit 1`);
    await expect(ctx.db.query(`insert into rayhab.appointments (id, reference, patient_id, practitioner_id, service_id, mode, for_whom, starts_at, ends_at,
      local_date, local_time, status, consent_storage_at, consent_version)
      values ('apt_x', 'RQ-X', $1, $2, $3, 'clinic', 'me', $4, $5, '2026-01-01', '09:00', 'approved', now(), 'x')`,
      [row.patient_id, row.practitioner_id, row.service_id, row.starts_at, row.ends_at])).rejects.toMatchObject({ code: '23P01' });
  });

  it('a repeated Idempotency-Key returns the first answer and books once', async () => {
    const day = fullDay(4);
    const body = booking({ date: day, time: '16:00', phone: '+96170000301' });
    const h = { 'idempotency-key': 'same-key-1' };
    const one = await call(ctx, { url: '/api/appointments', body, headers: h });
    const two = await call(ctx, { url: '/api/appointments', body, headers: h });
    expect(one.statusCode).toBe(201);
    expect(two.statusCode).toBe(201);
    expect(two.json()).toEqual(one.json());
    const n = await ctx.db.one<any>(`select count(*)::int as n from rayhab.appointments a join rayhab.patients p on p.id = a.patient_id where p.phone_e164 = '+96170000301'`);
    expect(n.n).toBe(1);
    const other = await call(ctx, { url: '/api/appointments', body: { ...body, time: '17:00' }, headers: h });
    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe('idempotency_mismatch');
  });

  it('limits requests per number per day (429)', async () => {
    const day = fullDay(10);
    const times = ['09:00', '10:00', '11:00', '15:00', '16:00', '17:00'];
    const codes: number[] = [];
    for (const t of times) codes.push((await call(ctx, { url: '/api/appointments', body: booking({ date: day, time: t, phone: '+96170000401' }),
                                                       headers: { 'x-forwarded-for': '10.0.0.' + codes.length } })).statusCode);
    expect(codes.filter((c) => c === 201).length).toBe(5);
    expect(codes[codes.length - 1]).toBe(429);
  });
});

describe('Beirut daylight saving', () => {
  it('stores 09:00 Beirut as 06:00 UTC in summer and 07:00 UTC in winter', async () => {
    // 24 Oct 2026 (Sat, GMT+3), 26 Oct 2026 (Mon, GMT+2), 26 Mar 2027 (Fri, GMT+2), 29 Mar 2027 (Mon, GMT+3).
    const cases: [string, string][] = [['2026-10-24', '06:00'], ['2026-10-26', '07:00'], ['2027-03-26', '07:00'], ['2027-03-29', '06:00']];
    for (const [date, utc] of cases) {
      if (date <= new Date().toISOString().slice(0, 10)) continue;   // already past when the suite runs
      const r = await call(ctx, { url: '/api/appointments', body: booking({ date, time: '09:00', phone: '+9617000' + date.replace(/-/g, '').slice(2) }) });
      expect(r.statusCode).toBe(201);
      const row = await ctx.db.one<any>('select starts_at from rayhab.appointments where id = $1', [r.json().id]);
      expect(new Date(row.starts_at).toISOString()).toBe(date + 'T' + utc + ':00.000Z');
    }
  });
});

describe('POST /api/enquiries', () => {
  it('succeeds only with "received", field errors otherwise', async () => {
    const ok = await call(ctx, { url: '/api/enquiries', body: { first_name: 'Karim', last_name: 'Saad', email: 'k@example.com', phone: '', message: 'Do you treat adults with scoliosis?' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toEqual({ status: 'received' });
    const bad = await call(ctx, { url: '/api/enquiries', body: { first_name: 'K', last_name: 'Saad', email: 'nope', message: 'short' } });
    expect(bad.statusCode).toBe(422);
    expect(Object.keys(bad.json().errors).sort()).toEqual(['email', 'first_name', 'message']);
  });
});
