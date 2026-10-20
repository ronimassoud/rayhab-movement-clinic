/* Rayhab, demo backend.

   An in-memory stand-in for every /api endpoint in README.md, so the
   booking flow, the payment page and the admin can be reviewed end to end
   before the real backend exists. Loaded by api/client.js only with
   ?demo=1, and only where demo mode is allowed (staging and localhost; the
   production pages carry no <meta name="rayhab-demo">).

   It follows the documented contracts and the rules the real server must
   keep: a booking is only ever "requested"; a Whish payment is paid only
   after verification, never because the browser came back from checkout;
   cash is paid only when staff record it, once; actions are offered per
   record by the server. Nothing leaves the page and nothing is stored,
   except the chosen demo scenario in sessionStorage. Reloading starts
   again from the same fixtures.

   Plain script: window.RayhabMock. Under Node, module.exports exposes
   create() so tests/mock.test.js can drive the state machine directly. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./time.js'));
  } else {
    root.RayhabMock = factory(root.RayhabTime).create();
    root.RayhabMock.mountBanner();
  }
})(this, function (T) {
  'use strict';

  var SCENARIOS = {
    booking: [
      ['success', 'Request succeeds'],
      ['slot_taken', 'Time taken meanwhile (409)'],
      ['validation', 'Server rejects email and phone (422)'],
      ['no_slots', 'No times left on any day'],
      ['availability_down', 'Availability cannot be loaded'],
      ['expired', 'Booking session expired (410)'],
      ['rate_limited', 'Too many requests (429)'],
      ['server_error', 'Server error (500)'],
      ['slow', 'Server too slow (timeout)']
    ],
    admin: [
      ['success', 'Signed in, everything works'],
      ['session_expired', 'Session expires on the next change'],
      ['signed_out', 'Signed out'],
      ['conflict', 'Approvals hit a taken slot (409)'],
      ['server_error', 'Every change fails (500)'],
      ['empty', 'No appointments at all']
    ],
    payment: [
      ['demo-approved', 'Approved, choose a method'],
      ['demo-cash', 'Cash chosen, awaiting payment'],
      ['demo-verifying', 'Back from Whish, verifying'],
      ['demo-slowverify', 'Verification delayed'],
      ['demo-failed', 'Whish attempt failed'],
      ['demo-paid', 'Paid with Whish'],
      ['demo-whishdown', 'Whish unavailable'],
      ['demo-onlycash', 'Cash only, method locked'],
      ['demo-declined', 'Request declined'],
      ['demo-cancelled', 'Appointment cancelled'],
      ['demo-newtime', 'New time proposed'],
      ['demo-expired', 'Link expired'],
      ['demo-invalid', 'Link not recognized']
    ]
  };

  var SERVICES = [
    { id: 'assessment', name: 'Scoliosis assessment', duration_min: 60, tag: 'Start here',
      description: 'First visit. Three-dimensional assessment, movement screen, and the first version of your plan.',
      price: { amount: 8000, currency: 'USD' }, modes: ['clinic', 'online'] },
    { id: 'follow', name: 'Scoliosis rehabilitation session', duration_min: 45, tag: '',
      description: 'Coached corrective exercise and progression. For existing patients.',
      price: { amount: 6000, currency: 'USD' }, modes: ['clinic'] },
    { id: 'online', name: 'Online scoliosis consultation', duration_min: 40, tag: '',
      description: 'Imaging review, exercise guidance and a remote plan. For patients outside Lebanon.',
      price: { amount: 6000, currency: 'USD' }, modes: ['online'] },
    { id: 'sports', name: 'Sports or general physiotherapy', duration_min: 45, tag: '',
      description: 'Injury rehabilitation, return to sport, mobility and joint training.',
      price: { amount: 6000, currency: 'USD' }, modes: ['clinic'] },
    { id: 'pain', name: 'Pain management assessment', duration_min: 60, tag: '',
      description: 'Persistent or recurring pain: a full assessment, a clear explanation and a graded plan.',
      price: { amount: 8000, currency: 'USD' }, modes: ['clinic', 'online'] },
    { id: 'pain-follow', name: 'Pain management follow-up', duration_min: 45, tag: '',
      description: 'Coached graded activity, progression and updates to your home program. For existing patients.',
      price: { amount: 6000, currency: 'USD' }, modes: ['clinic'] }
  ];
  var PRACTITIONERS = [
    { id: 'pr-rayan', name: 'Dr. Rayan Halimeh', title: 'Physiotherapist, DPT' }
  ];
  SERVICES.forEach(function (s) { s.practitioner_ids = ['pr-rayan']; });

  var CLOSED_DOW = [0, 3];
  var HOURS = {
    1: [['09:00', '12:00'], ['15:00', '18:00']], 2: [['09:00', '12:00'], ['15:00', '18:00']],
    4: [['09:00', '12:00'], ['15:00', '18:00']], 5: [['09:00', '12:00'], ['15:00', '18:00']],
    6: [['09:00', '13:00']]
  };
  var HORIZON = 90;

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function svc(id) { return SERVICES.filter(function (s) { return s.id === id; })[0]; }
  function prac(id) { return PRACTITIONERS.filter(function (p) { return p.id === id; })[0]; }
  function err(status, code, message, extra) {
    var body = { error: { code: code, message: message } };
    if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    return { status: status, body: body };
  }
  function ok(body, status) { return { status: status || 200, body: body }; }

  function create(opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var store = {};
    try { store = window.sessionStorage; } catch (e) { store = {}; }
    function scenario() {
      if (opts.scenario) return opts.scenario;
      var fromUrl = typeof location !== 'undefined' && /[?&]scenario=([\w-]+)/.exec(location.search);
      if (fromUrl) return fromUrl[1];
      try { return store.getItem ? (store.getItem('rayhab-demo-scenario') || 'success') : 'success'; }
      catch (e) { return 'success'; }
    }
    function setScenario(v) {
      if (opts.scenario) { opts.scenario = v; return; }
      try { if (store.setItem) store.setItem('rayhab-demo-scenario', v); } catch (e) { /* private mode */ }
    }
    function iso(ms) { return new Date(ms).toISOString(); }
    var today = T.today(now());

    function openDay(from) {
      var d = from;
      for (var i = 0; i < 10; i++) { if (CLOSED_DOW.indexOf(T.dow(d)) < 0) return d; d = T.addDays(d, 1); }
      return from;
    }

    function lastOpen(from) {
      var d = from;
      for (var i = 0; i < 10; i++) { if (CLOSED_DOW.indexOf(T.dow(d)) < 0) return d; d = T.addDays(d, -1); }
      return from;
    }

    /* ---------- Fixture appointments ---------- */
    var seq = 1040;
    var appts = [];
    var events = [];
    var exceptions = [];
    var enquiries = scenario() === 'empty' ? [] : [
      { id: '7f1c2a90-0000-4000-8000-000000000001', name: 'Rana Khalil', email: 'rana@example.com', phone: '+961 70 000 201',
        message: 'Hello, my daughter is 13 and was told she has a 22 degree curve. Is an assessment the right first step, and do you see children on Saturdays?',
        created_at: iso(now() - 30 * 3600000), status: 'open', answered_at: null, answered_by: null },
      { id: '7f1c2a90-0000-4000-8000-000000000002', name: 'Georges Abi Nader', email: 'georges@example.com', phone: null,
        message: 'Do you offer online follow-ups for patients in Dubai after a first visit in Beirut?',
        created_at: iso(now() - 4 * 3600000), status: 'open', answered_at: null, answered_by: null },
      { id: '7f1c2a90-0000-4000-8000-000000000003', name: 'Hiba Saleh', email: 'hiba@example.com', phone: '+961 3 000 203',
        message: 'Is there parking near the clinic?',
        created_at: iso(now() - 80 * 3600000), status: 'answered', answered_at: iso(now() - 70 * 3600000), answered_by: { name: 'Dr. Rayan Halimeh' } }
    ];
    var eseq = 1;

    function payment(method, status, amount) {
      return { id: 'pay_' + (seq + 1), method: method || null, status: status || 'not_selected',
               amount: amount, currency: 'USD', outstanding: status === 'paid' ? 0 : amount,
               last_attempt: null, verified_by: null, receipt_reference: null, recorded_by: null,
               transactions: [], updated_at: iso(now()) };
    }

    function add(o) {
      seq += 1;
      var s = svc(o.service), p = prac(o.practitioner || 'pr-rayan');
      var date = o.date, time = o.time;
      var start = T.toUtc(date, time);
      var age = o.age == null ? 2 : o.age;
      var a = {
        id: 'apt_' + seq, reference: 'RQ-' + seq, status: o.status,
        service: { id: s.id, name: s.name, duration_min: s.duration_min },
        practitioner: { id: p.id, name: p.name },
        mode: o.mode || 'clinic', for_whom: o.for_whom || 'me',
        start: iso(start), end: iso(start + s.duration_min * 60000),
        local_date: date, local_time: time, timezone: T.TZ,
        patient: { name: o.name, phone: o.phone, email: o.email || null },
        note: o.note || '',
        hold_expires_at: o.status === 'requested' ? iso(now() + 20 * 3600000) : null,
        payment: payment(o.method, o.pay || 'not_selected', s.price.amount),
        financial_closed_at: null,
        created_at: iso(now() - age * 3600000), updated_at: iso(now() - 3600000),
        actions: []
      };
      a.payment.id = 'pay_' + seq;
      if (o.pay === 'paid') {
        a.payment.verified_by = o.method === 'cash' ? 'cash_receipt' : 'whish';
        a.payment.receipt_reference = o.method === 'cash' ? 'CASH-' + seq : 'WH-88' + seq;
        a.payment.recorded_by = o.method === 'cash' ? { name: 'Dr. Rayan Halimeh' } : null;
        a.payment.transactions.push({ id: 'tx_' + seq, provider: o.method === 'cash' ? 'cash' : 'whish',
          status: 'verified', amount: a.payment.amount, currency: 'USD', reference: a.payment.receipt_reference,
          at: iso(now() - 2 * 3600000) });
      }
      if (o.attempt) {
        a.payment.last_attempt = { status: o.attempt, at: iso(now() - 1800000) };
        a.payment.transactions.push({ id: 'tx_' + seq + 'f', provider: 'whish', status: o.attempt,
          amount: a.payment.amount, currency: 'USD', reference: 'WH-77' + seq, at: iso(now() - 1800000) });
      }
      if (o.closed) a.financial_closed_at = iso(now() - 3600000);
      if (o.token) a.token = o.token;
      refreshActions(a);
      appts.push(a);
      log(a, 'requested', 'patient', 'Requested ' + a.service.name + ' for ' + T.dayLabel(date) + ' ' + time, age);
      if (['approved', 'confirmed', 'completed', 'no_show'].indexOf(o.status) >= 0) log(a, 'approved', 'staff', 'Approved', Math.max(age - 1, 0));
      if (o.method) log(a, 'payment_selected', 'patient', 'Chose ' + (o.method === 'cash' ? 'cash at the clinic' : 'Whish'), 1.5);
      if (o.attempt === 'failed') log(a, 'payment_failed', 'system', 'Whish reported the payment failed', 0.5);
      if (o.pay === 'paid') log(a, o.method === 'cash' ? 'cash_recorded' : 'payment_verified', o.method === 'cash' ? 'staff' : 'system',
        o.method === 'cash' ? 'Cash received, ' + money(a.payment.amount) : 'Verified with Whish, ' + money(a.payment.amount), 1);
      if (o.status === 'completed') log(a, 'completed', 'staff', 'Marked completed', 0.8);
      if (o.closed) log(a, 'financial_closed', 'system', 'Financial case closed', 0.7);
      if (o.status === 'declined') log(a, 'declined', 'staff', 'Declined: no suitable time this week', 1);
      if (o.status === 'cancelled') log(a, 'cancelled', 'patient', 'Cancelled by the patient', 1);
      if (o.status === 'no_show') log(a, 'no_show', 'staff', 'Marked no-show', 0.5);
      return a;
    }

    function money(minor) { return '$' + (minor / 100).toFixed(0); }

    function log(a, type, actor, summary, hoursAgo) {
      var who = actor === 'staff' ? { kind: 'staff', name: 'Dr. Rayan Halimeh' }
              : actor === 'patient' ? { kind: 'patient', name: a.patient.name }
              : { kind: 'system', name: 'System' };
      events.push({ id: 'ev_' + (eseq++), at: iso(now() - (hoursAgo || 0) * 3600000), type: type,
                    actor: who, appointment_id: a.id, reference: a.reference, summary: summary });
    }

    function refreshActions(a) {
      var by = {
        requested: ['approve', 'decline', 'reschedule'],
        approved: ['reschedule', 'cancel'],
        confirmed: ['reschedule', 'cancel', 'complete', 'no_show'],
        reschedule_requested: ['cancel']
      };
      a.actions = (by[a.status] || []).slice();
      var p = a.payment;
      p.actions = (p.method === 'cash' && p.status === 'awaiting_payment' &&
                   ['approved', 'confirmed', 'completed'].indexOf(a.status) >= 0) ? ['confirm_cash'] : [];
      a.updated_at = iso(now());
    }

    var d0 = openDay(today), d1 = openDay(T.addDays(today, 1)), d2 = openDay(T.addDays(d1, 1));
    var d3 = openDay(T.addDays(d2, 1)), past = lastOpen(T.addDays(today, -1)), past2 = lastOpen(T.addDays(today, -6));
    if (scenario() !== 'empty') {
      add({ status: 'requested', service: 'assessment', date: d2, time: '09:00', name: 'Maya Khoury', phone: '+96170000101', email: 'maya@example.com', note: 'Right thoracic curve, 24 degrees in June.', age: 26 });
      add({ status: 'requested', service: 'sports', date: d2, time: '15:45', name: 'Karim Saad', phone: '+96171000102', note: 'Hamstring strain from football two weeks ago. Can I still play the match next Saturday?', age: 5 });
      add({ status: 'requested', service: 'online', mode: 'online', date: d3, time: '10:20', name: 'Lina Haddad', phone: '+97150000103', email: 'lina@example.com', for_whom: 'child', note: 'My son is 11. The school nurse noticed one shoulder higher than the other; we have no X-ray yet.', age: 1 });
      add({ status: 'approved', service: 'pain', date: d1, time: '11:00', name: 'Omar Tannous', phone: '+96103000104', age: 30 });
      add({ status: 'confirmed', service: 'follow', date: d0, time: '09:00', method: 'whish', pay: 'paid', name: 'Nour Aoun', phone: '+96170000105', age: 50 });
      add({ status: 'confirmed', service: 'assessment', date: d0, time: '10:00', method: 'cash', pay: 'awaiting_payment', name: 'Jad Mansour', phone: '+96176000106', email: 'jad@example.com', age: 40, token: 'demo-cash' });
      add({ status: 'confirmed', service: 'pain-follow', date: d0, time: '15:00', method: 'whish', pay: 'awaiting_payment', attempt: 'failed', name: 'Rita Fares', phone: '+96170000107', age: 45, token: 'demo-failed' });
      add({ status: 'confirmed', service: 'sports', date: d1, time: '16:30', method: 'cash', pay: 'awaiting_payment', name: 'Sami Barakat', phone: '+96171000108', age: 20 });
      add({ status: 'completed', service: 'assessment', date: past, time: '09:00', method: 'cash', pay: 'paid', closed: true, name: 'Yara Daher', phone: '+96170000109', age: 80 });
      add({ status: 'completed', service: 'follow', date: past, time: '15:00', method: 'cash', pay: 'awaiting_payment', name: 'Hadi Nassar', phone: '+96170000110', age: 70 });
      add({ status: 'no_show', service: 'sports', date: past2, time: '11:15', name: 'Tala Rizk', phone: '+96170000111', age: 200 });
      add({ status: 'declined', service: 'pain', date: d3, time: '16:00', name: 'Ziad Eid', phone: '+96170000112', age: 30 });
      add({ status: 'cancelled', service: 'follow', date: d1, time: '09:45', method: 'cash', pay: 'awaiting_payment', name: 'Carla Hayek', phone: '+96170000113', age: 60 });
      exceptions.push({ id: 'ex_1', practitioner_id: 'pr-rayan', date: d1, start: '12:00', end: '13:00', reason: 'Lunch with the team' });
    }

    function byId(id) { return appts.filter(function (a) { return a.id === id; })[0]; }
    function byPay(id) { return appts.filter(function (a) { return a.payment.id === id; })[0]; }

    /* ---------- Slots ---------- */
    function slotsFor(serviceId, practitionerId, date, mode) {
      var s = svc(serviceId);
      if (!s || CLOSED_DOW.indexOf(T.dow(date)) >= 0) return [];
      if (scenario() === 'no_slots') return [];
      var out = [];
      (HOURS[T.dow(date)] || []).forEach(function (b) {
        var t = T.toMin(b[0]), end = T.toMin(b[1]);
        while (t + s.duration_min <= end) {
          var label = T.fromMin(t);
          var taken = hash(date + label + (practitionerId || '') + mode) % 4 === 0;
          appts.forEach(function (a) {
            if (a.local_date === date && a.local_time === label &&
                ['declined', 'cancelled', 'expired'].indexOf(a.status) < 0 &&
                (!practitionerId || a.practitioner.id === practitionerId)) taken = true;
          });
          exceptions.forEach(function (x) {
            if (x.date === date && (!practitionerId || x.practitioner_id === practitionerId) &&
                T.toMin(label) < T.toMin(x.end) && T.toMin(label) + s.duration_min > T.toMin(x.start)) taken = true;
          });
          out.push({ time: label, available: !taken });
          t += s.duration_min;
        }
      });
      return out;
    }

    /* ---------- Payment-link fixtures ---------- */
    var tokens = {};
    function tokenAppt(token) {
      if (tokens[token]) return tokens[token];
      var found = appts.filter(function (a) { return a.token === token; })[0];
      if (found) return (tokens[token] = found);
      var base = { name: 'Demo patient', phone: '+96170000199', service: 'assessment', date: d2, time: '10:00' };
      var map = {
        'demo-approved': { status: 'approved' },
        'demo-whishdown': { status: 'approved' },
        'demo-onlycash': { status: 'approved', only: ['cash'] },
        'demo-verifying': { status: 'confirmed', method: 'whish', pay: 'awaiting_payment', attempt: 'pending' },
        'demo-slowverify': { status: 'confirmed', method: 'whish', pay: 'awaiting_payment', attempt: 'pending', slow: true },
        'demo-paid': { status: 'confirmed', method: 'whish', pay: 'paid' },
        'demo-cash': { status: 'confirmed', method: 'cash', pay: 'awaiting_payment' },
        'demo-failed': { status: 'confirmed', method: 'whish', pay: 'awaiting_payment', attempt: 'failed' },
        'demo-declined': { status: 'declined' },
        'demo-cancelled': { status: 'cancelled' },
        'demo-newtime': { status: 'reschedule_requested' }
      };
      var m = map[token];
      if (!m) return null;
      var o = clone(base); Object.keys(m).forEach(function (k) { o[k] = m[k]; });
      var a = add(o);
      a.token = token; a.only = m.only || null; a.slow = !!m.slow; a.whishDown = token === 'demo-whishdown';
      a.polls = 0;
      return (tokens[token] = a);
    }

    function selectionView(a) {
      var p = a.payment;
      var live = ['approved', 'confirmed'].indexOf(a.status) >= 0;
      var finalized = p.status === 'paid' || p.status === 'refunded' || (a.only && p.method);
      return {
        appointment: {
          reference: a.reference, status: a.status,
          service: clone(a.service), practitioner: { name: a.practitioner.name },
          mode: a.mode, local_date: a.local_date, local_time: a.local_time, timezone: T.TZ,
          location: a.mode === 'online' ? 'Online, video call' : 'Rayhab Movement Clinic, Beirut'
        },
        payment: { method: p.method, status: p.status, amount: p.amount, currency: p.currency,
                   outstanding: p.outstanding, last_attempt: clone(p.last_attempt),
                   receipt_reference: p.status === 'paid' ? p.receipt_reference : null },
        allowed_methods: live && !finalized ? (a.only || ['whish', 'cash']) : [],
        can_change_method: live && !finalized && p.status === 'awaiting_payment' && !(a.only),
        can_retry: live && p.method === 'whish' && p.status === 'awaiting_payment' &&
                   !!p.last_attempt && p.last_attempt.status !== 'pending',
        policy: {
          cash: 'Pay at reception on the day, before your session. Cash in US dollars.',
          whish: 'You pay now through Whish. Your booking is secured once Whish confirms the payment.',
          deadline: iso(T.toUtc(T.addDays(a.local_date, -1), '21:00'))
        },
        clinic: { name: 'Rayhab Movement Clinic', phone: '+961 71 383 315' }
      };
    }

    /* ---------- Admin views ---------- */
    function sum(list, field) {
      var by = {};
      list.forEach(function (a) {
        var c = a.payment.currency;
        by[c] = (by[c] || 0) + (field === 'outstanding' ? a.payment.outstanding : a.payment.amount);
      });
      return Object.keys(by).map(function (c) { return { currency: c, amount: by[c] }; });
    }
    function active(a) { return ['declined', 'cancelled', 'expired', 'no_show'].indexOf(a.status) < 0; }

    function overview() {
      var todays = appts.filter(function (a) { return a.local_date === today && active(a); })
        .sort(function (x, y) { return x.start < y.start ? -1 : 1; });
      var requested = appts.filter(function (a) { return a.status === 'requested'; });
      var owing = appts.filter(function (a) { return active(a) && a.payment.status === 'awaiting_payment'; });
      var weekAgo = now() - 7 * 86400000;
      var received = appts.filter(function (a) {
        return a.payment.status === 'paid' && a.payment.transactions.some(function (t) { return t.status === 'verified' && Date.parse(t.at) >= weekAgo; });
      });
      var alerts = [];
      requested.forEach(function (a) {
        if (now() - Date.parse(a.created_at) > 24 * 3600000) {
          alerts.push({ level: 'warn', text: a.reference + ' (' + a.patient.name + ') has waited more than a day for a reply.', appointment_id: a.id });
        }
      });
      appts.forEach(function (a) {
        if (a.payment.last_attempt && a.payment.last_attempt.status === 'failed' && active(a)) {
          alerts.push({ level: 'info', text: a.reference + ': a Whish payment failed. The patient can retry from their link.', appointment_id: a.id });
        }
      });
      return {
        date: today, timezone: T.TZ,
        counts: { today: todays.length, requested: requested.length, awaiting_payment: owing.length,
                  enquiries: enquiries.filter(function (e) { return e.status === 'open'; }).length },
        outstanding: sum(owing, 'outstanding'), received_7d: sum(received, 'amount'),
        today: clone(todays), alerts: alerts
      };
    }

    function listAppointments(q) {
      var items = appts.slice();
      if (q.status) items = items.filter(function (a) { return q.status.split(',').indexOf(a.status) >= 0; });
      if (q.practitioner_id) items = items.filter(function (a) { return a.practitioner.id === q.practitioner_id; });
      if (q.payment_method) items = items.filter(function (a) { return (a.payment.method || 'none') === q.payment_method; });
      if (q.date_from) items = items.filter(function (a) { return a.local_date >= q.date_from; });
      if (q.date_to) items = items.filter(function (a) { return a.local_date <= q.date_to; });
      if (q.has_note) items = items.filter(function (a) { return !!a.note; });
      if (q.q) {
        var needle = q.q.toLowerCase();
        items = items.filter(function (a) {
          return (a.patient.name + ' ' + a.reference + ' ' + a.patient.phone + ' ' + (a.patient.email || '')).toLowerCase().indexOf(needle) >= 0;
        });
      }
      items.sort(function (x, y) {
        if (q.sort === 'created') return x.created_at < y.created_at ? -1 : 1;
        if (q.sort === 'created_desc') return x.created_at < y.created_at ? 1 : -1;
        return x.start < y.start ? -1 : 1;
      });
      return page(items, q);
    }

    function page(items, q) {
      var size = Math.min(+q.page_size || 20, 100), n = Math.max(+q.page || 1, 1);
      return { items: clone(items.slice((n - 1) * size, n * size)), page: n, page_size: size, total: items.length };
    }

    function paymentRow(a) {
      var p = clone(a.payment);
      p.appointment = { id: a.id, reference: a.reference, status: a.status, service_name: a.service.name,
                        local_date: a.local_date, local_time: a.local_time, patient_name: a.patient.name };
      p.financial_closed_at = a.financial_closed_at;
      return p;
    }

    function maybeClose(a) {
      if (a.payment.status === 'paid' && !a.financial_closed_at) {
        a.financial_closed_at = iso(now());
        log(a, 'financial_closed', 'system', 'Financial case closed', 0);
      }
    }

    function transition(a, action, body, sc) {
      if (sc === 'session_expired') return err(401, 'session_expired', 'Your session has expired.', { login_url: 'login.html?demo=1' });
      if (sc === 'server_error') return err(500, 'internal', 'Something went wrong.');
      if (a.actions.indexOf(action) < 0) {
        return err(409, 'invalid_transition', 'This appointment can no longer be ' + action.replace('_', ' ') + 'd. It is now ' + a.status + '.');
      }
      if (action === 'approve') {
        if (sc === 'conflict') return err(409, 'slot_taken', 'That time is no longer free. Propose another time instead.');
        a.status = 'approved'; a.hold_expires_at = null;
        log(a, 'approved', 'staff', 'Approved. WhatsApp sent with the payment link', 0);
      } else if (action === 'decline') {
        if (!body.reason) return err(422, 'validation', 'Choose a reason.', { errors: { reason: 'Choose a reason.' } });
        a.status = 'declined'; a.hold_expires_at = null;
        log(a, 'declined', 'staff', 'Declined: ' + body.reason, 0);
      } else if (action === 'reschedule') {
        if (!body.date || !body.time) return err(422, 'validation', 'Choose a date and time.', { errors: { date: 'Choose a date and time.' } });
        var free = slotsFor(a.service.id, a.practitioner.id, body.date, a.mode).some(function (s) { return s.time === body.time && s.available; });
        if (!free) return err(409, 'slot_taken', 'That time is not free.');
        var start = T.toUtc(body.date, body.time);
        a.local_date = body.date; a.local_time = body.time;
        a.start = iso(start); a.end = iso(start + a.service.duration_min * 60000);
        if (a.status === 'requested') a.status = 'reschedule_requested';
        log(a, 'reschedule_proposed', 'staff', 'New time proposed: ' + T.dayLabel(body.date) + ' ' + body.time, 0);
      } else if (action === 'cancel') {
        a.status = 'cancelled';
        log(a, 'cancelled', 'staff', 'Cancelled' + (body.reason ? ': ' + body.reason : ''), 0);
      } else if (action === 'complete') {
        a.status = 'completed';
        log(a, 'completed', 'staff', 'Marked completed', 0);
      } else if (action === 'no_show') {
        a.status = 'no_show';
        log(a, 'no_show', 'staff', 'Marked no-show', 0);
      }
      refreshActions(a);
      return ok({ appointment: clone(a) });
    }

    var cashKeys = {};

    /* ---------- Router ---------- */
    function route(method, path, body, headers) {
      var sc = scenario();
      var url = path.split('?'), p = url[0], q = {};
      (url[1] || '').split('&').forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('=');
        q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
      });
      var m;

      if (method === 'GET' && p === '/services') {
        return ok({ services: clone(SERVICES), practitioners: clone(PRACTITIONERS), timezone: T.TZ });
      }
      if (method === 'GET' && p === '/availability') {
        if (sc === 'availability_down') return err(503, 'unavailable', 'Availability is unavailable.');
        if (!svc(q.service_id)) return err(422, 'validation', 'Unknown service.');
        return ok({ date: q.date, service_id: q.service_id, practitioner_id: q.practitioner_id || null,
                    mode: q.mode || 'clinic', timezone: T.TZ,
                    slots: slotsFor(q.service_id, q.practitioner_id, q.date, q.mode || 'clinic') });
      }
      if (method === 'POST' && p === '/appointments') {
        if (sc === 'slot_taken') return err(409, 'slot_taken', 'That time is no longer available.');
        if (sc === 'validation') return err(422, 'validation', 'Some details need fixing.',
          { errors: { email: 'This email address cannot receive mail.', phone: 'This number cannot receive WhatsApp messages.' } });
        if (sc === 'expired') return err(410, 'session_expired', 'This booking session has expired.');
        if (sc === 'rate_limited') return err(429, 'rate_limited', 'Too many requests.');
        if (sc === 'server_error') return err(500, 'internal', 'Something went wrong.');
        if (body.website) return err(400, 'rejected', 'Request rejected.');
        if (!body.consents || !body.consents.storage || !body.consents.whatsapp) {
          return err(422, 'validation', 'Consent is required.', { errors: { consents: 'Consent is required.' } });
        }
        var free = slotsFor(body.service_id, body.practitioner_id, body.date, body.mode)
          .some(function (s) { return s.time === body.time && s.available; });
        if (!free) return err(409, 'slot_taken', 'That time is no longer available.');
        var a = add({ status: 'requested', service: body.service_id, practitioner: body.practitioner_id || 'pr-rayan',
                      mode: body.mode, for_whom: body.for_whom, date: body.date, time: body.time,
                      name: body.first_name + ' ' + body.last_name, phone: body.phone, email: body.email, note: body.note, age: 0 });
        return ok({ status: 'requested', id: a.id, reference: a.reference, hold_expires_at: a.hold_expires_at }, 201);
      }

      if ((m = /^\/payment-selection\/([^/]+)\/reschedule$/.exec(p)) && method === 'POST') {
        var rt = tokenAppt(decodeURIComponent(m[1]));
        if (!rt) return err(404, 'link_invalid', 'This link is not recognized.');
        if (rt.status !== 'reschedule_requested') return err(409, 'appointment_closed', 'There is no new time waiting for an answer.');
        rt.status = body.accept ? (rt.payment.method ? 'confirmed' : 'approved') : 'requested';
        log(rt, body.accept ? 'reschedule_accepted' : 'reschedule_rejected', 'patient', body.accept ? 'Accepted the new time' : 'Asked for another time', 0);
        refreshActions(rt);
        return ok(selectionView(rt));
      }
      if ((m = /^\/payment-selection\/([^/]+)$/.exec(p))) {
        var token = decodeURIComponent(m[1]);
        if (token === 'demo-expired') return err(410, 'link_expired', 'This link has expired.');
        var ta = tokenAppt(token);
        if (!ta) return err(404, 'link_invalid', 'This link is not recognized.');
        if (method === 'GET') {
          if (ta.payment.last_attempt && ta.payment.last_attempt.status === 'pending' && !ta.slow) {
            ta.polls = (ta.polls || 0) + 1;
            if (ta.polls >= 3) settleWhish(ta, 'verified');
          }
          return ok(selectionView(ta));
        }
        if (method === 'POST') {
          var view = selectionView(ta);
          if (['declined', 'cancelled', 'expired'].indexOf(ta.status) >= 0) return err(409, 'appointment_closed', 'This appointment is no longer active.');
          if (ta.payment.status === 'paid') return err(409, 'method_finalized', 'This appointment is already paid.');
          if (view.allowed_methods.indexOf(body.method) < 0 ||
              (ta.payment.method && ta.payment.method !== body.method && !view.can_change_method)) {
            return err(409, 'method_finalized', 'The payment method can no longer be changed.');
          }
          if (ta.payment.method !== body.method) {
            ta.payment.method = body.method;
            ta.payment.status = 'awaiting_payment';
            ta.payment.last_attempt = null;
            if (ta.status === 'approved') ta.status = 'confirmed';
            log(ta, 'payment_selected', 'patient', 'Chose ' + (body.method === 'cash' ? 'cash at the clinic' : 'Whish'), 0);
            refreshActions(ta);
          }
          return ok(selectionView(ta));
        }
      }
      if (method === 'POST' && p === '/payments/whish/create') {
        var wa = tokenAppt(body.token);
        if (!wa) return err(404, 'link_invalid', 'This link is not recognized.');
        if (wa.whishDown) return err(503, 'whish_unavailable', 'Whish is not available right now.');
        if (wa.payment.status === 'paid') return err(409, 'already_paid', 'This appointment is already paid.');
        if (wa.payment.method !== 'whish') return err(409, 'method_mismatch', 'Choose Whish first.');
        log(wa, 'checkout_started', 'patient', 'Whish checkout started', 0);
        return ok({ checkout_url: 'mock-checkout:' + body.token, expires_at: iso(now() + 15 * 60000) });
      }

      /* ---- Staff sign-in (any password; any 6-digit code) ---- */
      if (method === 'POST' && p === '/admin/login') {
        if (!body.email || !body.password) return err(422, 'validation', 'Enter your email and password.', { errors: { email: body.email ? undefined : 'Enter your email.' } });
        return ok({ mfa: 'verify' });
      }
      if (method === 'POST' && p === '/admin/mfa/enroll') return ok({ qr_code: '', secret: 'DEMO-KEY' });
      if (method === 'POST' && p === '/admin/mfa/verify') {
        if (!/^\d{6}$/.test(body.code || '')) return err(422, 'invalid_code', 'That code did not work.', { errors: { code: 'Enter the 6-digit code.' } });
        setScenario('success');
        return ok({ ok: true });
      }
      if (method === 'POST' && p === '/admin/logout') { setScenario('signed_out'); return ok({ ok: true }); }

      /* ---- Admin ---- */
      if (p.indexOf('/admin/') === 0) {
        if (sc === 'signed_out') return err(401, 'unauthenticated', 'Sign in to continue.', { login_url: 'login.html?demo=1' });
        var mutating = method !== 'GET';
        if (mutating && headers && !headers['X-CSRF-Token']) return err(403, 'csrf', 'Missing CSRF token.');
      }
      if (method === 'GET' && p === '/admin/session') {
        return ok({ user: { id: 'st_1', name: 'Dr. Rayan Halimeh', role: 'practitioner' },
                    practitioners: clone(PRACTITIONERS), services: SERVICES.map(function (s) { return { id: s.id, name: s.name }; }),
                    permissions: { confirm_cash: true, manage_schedule: true, read_notes: true }, csrf_token: 'demo-csrf', timezone: T.TZ,
                    logout_url: 'login.html?demo=1&signout=1', login_url: 'login.html?demo=1' });
      }
      if (method === 'GET' && p === '/admin/overview') return ok(overview());
      if (method === 'GET' && p === '/admin/enquiries') {
        var st = q.status || 'open';
        var eqs = enquiries.filter(function (e) { return st === 'all' || e.status === st; });
        if (q.q) {
          var needle = q.q.toLowerCase();
          eqs = eqs.filter(function (e) { return (e.name + ' ' + e.email + ' ' + (e.phone || '') + ' ' + e.message).toLowerCase().indexOf(needle) >= 0; });
        }
        eqs.sort(function (x, y) { return (x.created_at < y.created_at ? -1 : 1) * (st === 'open' ? 1 : -1); });
        return ok(page(eqs, q));
      }
      if ((m = /^\/admin\/enquiries\/([^/]+)\/answered$/.exec(p)) && method === 'POST') {
        if (sc === 'session_expired') return err(401, 'session_expired', 'Your session has expired.', { login_url: 'login.html?demo=1' });
        if (sc === 'server_error') return err(500, 'internal', 'Something went wrong.');
        var en = enquiries.filter(function (e) { return e.id === m[1]; })[0];
        if (!en) return err(404, 'not_found', 'No such question.');
        en.status = body.answered ? 'answered' : 'open';
        en.answered_at = body.answered ? (en.answered_at || iso(now())) : null;
        en.answered_by = body.answered ? (en.answered_by || { name: 'Dr. Rayan Halimeh' }) : null;
        events.push({ id: 'ev_' + (eseq++), at: iso(now()), type: body.answered ? 'enquiry_answered' : 'enquiry_reopened',
                      actor: { kind: 'staff', name: 'Dr. Rayan Halimeh' }, appointment_id: null, reference: null,
                      summary: body.answered ? 'Marked a website question answered' : 'Reopened a website question' });
        return ok({ enquiry: clone(en) });
      }
      if (method === 'GET' && p === '/admin/appointments') return ok(listAppointments(q));
      if ((m = /^\/admin\/appointments\/([^/]+)$/.exec(p)) && method === 'GET') {
        var one = byId(m[1]);
        if (!one) return err(404, 'not_found', 'No such appointment.');
        return ok({ appointment: clone(one), events: clone(events.filter(function (e) { return e.appointment_id === one.id; }).reverse()) });
      }
      if ((m = /^\/admin\/appointments\/([^/]+)\/(approve|decline|reschedule|cancel|complete|no-show)$/.exec(p)) && method === 'POST') {
        var target = byId(m[1]);
        if (!target) return err(404, 'not_found', 'No such appointment.');
        return transition(target, m[2].replace('-', '_'), body || {}, sc);
      }
      if (method === 'GET' && p === '/admin/availability') {
        return ok({
          timezone: T.TZ,
          working_hours: Object.keys(HOURS).map(function (d) {
            return { weekday: +d, blocks: HOURS[d].map(function (b) { return { start: b[0], end: b[1] }; }) };
          }),
          exceptions: clone(exceptions.filter(function (x) {
            return (!q.from || x.date >= q.from) && (!q.to || x.date <= q.to) &&
                   (!q.practitioner_id || x.practitioner_id === q.practitioner_id);
          }))
        });
      }
      if (method === 'PATCH' && p === '/admin/availability') {
        if (sc === 'session_expired') return err(401, 'session_expired', 'Your session has expired.', { login_url: 'login.html?demo=1' });
        if (sc === 'server_error') return err(500, 'internal', 'Something went wrong.');
        (body.add || []).forEach(function (x) {
          if (!x.date || !x.start || !x.end || T.toMin(x.end) <= T.toMin(x.start)) return;
          exceptions.push({ id: 'ex_' + (++eseq), practitioner_id: x.practitioner_id || 'pr-rayan', date: x.date,
                            start: x.start, end: x.end, reason: x.reason || '' });
          events.push({ id: 'ev_' + (eseq++), at: iso(now()), type: 'time_blocked', actor: { kind: 'staff', name: 'Dr. Rayan Halimeh' },
                        appointment_id: null, reference: null, summary: 'Blocked ' + T.dayLabel(x.date) + ' ' + x.start + '–' + x.end });
        });
        (body.remove || []).forEach(function (id) {
          exceptions = exceptions.filter(function (x) { return x.id !== id; });
          events.push({ id: 'ev_' + (eseq++), at: iso(now()), type: 'block_removed', actor: { kind: 'staff', name: 'Dr. Rayan Halimeh' },
                        appointment_id: null, reference: null, summary: 'Removed a blocked time' });
        });
        return ok({ exceptions: clone(exceptions) });
      }
      if (method === 'GET' && p === '/admin/payments') {
        var rows = appts.filter(function (a) { return a.payment.method || a.status === 'approved'; });
        if (q.status) rows = rows.filter(function (a) { return a.payment.status === q.status; });
        if (q.payment_method) rows = rows.filter(function (a) { return (a.payment.method || 'none') === q.payment_method; });
        rows.sort(function (x, y) { return x.payment.updated_at < y.payment.updated_at ? 1 : -1; });
        var pg = page(rows, q);
        pg.items = rows.slice((pg.page - 1) * pg.page_size, pg.page * pg.page_size).map(paymentRow);
        return ok(pg);
      }
      if ((m = /^\/admin\/payments\/([^/]+)\/confirm-cash$/.exec(p)) && method === 'POST') {
        if (sc === 'session_expired') return err(401, 'session_expired', 'Your session has expired.', { login_url: 'login.html?demo=1' });
        if (sc === 'server_error') return err(500, 'internal', 'Something went wrong.');
        var key = headers && headers['Idempotency-Key'];
        if (key && cashKeys[key]) return ok({ payment: paymentRow(byPay(cashKeys[key])) });
        var ca = byPay(m[1]);
        if (!ca) return err(404, 'not_found', 'No such payment.');
        if (ca.payment.actions.indexOf('confirm_cash') < 0) {
          return err(409, 'already_recorded', ca.payment.status === 'paid' ? 'This cash payment is already recorded.' : 'Cash cannot be recorded for this payment.');
        }
        if (!body.amount || body.currency !== ca.payment.currency) {
          return err(422, 'validation', 'Check the amount.', { errors: { amount: 'Enter the amount received in ' + ca.payment.currency + '.' } });
        }
        if (body.amount > ca.payment.outstanding) {
          return err(422, 'validation', 'More than is owed.', { errors: { amount: 'That is more than the ' + money(ca.payment.outstanding) + ' owed.' } });
        }
        ca.payment.outstanding -= body.amount;
        var ref = body.reference || 'CASH-' + ca.reference.slice(3);
        ca.payment.transactions.push({ id: 'tx_' + (++eseq), provider: 'cash', status: 'verified', amount: body.amount,
                                       currency: body.currency, reference: ref, at: iso(now()) });
        ca.payment.receipt_reference = ref;
        ca.payment.recorded_by = { name: 'Dr. Rayan Halimeh' };
        if (ca.payment.outstanding <= 0) { ca.payment.status = 'paid'; ca.payment.verified_by = 'cash_receipt'; }
        ca.payment.updated_at = iso(now());
        log(ca, 'cash_recorded', 'staff', 'Cash received, ' + money(body.amount) + (ca.payment.outstanding > 0 ? ', ' + money(ca.payment.outstanding) + ' still owed' : ''), 0);
        maybeClose(ca);
        refreshActions(ca);
        if (key) cashKeys[key] = ca.payment.id;
        return ok({ payment: paymentRow(ca) });
      }
      if (method === 'GET' && p === '/admin/audit') {
        var evs = events.slice().sort(function (x, y) { return x.at < y.at ? 1 : -1; });
        if (q.type) evs = evs.filter(function (e) { return e.type === q.type; });
        if (q.appointment_id) evs = evs.filter(function (e) { return e.appointment_id === q.appointment_id; });
        return ok(page(evs, q));
      }
      return err(404, 'not_found', 'No such endpoint in the demo.');
    }

    // The patient comes back from the mock checkout: record what Whish
    // would later tell the server. Paid only after the verifying polls.
    function settleWhish(a, outcome) {
      var p = a.payment;
      if (outcome === 'verified') {
        p.status = 'paid'; p.outstanding = 0; p.verified_by = 'whish';
        p.receipt_reference = 'WH-' + (900000 + (hash(a.id) % 99999));
        p.last_attempt = { status: 'succeeded', at: iso(now()) };
        p.transactions.push({ id: 'tx_' + (++eseq), provider: 'whish', status: 'verified', amount: p.amount,
                              currency: p.currency, reference: p.receipt_reference, at: iso(now()) });
        log(a, 'payment_verified', 'system', 'Verified with Whish, ' + money(p.amount), 0);
        maybeClose(a);
      } else {
        p.last_attempt = { status: outcome, at: iso(now()) };
        p.transactions.push({ id: 'tx_' + (++eseq), provider: 'whish', status: outcome, amount: p.amount,
                              currency: p.currency, reference: null, at: iso(now()) });
        if (outcome === 'failed') log(a, 'payment_failed', 'system', 'Whish reported the payment failed', 0);
      }
      p.updated_at = iso(now());
      refreshActions(a);
    }

    function handle(method, path, body, headers) {
      var res = route(method, path, body, headers || {});
      var sc = scenario();
      var wait = sc === 'slow' && method === 'POST' && path === '/appointments' ? 25000
               : 280 + (hash(path + now()) % 520);
      return new Promise(function (resolve) { setTimeout(function () { resolve(clone(res)); }, opts.instant ? 0 : wait); });
    }

    /* ---------- The checkout stand-in ----------
       What Whish's hosted page would do, reduced to three outcomes. Only
       the server-side record changes; the page then comes back to the
       return URL and has to ask the API, like it would after real Whish. */
    function checkout(token, done) {
      var a = tokenAppt(token);
      if (typeof document === 'undefined' || !a) return;
      var d = document.createElement('dialog');
      d.className = 'demo-checkout';
      d.innerHTML =
        '<p class="demo-checkout-k">Whish checkout · demo stand-in</p>' +
        '<p class="demo-checkout-amt">' + money(a.payment.amount) + '</p>' +
        '<p class="demo-checkout-d">' + a.service.name + ', ' + a.reference + '. Choose what Whish does:</p>' +
        '<div class="demo-checkout-acts">' +
        '<button class="btn btn-spring btn-sm" data-o="pending">Pay (verified a moment later)</button>' +
        '<button class="btn btn-ghost-light btn-sm" data-o="failed">Payment fails</button>' +
        '<button class="btn btn-ghost-light btn-sm" data-o="abandoned">Close without paying</button></div>';
      document.body.appendChild(d);
      d.addEventListener('click', function (e) {
        var o = e.target.getAttribute && e.target.getAttribute('data-o');
        if (!o) return;
        if (o === 'pending') { a.payment.last_attempt = { status: 'pending', at: iso(now()) }; a.polls = 0; }
        else settleWhish(a, o);
        d.close(); d.remove();
        done();
      });
      d.addEventListener('cancel', function (e) { e.preventDefault(); });
      d.showModal();
    }

    /* ---------- Banner ---------- */
    function mountBanner() {
      if (typeof document === 'undefined') return;
      var app = document.body.getAttribute('data-app') || 'booking';
      var list = SCENARIOS[app] || SCENARIOS.booking;
      var bar = document.createElement('div');
      bar.className = 'demo-bar';
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'Demo mode');
      var options = list.map(function (s) {
        var sel = app === 'payment' ? (location.hash.indexOf('t=' + s[0]) >= 0) : scenario() === s[0];
        return '<option value="' + s[0] + '"' + (sel ? ' selected' : '') + '>' + s[1] + '</option>';
      }).join('');
      var exit = location.pathname + location.search.replace(/([?&])demo=1(&|$)/, '$1').replace(/[?&]$/, '');
      bar.innerHTML = '<span class="demo-bar-t"><strong>Demo mode.</strong> Mock data; nothing is sent or stored.</span>' +
        '<label class="demo-bar-s"><span>Scenario</span><select id="demo-scenario">' +
        (app === 'payment' ? '<option value="">Pick a payment link…</option>' : '') + options + '</select></label>' +
        '<a class="demo-bar-x" href="' + exit + '">Exit demo</a>';
      document.body.insertBefore(bar, document.body.firstChild);
      bar.querySelector('select').addEventListener('change', function (e) {
        var v = e.target.value;
        if (!v) return;
        // The verifying scenarios arrive as a return from Whish would: with &r=1.
        if (app === 'payment') { location.hash = 't=' + v + (/verify/.test(v) ? '&r=1' : ''); location.reload(); return; }
        try { store.setItem('rayhab-demo-scenario', v); } catch (x) { /* private mode */ }
        location.href = location.pathname + location.search.replace(/[?&]scenario=[\w-]+/, '') + location.hash;
      });
    }

    return { handle: handle, route: route, checkout: checkout, settleWhish: settleWhish,
             tokenAppt: tokenAppt, mountBanner: mountBanner, SCENARIOS: SCENARIOS,
             _appts: appts, _events: events };
  }

  return { create: create };
});
