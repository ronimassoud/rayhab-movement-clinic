/* Rayhab, clinic admin (admin/index.html).

   The physiotherapist's working view: requests to answer, the schedule,
   payments, and what happened when. Built on the site's own parts (tokens,
   buttons, notices, inputs, segment, skeletons) and the API client.

   Rules it keeps:
   - The server is the authority. Every change is sent, and the page then
     shows the record the server returns, never its own guess. Nothing is
     optimistic.
   - What can be done to a record is what the server lists in its
     `actions`. A button for anything else is never drawn.
   - Every change is confirmed first, sent once (the button is disabled
     while it is in flight), and carries an Idempotency-Key that is kept
     for retries of that same change.
   - Patient details live only in this page's memory. Nothing goes to
     localStorage, sessionStorage, IndexedDB or the URL.
   - Signing in and out belong to the backend: a 401 shows the sign-in
     link the server returns.

   Views are #/overview, #/requests, #/appointments, #/calendar,
   #/payments and #/activity. */
(function () {
  'use strict';

  var API = window.RayhabAPI, L = window.RayhabLabels, T = window.RayhabTime;
  if (!API || !API.appointments || !API.payments || !L || !T) return;
  var A = API.appointments, P = API.payments;

  var $ = function (id) { return document.getElementById(id); };
  var session = null;
  var view = '';
  var loadedAt = 0;
  var REFRESH_MS = 60000;

  /* ---------- Small helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function badge(info, extra) {
    return '<span class="badge tone-' + esc(info.tone) + (extra ? ' ' + extra : '') + '">' + esc(info.label) + '</span>';
  }
  function apptBadge(s) { return badge(L.appointment(s)); }
  function payBadge(p) {
    var tone = p.status === 'paid' ? 'success' : p.status === 'awaiting_payment' ? 'pending' : 'neutral';
    var out = badge({ label: L.paymentSummary(p.method, p.status), tone: tone });
    var flag = L.attemptFlag(p.last_attempt);
    if (flag && p.status !== 'paid') out += ' ' + badge(flag);
    return out;
  }
  function when(a) {
    return T.dayLabel(a.local_date) + ' · ' + a.local_time;
  }
  function at(isoUtc) {
    if (!isoUtc) return '';
    var b = T.fromInstant(isoUtc);
    return T.dayLabel(b.date) + ', ' + b.time;
  }
  function ago(isoUtc) {
    var m = Math.round((Date.now() - Date.parse(isoUtc)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 36) return h + ' h ago';
    return Math.round(h / 24) + ' days ago';
  }
  function inHours(isoUtc) {
    var h = Math.round((Date.parse(isoUtc) - Date.now()) / 3600000);
    return h <= 0 ? 'now' : h < 36 ? 'in ' + h + ' h' : 'in ' + Math.round(h / 24) + ' days';
  }
  function money(amount, currency) { return L.money(amount, currency); }
  function moneyList(list) {
    if (!list || !list.length) return money(0, 'USD');
    return list.map(function (x) { return money(x.amount, x.currency); }).join(' + ');
  }
  function waLink(phone) { return 'https://wa.me/' + String(phone || '').replace(/\D/g, ''); }
  function skeleton(rows) {
    var s = '<div class="adm-skel" aria-hidden="true">';
    for (var i = 0; i < (rows || 3); i++) s += '<span class="bk-skel"></span>';
    return s + '</div><span class="vh">Loading</span>';
  }
  function empty(title, text) {
    return '<div class="adm-empty"><p class="adm-empty-t">' + esc(title) + '</p>' + (text ? '<p class="adm-empty-d">' + esc(text) + '</p>' : '') + '</div>';
  }
  function failed(where, retry) {
    return '<div class="notice notice-error adm-fail" role="alert"><p class="m-0"><strong>' + esc(where) + ' could not be loaded.</strong> ' +
      'Check the connection and try again.</p><button class="btn btn-brand btn-sm mt-3" type="button" data-retry="' + retry + '">Try again</button></div>';
  }

  var toastTimer = 0;
  function toast(text) {
    var el = $('adm-toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 4200);
  }

  /* A 401 at any point: the session is over. Say so and offer the
     backend's sign-in, without pretending the change went through. */
  function sessionEnded(res) {
    closeDialog(); closeDrawer();
    var url = (res && res.body && res.body.login_url) || (session && session.login_url) || '';
    gate('Your session has ended', 'Sign in again to continue. Nothing was changed by the last action.',
         url ? [{ label: 'Sign in', href: url }] : []);
  }

  /* ---------- Session ---------- */
  function gate(title, text, actions) {
    session = null;
    clearData();
    $('adm').hidden = true;
    $('adm-gate').hidden = false;
    $('adm-gate-h').textContent = title;
    $('adm-gate-p').textContent = text;
    var acts = $('adm-gate-acts');
    acts.innerHTML = '';
    (actions || []).forEach(function (a, i) {
      var el = document.createElement('a');
      el.className = 'btn ' + (i ? 'btn-ghost-light' : 'btn-brand') + ' btn-md';
      el.href = a.href;
      el.textContent = a.label;
      acts.appendChild(el);
    });
    $('adm-gate-h').focus();
  }

  function start() {
    if (!API.available()) {
      return gate('The admin is not connected yet',
        'It needs the clinic’s booking backend, which is not running here.' +
        (API.demoAllowed ? ' You can preview it with demo data.' : ''),
        API.demoAllowed ? [{ label: 'Preview with demo data', href: '?demo=1' }] : []);
    }
    A.session().then(function (res) {
      if (res.ok && res.body && res.body.user) {
        session = res.body;
        API.setCsrf(session.csrf_token);
        enter();
        return;
      }
      if (res.status === 401 || res.status === 403) {
        var url = res.body && res.body.login_url;
        return gate('Sign in to the clinic admin', 'Appointments, payments and patient contact details are visible only to signed-in staff.',
                    url ? [{ label: 'Sign in', href: url }] : []);
      }
      if (res.status === 0 || res.status === 404 || res.status === 405 || res.status === 501) {
        return gate('The admin is not connected yet', 'The booking backend is not answering at /api. Nothing here can be shown until it is.',
          API.demoAllowed ? [{ label: 'Preview with demo data', href: '?demo=1' }] : []);
      }
      gate('The admin could not start', 'The server answered with an error. Try again in a moment.', [{ label: 'Try again', href: location.href }]);
    }, function () {
      gate('The admin could not reach the server', 'Check the connection and try again.', [{ label: 'Try again', href: location.href }]);
    });
  }

  function enter() {
    $('adm-gate').hidden = true;
    $('adm').hidden = false;
    var role = String(session.user.role || '').replace(/_/g, ' ');
    $('adm-user').textContent = session.user.name + (role ? ' · ' + role.charAt(0).toUpperCase() + role.slice(1) : '');
    var so = $('adm-signout');
    if (session.logout_url) so.href = session.logout_url;
    else so.hidden = true;
    $('adm-today').textContent = T.dayLabelYear(T.today()) + ' · Beirut time';
    var many = (session.practitioners || []).length > 1;
    $('ap-prac-wrap').hidden = !many;
    if (many) {
      $('ap-prac').innerHTML = '<option value="">Any</option>' + session.practitioners.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
      }).join('');
    }
    $('ap-status').innerHTML = '<option value="">Any</option>' + Object.keys(L.APPOINTMENT).map(function (k) {
      return '<option value="' + k + '">' + esc(L.APPOINTMENT[k].label) + '</option>';
    }).join('');
    $('ac-type').innerHTML = '<option value="">All activity</option>' + Object.keys(L.EVENT).map(function (k) {
      return '<option value="' + k + '">' + esc(L.EVENT[k]) + '</option>';
    }).join('');
    $('cal-block').hidden = !(session.permissions && session.permissions.manage_schedule);
    route();
  }

  function clearData() {
    ['ov-stats', 'ov-today', 'ov-alerts', 'rq-list', 'eq-list', 'eq-pager', 'ap-list', 'ap-pager', 'cal-grid', 'py-list', 'py-pager', 'ac-list', 'ac-pager', 'dr-body']
      .forEach(function (id) { var el = $(id); if (el) el.innerHTML = ''; });
  }

  /* ---------- Routing ---------- */
  var VIEWS = {
    overview: ['Overview', loadOverview],
    requests: ['Requests', loadRequests],
    enquiries: ['Enquiries', loadEnquiries],
    appointments: ['Appointments', loadAppointments],
    calendar: ['Calendar', loadCalendar],
    payments: ['Payments', loadPayments],
    activity: ['Activity', loadActivity]
  };
  function route() {
    if (!session) return;
    var name = (location.hash.match(/^#\/(\w+)/) || [])[1];
    if (!VIEWS[name]) name = 'overview';
    var changed = name !== view;
    view = name;
    Object.keys(VIEWS).forEach(function (k) { $('v-' + k).hidden = k !== name; });
    Array.prototype.forEach.call(document.querySelectorAll('.adm-nav a'), function (a) {
      if (a.dataset.view === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('adm-title').textContent = VIEWS[name][0];
    document.title = VIEWS[name][0] + ', clinic admin, Rayhab';
    refresh();
    if (changed) $('adm-main').focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', route);

  function refresh() {
    if (!session) return;
    loadCounts();
    VIEWS[view][1]();
    loadedAt = Date.now();
    $('adm-updated').textContent = 'Updated ' + T.fromInstant(new Date().toISOString()).time;
  }
  $('adm-refresh').addEventListener('click', refresh);

  // Quietly refresh the open view every minute while the tab is in front
  // and nobody is in the middle of a dialog.
  setInterval(function () {
    if (!session || document.hidden || $('adm-dialog').open || $('adm-drawer').open) return;
    if (Date.now() - loadedAt >= REFRESH_MS) refresh();
  }, 5000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && session && Date.now() - loadedAt >= REFRESH_MS && !$('adm-dialog').open) refresh();
  });

  // Every "Try again" in a failed panel reloads its view.
  document.addEventListener('click', function (e) {
    var r = e.target.closest && e.target.closest('[data-retry]');
    if (r) refresh();
    var o = e.target.closest && e.target.closest('[data-open]');
    if (o) { e.preventDefault(); openDrawer(o.getAttribute('data-open')); }
  });

  /* Only the newest answer for a view is painted: a slow reply to an
     earlier filter must not overwrite the reply to the current one. */
  var seqs = {};
  function latest(name) {
    var n = (seqs[name] || 0) + 1;
    seqs[name] = n;
    return function () { return seqs[name] === n; };
  }

  /* A response that ends the session ends it everywhere; anything else is
     the caller's to show. */
  function guard(res) {
    if (res.status === 401) { sessionEnded(res); return false; }
    return true;
  }

  /* ---------- Overview ---------- */
  function loadCounts() {
    A.overview().then(function (res) {
      if (!guard(res) || !res.ok) return;
      var c = res.body.counts || {};
      setCount('cnt-requests', c.requested);
      setCount('cnt-payments', c.awaiting_payment);
      setCount('cnt-enquiries', c.enquiries);
      if (view === 'overview') paintOverview(res.body);
    }, function () {});
  }
  function setCount(id, n) {
    var el = $(id);
    el.hidden = !n;
    el.textContent = n || '';
    el.setAttribute('aria-label', n + ({ 'cnt-requests': ' waiting', 'cnt-enquiries': ' questions waiting' }[id] || ' awaiting payment'));
  }

  function loadOverview() {
    if (!$('ov-stats').innerHTML) { $('ov-stats').innerHTML = skeleton(2); $('ov-today').innerHTML = skeleton(3); }
    // The counts call fills the overview too; it is made once, above.
  }
  function paintOverview(o) {
    var c = o.counts || {};
    $('ov-stats').innerHTML =
      stat('Appointments today', c.today || 0, '#/calendar', 'Open the calendar') +
      stat('Waiting for your reply', c.requested || 0, '#/requests', 'Review requests', c.requested ? 'is-hot' : '') +
      stat('Outstanding', moneyList(o.outstanding), '#/payments', (c.awaiting_payment || 0) + ' awaiting payment') +
      stat('Received, last 7 days', moneyList(o.received_7d), '#/payments', 'Whish and cash');
    var today = o.today || [];
    $('ov-today').innerHTML = today.length
      ? '<ul class="adm-rows">' + today.map(row).join('') + '</ul>'
      : empty('Nothing booked today', 'Approved and confirmed appointments for today appear here.');
    var alerts = (o.alerts || []).slice();
    if (c.enquiries) {
      alerts.unshift({ level: 'info', href: '#/enquiries',
        text: c.enquiries + (c.enquiries === 1 ? ' website question is' : ' website questions are') + ' waiting for a reply.' });
    }
    $('ov-alerts').innerHTML = alerts.length
      ? '<ul class="adm-alerts">' + alerts.map(function (a) {
          return '<li class="adm-alert is-' + esc(a.level) + '">' +
            (a.appointment_id ? '<button type="button" class="adm-alert-b" data-open="' + esc(a.appointment_id) + '">' + esc(a.text) + '</button>'
              : a.href ? '<a class="adm-alert-b" href="' + esc(a.href) + '">' + esc(a.text) + '</a>' : esc(a.text)) + '</li>';
        }).join('') + '</ul>'
      : empty('All clear', 'Late replies, website questions, failed payments and expiring holds appear here.');
  }
  function stat(label, value, href, foot, cls) {
    return '<a class="adm-stat ' + (cls || '') + '" href="' + href + '"><span class="adm-stat-l">' + esc(label) + '</span>' +
      '<span class="adm-stat-v">' + esc(value) + '</span><span class="adm-stat-f">' + esc(foot) + ' →</span></a>';
  }
  // One appointment as a clickable row.
  function row(a) {
    return '<li><button type="button" class="adm-row" data-open="' + esc(a.id) + '">' +
      '<span class="adm-row-time">' + esc(a.local_time) + '<small>' + esc(a.service.duration_min) + ' min</small></span>' +
      '<span class="adm-row-main"><strong>' + esc(a.patient.name) + '</strong><span>' + esc(a.service.name) +
      (a.mode === 'online' ? ' · Online' : '') + '</span></span>' +
      '<span class="adm-row-badges">' + apptBadge(a.status) + ' ' + payBadge(a.payment) + '</span></button></li>';
  }

  /* ---------- Requests ---------- */
  function loadRequests() {
    var box = $('rq-list');
    if (!box.innerHTML) box.innerHTML = skeleton(4);
    var fresh = latest('requests');
    A.list({ status: 'requested,reschedule_requested', sort: 'created', page_size: 50 }).then(function (res) {
      if (!fresh() || !guard(res)) return;
      if (!res.ok) { box.innerHTML = failed('Requests', 'requests'); return; }
      var items = res.body.items || [];
      box.innerHTML = items.length ? '<ul class="adm-cards">' + items.map(requestCard).join('') + '</ul>'
        : empty('No requests waiting', 'New booking requests appear here as soon as patients send them.');
    }, function () { box.innerHTML = failed('Requests', 'requests'); });
  }
  function requestCard(a) {
    var waiting = a.status === 'reschedule_requested';
    return '<li class="adm-card" data-id="' + esc(a.id) + '">' +
      '<div class="adm-card-top"><div><p class="adm-card-k">' + esc(a.reference) + ' · received ' + esc(ago(a.created_at)) + '</p>' +
      '<h3 class="adm-card-h">' + esc(a.patient.name) + (a.for_whom === 'child' ? ' <span class="badge tone-neutral">For their child</span>' : '') + '</h3></div>' +
      apptBadge(a.status) + '</div>' +
      '<dl class="adm-dl">' +
      '<div><dt>Service</dt><dd>' + esc(a.service.name) + ' · ' + esc(a.service.duration_min) + ' min' + (a.mode === 'online' ? ' · Online' : '') + '</dd></div>' +
      '<div><dt>' + (waiting ? 'Proposed time' : 'Requested time') + '</dt><dd>' + esc(when(a)) + ' Beirut time</dd></div>' +
      ((session.practitioners || []).length > 1 ? '<div><dt>Practitioner</dt><dd>' + esc(a.practitioner.name) + '</dd></div>' : '') +
      '<div><dt>WhatsApp</dt><dd><a href="' + waLink(a.patient.phone) + '" target="_blank" rel="noopener">' + esc(a.patient.phone) + '</a>' +
      (a.patient.email ? ' · <a href="mailto:' + esc(a.patient.email) + '">' + esc(a.patient.email) + '</a>' : '') + '</dd></div>' +
      (a.hold_expires_at ? '<div><dt>Held</dt><dd>Until ' + esc(at(a.hold_expires_at)) + ' (' + esc(inHours(a.hold_expires_at)) + ')</dd></div>' : '') +
      '</dl>' +
      (a.note ? '<details class="adm-note"><summary>Note from the patient</summary><p>' + esc(a.note) + '</p></details>' : '') +
      (waiting ? '<p class="adm-card-wait">Waiting for the patient to accept the new time.</p>' : '') +
      '<div class="adm-card-acts">' + actionButtons(a, true) + '<button class="bk-linkbtn" type="button" data-open="' + esc(a.id) + '">Details</button></div>' +
      '</li>';
  }

  /* The buttons for what the server says can be done to this record. */
  var ACTION = {
    approve: ['Approve', 'btn-spring'],
    reschedule: ['Propose another time', 'btn-ghost-light'],
    decline: ['Decline', 'btn-ghost-light'],
    complete: ['Mark completed', 'btn-ghost-light'],
    no_show: ['Mark no-show', 'btn-ghost-light'],
    cancel: ['Cancel appointment', 'btn-ghost-light']
  };
  function actionButtons(a, compact) {
    return (a.actions || []).filter(function (k) { return ACTION[k]; }).map(function (k) {
      return '<button class="btn ' + ACTION[k][1] + ' btn-sm' + (k === 'cancel' || k === 'decline' ? ' adm-danger' : '') +
        '" type="button" data-act="' + k + '" data-id="' + esc(a.id) + '">' + ACTION[k][0] + '</button>';
    }).join('');
  }

  // Appointment records shown anywhere, by id, so an action button can find its record.
  var known = {};
  function remember(list) { (list || []).forEach(function (a) { if (a && a.id) known[a.id] = a; }); }
  var origList = A.list;
  A.list = function (f) {
    return origList(f).then(function (res) { if (res.ok && res.body) remember(res.body.items); return res; });
  };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act]');
    if (!b) return;
    var a = known[b.getAttribute('data-id')];
    if (a) runAction(b.getAttribute('data-act'), a);
  });

  /* ---------- Appointments ---------- */
  var apPage = 1;
  function apFilters() {
    return {
      q: $('ap-q').value.trim(), status: $('ap-status').value, payment_method: $('ap-method').value,
      practitioner_id: $('ap-prac').value, date_from: $('ap-from').value, date_to: $('ap-to').value,
      page: apPage, page_size: 20
    };
  }
  function loadAppointments() {
    var box = $('ap-list');
    if (!$('ap-from').value && !$('ap-from').dataset.touched) $('ap-from').value = T.today();
    if (!box.innerHTML) box.innerHTML = skeleton(6);
    var fresh = latest('appointments');
    A.list(apFilters()).then(function (res) {
      if (!fresh() || !guard(res)) return;
      if (!res.ok) { box.innerHTML = failed('Appointments', 'appointments'); return; }
      var items = res.body.items || [];
      box.innerHTML = items.length ? table(items)
        : empty('No appointments match', 'Change or clear the filters to see more.');
      pager('ap-pager', res.body, function (n) { apPage = n; loadAppointments(); });
    }, function () { box.innerHTML = failed('Appointments', 'appointments'); });
  }
  function table(items) {
    return '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
      '<th scope="col">When</th><th scope="col">Patient</th><th scope="col">Service</th><th scope="col">Status</th><th scope="col">Payment</th><th scope="col"><span class="vh">Open</span></th>' +
      '</tr></thead><tbody>' + items.map(function (a) {
        return '<tr><td data-l="When"><strong>' + esc(when(a)) + '</strong></td>' +
          '<td data-l="Patient">' + esc(a.patient.name) + '<small>' + esc(a.reference) + '</small></td>' +
          '<td data-l="Service">' + esc(a.service.name) + (a.mode === 'online' ? '<small>Online</small>' : '') + '</td>' +
          '<td data-l="Status">' + apptBadge(a.status) + '</td>' +
          '<td data-l="Payment">' + payBadge(a.payment) + '</td>' +
          '<td class="adm-td-open"><button class="btn btn-ghost-light btn-compact" type="button" data-open="' + esc(a.id) + '">Open<span class="vh">, ' + esc(a.patient.name) + '</span></button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function pager(id, pg, go) {
    var el = $(id);
    var total = pg.total || 0, size = pg.page_size || 20, n = pg.page || 1;
    var pages = Math.max(1, Math.ceil(total / size));
    if (total <= size) { el.innerHTML = total ? '<p class="adm-pager-t">' + total + ' shown</p>' : ''; return; }
    el.innerHTML = '<p class="adm-pager-t">' + ((n - 1) * size + 1) + '–' + Math.min(n * size, total) + ' of ' + total + '</p>' +
      '<button class="btn btn-ghost-light btn-compact" type="button" data-pg="' + (n - 1) + '"' + (n <= 1 ? ' disabled' : '') + '>Previous</button>' +
      '<button class="btn btn-ghost-light btn-compact" type="button" data-pg="' + (n + 1) + '"' + (n >= pages ? ' disabled' : '') + '>Next</button>';
    Array.prototype.forEach.call(el.querySelectorAll('[data-pg]'), function (b) {
      b.addEventListener('click', function () { go(+b.getAttribute('data-pg')); });
    });
  }
  var qTimer = 0;
  $('ap-filters').addEventListener('input', function (e) {
    if (e.target.id === 'ap-from') e.target.dataset.touched = '1';
    apPage = 1;
    clearTimeout(qTimer);
    qTimer = setTimeout(loadAppointments, e.target.id === 'ap-q' ? 300 : 0);
  });
  $('ap-filters').addEventListener('submit', function (e) { e.preventDefault(); });
  $('ap-clear').addEventListener('click', function () {
    $('ap-filters').reset();
    $('ap-from').dataset.touched = '1';
    apPage = 1;
    loadAppointments();
  });

  /* ---------- Calendar ---------- */
  var cal = { mode: window.matchMedia('(max-width: 700px)').matches ? 'day' : 'week', date: T.today() };
  var DAY_START = 8 * 60, DAY_END = 19 * 60;
  function calRange() {
    if (cal.mode === 'day') return [cal.date];
    var dow = T.dow(cal.date), monday = T.addDays(cal.date, dow === 0 ? -6 : 1 - dow);
    var out = [];
    for (var i = 0; i < 6; i++) out.push(T.addDays(monday, i));   // Monday to Saturday
    return out;
  }
  function loadCalendar() {
    var days = calRange();
    $('cal-day').setAttribute('aria-pressed', String(cal.mode === 'day'));
    $('cal-week').setAttribute('aria-pressed', String(cal.mode === 'week'));
    $('cal-range').textContent = days.length === 1 ? T.dayLabelYear(days[0])
      : T.dayLabel(days[0]) + ' – ' + T.dayLabel(days[days.length - 1]);
    var grid = $('cal-grid');
    if (!grid.innerHTML) grid.innerHTML = skeleton(6);
    var fresh = latest('calendar');
    Promise.all([
      A.list({ date_from: days[0], date_to: days[days.length - 1], page_size: 100 }),
      A.schedule({ from: days[0], to: days[days.length - 1] })
    ]).then(function (r) {
      if (!fresh() || !guard(r[0]) || !guard(r[1])) return;
      if (!r[0].ok || !r[1].ok) { grid.innerHTML = failed('The calendar', 'calendar'); return; }
      paintCalendar(days, r[0].body.items || [], r[1].body);
    }, function () { grid.innerHTML = failed('The calendar', 'calendar'); });
  }
  var schedule = null;
  function paintCalendar(days, appts, sched) {
    schedule = sched;
    var ppm = 1.15, height = (DAY_END - DAY_START) * ppm;
    var hours = '';
    for (var m = DAY_START; m < DAY_END; m += 60) hours += '<span style="top:' + ((m - DAY_START) * ppm) + 'px">' + T.fromMin(m) + '</span>';
    var canEdit = session.permissions && session.permissions.manage_schedule;
    var cols = days.map(function (d) {
      var wh = (sched.working_hours || []).filter(function (w) { return w.weekday === T.dow(d); })[0];
      var open = (wh ? wh.blocks : []).map(function (b) {
        var top = (Math.max(T.toMin(b.start), DAY_START) - DAY_START) * ppm, h = (Math.min(T.toMin(b.end), DAY_END) - Math.max(T.toMin(b.start), DAY_START)) * ppm;
        return '<span class="adm-open" style="top:' + top + 'px;height:' + h + 'px"></span>';
      }).join('');
      var blocks = (sched.exceptions || []).filter(function (x) { return x.date === d; }).map(function (x) {
        var top = (T.toMin(x.start) - DAY_START) * ppm, h = (T.toMin(x.end) - T.toMin(x.start)) * ppm;
        return '<div class="adm-block adm-hatch" style="top:' + top + 'px;height:' + h + 'px">' +
          '<span>' + esc(x.start + '–' + x.end) + (x.reason ? ' · ' + esc(x.reason) : '') + '</span>' +
          (canEdit ? '<button type="button" class="adm-block-x" data-unblock="' + esc(x.id) + '" aria-label="Remove blocked time ' + esc(x.start + ' to ' + x.end) + '">×</button>' : '') + '</div>';
      }).join('');
      var items = appts.filter(function (a) {
        return a.local_date === d && ['declined', 'cancelled', 'expired'].indexOf(a.status) < 0;
      }).map(function (a) {
        var top = (T.toMin(a.local_time) - DAY_START) * ppm, h = Math.max(a.service.duration_min * ppm, 30);
        return '<button type="button" class="adm-ev tone-' + L.appointment(a.status).tone + '" data-open="' + esc(a.id) + '" style="top:' + top + 'px;height:' + h + 'px">' +
          '<strong>' + esc(a.local_time) + ' ' + esc(a.patient.name) + '</strong><span>' + esc(a.service.name) + '</span>' +
          '<span class="vh">, ' + esc(L.appointment(a.status).label) + ', ' + esc(L.paymentSummary(a.payment.method, a.payment.status)) + '</span></button>';
      }).join('');
      var closed = !wh;
      var p = T.dayParts(d);
      return '<div class="adm-calcol' + (d === T.today() ? ' is-today' : '') + (closed ? ' is-closed' : '') + '">' +
        '<p class="adm-calday"><span>' + T.DOW[p.dow] + '</span> ' + p.date + (closed ? ' <small>Closed</small>' : '') + '</p>' +
        '<div class="adm-calbody" style="height:' + height + 'px">' + open + blocks + items + '</div></div>';
    }).join('');
    $('cal-grid').innerHTML = '<div class="adm-calscroll"><div class="adm-calgrid" style="--days:' + days.length + '">' +
      '<div class="adm-calhours"><p class="adm-calday">&nbsp;</p><div class="adm-calbody" style="height:' + height + 'px">' + hours + '</div></div>' +
      cols + '</div></div>';
  }
  $('cal-day').addEventListener('click', function () { cal.mode = 'day'; loadCalendar(); });
  $('cal-week').addEventListener('click', function () { cal.mode = 'week'; loadCalendar(); });
  $('cal-prev').addEventListener('click', function () { cal.date = T.addDays(cal.date, cal.mode === 'day' ? -1 : -7); loadCalendar(); });
  $('cal-next').addEventListener('click', function () { cal.date = T.addDays(cal.date, cal.mode === 'day' ? 1 : 7); loadCalendar(); });
  $('cal-today').addEventListener('click', function () { cal.date = T.today(); loadCalendar(); });
  $('cal-block').addEventListener('click', blockTime);
  $('cal-grid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-unblock]');
    if (!b) return;
    var id = b.getAttribute('data-unblock');
    var x = ((schedule && schedule.exceptions) || []).filter(function (e2) { return e2.id === id; })[0];
    dialog({
      title: 'Remove this blocked time?',
      body: '<p class="adm-dl-p">' + esc(x ? T.dayLabel(x.date, true) + ', ' + x.start + '–' + x.end + (x.reason ? ' (' + x.reason + ')' : '') : '') +
            '. Patients can request these times again once it is removed.</p>',
      ok: 'Remove block',
      send: function (key) { return A.updateSchedule({ remove: [id] }, key); },
      done: function () { toast('Blocked time removed.'); loadCalendar(); }
    });
  });

  function timeOptions(from, to, step, sel) {
    var s = '';
    for (var m = from; m <= to; m += step) s += '<option' + (T.fromMin(m) === sel ? ' selected' : '') + '>' + T.fromMin(m) + '</option>';
    return s;
  }
  function blockTime() {
    dialog({
      title: 'Block time',
      body: '<p class="adm-dl-p">Patients cannot request a blocked time. Existing appointments are not changed.</p>' +
        '<div class="adm-form">' +
        field('bt-date', 'Day', '<input class="input" id="bt-date" type="date" required value="' + esc(cal.date) + '" min="' + esc(T.today()) + '">') +
        '<div class="adm-form-2">' +
        field('bt-start', 'From', '<select class="input" id="bt-start">' + timeOptions(7 * 60, 20 * 60, 15, '12:00') + '</select>') +
        field('bt-end', 'Until', '<select class="input" id="bt-end">' + timeOptions(7 * 60 + 15, 21 * 60, 15, '13:00') + '</select>') +
        '</div>' +
        field('bt-reason', 'Reason (staff only)', '<input class="input" id="bt-reason" type="text" maxlength="120" placeholder="Training, holiday, meeting…">') +
        '</div>',
      ok: 'Block time',
      check: function () {
        if (!$('bt-date').value) return ['bt-date', 'Choose a day.'];
        if (T.toMin($('bt-end').value) <= T.toMin($('bt-start').value)) return ['bt-end', 'End after the start time.'];
        return null;
      },
      send: function (key) {
        return A.updateSchedule({ add: [{ practitioner_id: session.practitioners && session.practitioners.length === 1 ? session.practitioners[0].id : null,
          date: $('bt-date').value, start: $('bt-start').value, end: $('bt-end').value, reason: $('bt-reason').value.trim() }] }, key);
      },
      done: function () { cal.date = $('bt-date').value || cal.date; toast('Time blocked.'); loadCalendar(); }
    });
  }

  /* ---------- Payments ---------- */
  var pyPage = 1;
  var payRows = {};
  function loadPayments() {
    var box = $('py-list');
    if (!box.innerHTML) box.innerHTML = skeleton(6);
    var fresh = latest('payments');
    P.list({ status: $('py-status').value, payment_method: $('py-method').value, page: pyPage, page_size: 20 }).then(function (res) {
      if (!fresh() || !guard(res)) return;
      if (!res.ok) { box.innerHTML = failed('Payments', 'payments'); return; }
      var items = res.body.items || [];
      items.forEach(function (p) { payRows[p.id] = p; });
      box.innerHTML = items.length ? payTable(items) : empty('No payments match', 'Change the filters to see more.');
      pager('py-pager', res.body, function (n) { pyPage = n; loadPayments(); });
    }, function () { box.innerHTML = failed('Payments', 'payments'); });
  }
  function verifiedBy(p) {
    if (p.status !== 'paid' && !(p.transactions || []).some(function (t) { return t.provider === 'cash'; })) return '<span class="adm-muted">Not yet</span>';
    if (p.verified_by === 'whish') return '<span class="adm-src is-whish">Verified by Whish</span>';
    var who = p.recorded_by ? p.recorded_by.name : 'staff';
    return '<span class="adm-src is-cash">Cash recorded by ' + esc(who) + '</span>';
  }
  function payTable(items) {
    return '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
      '<th scope="col">Appointment</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Confirmation</th><th scope="col">Updated</th><th scope="col"><span class="vh">Actions</span></th>' +
      '</tr></thead><tbody>' + items.map(function (p) {
        var a = p.appointment || {};
        return '<tr><td data-l="Appointment"><button type="button" class="adm-linkish" data-open="' + esc(a.id) + '">' + esc(a.patient_name) + '</button>' +
          '<small>' + esc(a.reference) + ' · ' + esc(a.service_name) + ' · ' + esc(T.dayLabel(a.local_date) + ' ' + a.local_time) + '</small></td>' +
          '<td data-l="Amount"><strong>' + esc(money(p.amount, p.currency)) + '</strong>' +
          (p.status !== 'paid' && p.outstanding !== p.amount ? '<small>' + esc(money(p.outstanding, p.currency)) + ' still owed</small>' : '') + '</td>' +
          '<td data-l="Status">' + payBadge(p) + (p.financial_closed_at ? ' ' + badge({ label: 'Closed', tone: 'neutral' }) : '') + '</td>' +
          '<td data-l="Confirmation">' + verifiedBy(p) + (p.receipt_reference ? '<small>Ref. ' + esc(p.receipt_reference) + '</small>' : '') + '</td>' +
          '<td data-l="Updated">' + esc(ago(p.updated_at)) + '</td>' +
          '<td class="adm-td-open">' + ((p.actions || []).indexOf('confirm_cash') >= 0 && session.permissions && session.permissions.confirm_cash
            ? '<button class="btn btn-spring btn-compact" type="button" data-cash="' + esc(p.id) + '">Confirm cash received</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  $('py-filters').addEventListener('change', function () { pyPage = 1; loadPayments(); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-cash]');
    if (!b) return;
    var id = b.getAttribute('data-cash');
    var p = payRows[id];
    if (p) confirmCash(p);
  });

  /* Recording cash is the one money action staff take, so it asks for the
     amount and an explicit "received" tick, sends once, and then shows the
     server's record: the button disappears because the server stops
     offering it, not because the page hid it. */
  function confirmCash(p) {
    var a = p.appointment || {};
    var major = p.currency === 'USD' ? (p.outstanding / 100).toFixed(2).replace(/\.00$/, '') : String(p.outstanding);
    dialog({
      title: 'Confirm cash received',
      body: '<p class="adm-dl-p"><strong>' + esc(a.patient_name) + '</strong> · ' + esc(a.reference) + ' · ' + esc(a.service_name) + '<br>' +
        'Amount owed: <strong>' + esc(money(p.outstanding, p.currency)) + '</strong></p>' +
        '<div class="adm-form">' +
        '<div class="adm-form-2">' +
        field('cc-amount', 'Amount received', '<input class="input" id="cc-amount" type="text" inputmode="decimal" value="' + esc(major) + '" autocomplete="off">') +
        field('cc-cur', 'Currency', '<input class="input" id="cc-cur" type="text" value="' + esc(p.currency) + '" readonly>') +
        '</div>' +
        field('cc-ref', 'Receipt number (optional)', '<input class="input" id="cc-ref" type="text" maxlength="60" autocomplete="off">') +
        '<p class="adm-field"><label class="adm-check"><input type="checkbox" id="cc-ok"> <span>I have received this cash in hand.</span></label>' +
        '<span class="field-err" id="err-cc-ok" hidden></span></p>' +
        '</div>',
      ok: 'Record cash received',
      tone: 'spring',
      check: function () {
        var v = $('cc-amount').value.trim().replace(/,/g, '');
        if (!/^\d+(\.\d{1,2})?$/.test(v) || +v <= 0) return ['cc-amount', 'Enter the amount, for example 80 or 80.50.'];
        if (!$('cc-ok').checked) return ['cc-ok', 'Tick the box to confirm the cash is in hand.'];
        return null;
      },
      send: function (key) {
        var v = +$('cc-amount').value.trim().replace(/,/g, '');
        return P.confirmCash(p.id, { amount: p.currency === 'USD' ? Math.round(v * 100) : Math.round(v), currency: p.currency,
                                     reference: $('cc-ref').value.trim() || null }, key);
      },
      fieldFor: { amount: 'cc-amount', reference: 'cc-ref' },
      done: function (res) {
        var np = res.body && res.body.payment;
        toast(np && np.status === 'paid' ? 'Cash recorded. ' + (a.reference || '') + ' is paid.' : 'Cash recorded.');
        refresh();
        if ($('adm-drawer').open && a.id) openDrawer(a.id);
      }
    });
  }

  /* ---------- Enquiries ----------
     Website questions. The reply goes by email or WhatsApp from the
     clinic; marking a question answered only moves it off the waiting
     list, and can be undone. */
  var eq = { status: 'open', page: 1 };
  var eqRows = {};
  var eqKeys = {};
  function loadEnquiries() {
    var box = $('eq-list');
    Array.prototype.forEach.call(document.querySelectorAll('[data-eq]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-eq') === eq.status));
    });
    if (!box.innerHTML) box.innerHTML = skeleton(4);
    var notes = eq.status === 'notes';
    $('eq-intro').textContent = notes
      ? 'What patients wrote in “What brings you in?” when they requested an appointment, newest first. Open the appointment to reply or act on it.'
      : 'Questions sent from the website’s contact form. Reply by email or WhatsApp, then mark the question answered so it leaves this list.';
    $('eq-q').placeholder = notes ? 'Name, phone, reference' : 'Name, email, phone or words in the question';
    if (notes) return loadNotes(box);
    var fresh = latest('enquiries');
    A.enquiries({ status: eq.status, q: $('eq-q').value.trim(), page: eq.page, page_size: 20 }).then(function (res) {
      if (!fresh() || !guard(res)) return;
      if (!res.ok) { box.innerHTML = failed('Enquiries', 'enquiries'); return; }
      var items = res.body.items || [];
      items.forEach(function (e) { eqRows[e.id] = e; });
      box.innerHTML = items.length ? '<ul class="adm-cards adm-eq">' + items.map(enquiryCard).join('') + '</ul>'
        : eq.status === 'open' ? empty('No questions waiting', 'Questions from the website’s contact form appear here.')
        : empty('Nothing here', 'Change the filter or the search to see more.');
      pager('eq-pager', res.body, function (n) { eq.page = n; loadEnquiries(); });
    }, function () { if (fresh()) box.innerHTML = failed('Enquiries', 'enquiries'); });
  }
  function enquiryCard(e) {
    var reply = 'mailto:' + encodeURIComponent(e.email) + '?subject=' + encodeURIComponent('Re: your question to Rayhab Movement Clinic');
    var answered = e.status === 'answered';
    return '<li class="adm-card' + (answered ? ' is-answered' : '') + '">' +
      '<div class="adm-card-top"><div><p class="adm-card-k">Received ' + esc(at(e.created_at)) + ' · ' + esc(ago(e.created_at)) + '</p>' +
      '<h3 class="adm-card-h">' + esc(e.name) + '</h3></div>' +
      badge(answered ? { label: 'Answered', tone: 'success' } : { label: 'Waiting', tone: 'pending' }) + '</div>' +
      '<p class="adm-eq-msg">' + esc(e.message) + '</p>' +
      '<dl class="adm-dl"><div><dt>Email</dt><dd><a href="' + esc(reply) + '">' + esc(e.email) + '</a></dd></div>' +
      (e.phone ? '<div><dt>Phone</dt><dd><a href="' + waLink(e.phone) + '" target="_blank" rel="noopener">' + esc(e.phone) + '</a></dd></div>' : '') +
      (answered && e.answered_at ? '<div><dt>Answered</dt><dd>' + esc(at(e.answered_at)) + (e.answered_by ? ' by ' + esc(e.answered_by.name) : '') + '</dd></div>' : '') +
      '</dl>' +
      '<div class="adm-card-acts">' +
      (answered ? '' : '<a class="btn btn-brand btn-sm" href="' + esc(reply) + '">Reply by email</a>' +
        (e.phone ? '<a class="btn btn-ghost-light btn-sm" href="' + waLink(e.phone) + '" target="_blank" rel="noopener">WhatsApp</a>' : '')) +
      '<button class="btn ' + (answered ? 'btn-ghost-light' : 'btn-spring') + ' btn-sm" type="button" data-answer="' + esc(e.id) + '" data-to="' + (answered ? '0' : '1') + '">' +
      (answered ? 'Reopen' : 'Mark answered') + '<span class="vh">, ' + esc(e.name) + '</span></button></div></li>';
  }
  /* Booking notes: the appointments that came with a note. Read here,
     acted on from the appointment itself. */
  function loadNotes(box) {
    var fresh = latest('enquiries');
    A.list({ has_note: 1, sort: 'created_desc', q: $('eq-q').value.trim(), page: eq.page, page_size: 20 }).then(function (res) {
      if (!fresh() || !guard(res)) return;
      if (!res.ok) { box.innerHTML = failed('Booking notes', 'enquiries'); return; }
      var items = res.body.items || [];
      box.innerHTML = items.length ? '<ul class="adm-cards adm-eq">' + items.map(noteCard).join('') + '</ul>'
        : empty('No booking notes', 'Notes patients add to a booking request appear here.');
      pager('eq-pager', res.body, function (n) { eq.page = n; loadEnquiries(); });
    }, function () { if (fresh()) box.innerHTML = failed('Booking notes', 'enquiries'); });
  }
  function noteCard(a) {
    return '<li class="adm-card">' +
      '<div class="adm-card-top"><div><p class="adm-card-k">' + esc(a.reference) + ' · received ' + esc(ago(a.created_at)) + '</p>' +
      '<h3 class="adm-card-h">' + esc(a.patient.name) + (a.for_whom === 'child' ? ' <span class="badge tone-neutral">For their child</span>' : '') + '</h3></div>' +
      apptBadge(a.status) + '</div>' +
      '<p class="adm-eq-msg">' + esc(a.note) + '</p>' +
      '<dl class="adm-dl">' +
      '<div><dt>Booking</dt><dd>' + esc(a.service.name) + ' · ' + esc(when(a)) + (a.mode === 'online' ? ' · Online' : '') + '</dd></div>' +
      '<div><dt>WhatsApp</dt><dd><a href="' + waLink(a.patient.phone) + '" target="_blank" rel="noopener">' + esc(a.patient.phone) + '</a></dd></div>' +
      (a.patient.email ? '<div><dt>Email</dt><dd><a href="mailto:' + esc(a.patient.email) + '">' + esc(a.patient.email) + '</a></dd></div>' : '') +
      '</dl>' +
      '<div class="adm-card-acts"><button class="btn btn-brand btn-sm" type="button" data-open="' + esc(a.id) + '">Open appointment<span class="vh">, ' + esc(a.patient.name) + '</span></button></div></li>';
  }

  // Marking answered can be undone, so it needs no confirmation; it is still
  // sent once, with a key kept for a retry of the same change.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-answer]');
    if (!b || b.disabled) return;
    var id = b.getAttribute('data-answer'), to = b.getAttribute('data-to') === '1', k = id + ':' + to;
    eqKeys[k] = eqKeys[k] || API.newKey();
    b.disabled = true; b.setAttribute('aria-busy', 'true');
    A.answerEnquiry(id, to, eqKeys[k]).then(function (res) {
      b.disabled = false; b.removeAttribute('aria-busy');
      if (!guard(res)) return;
      if (!res.ok) { toast('That could not be saved. Try again.'); return; }
      delete eqKeys[k];
      var who = eqRows[id] ? eqRows[id].name : 'The question';
      toast(to ? who + ': marked answered.' : who + ': back on the waiting list.');
      loadCounts();
      loadEnquiries();
    }, function () { b.disabled = false; b.removeAttribute('aria-busy'); toast('Could not reach the server. Try again.'); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-eq]'), function (b) {
    b.addEventListener('click', function () { eq.status = b.getAttribute('data-eq'); eq.page = 1; loadEnquiries(); });
  });
  var eqTimer = 0;
  $('eq-q').addEventListener('input', function () { eq.page = 1; clearTimeout(eqTimer); eqTimer = setTimeout(loadEnquiries, 300); });
  $('eq-filters').addEventListener('submit', function (e) { e.preventDefault(); });

  /* ---------- Activity ---------- */
  var acPage = 1;
  function loadActivity() {
    var box = $('ac-list');
    if (!box.innerHTML) box.innerHTML = skeleton(6);
    var fresh = latest('activity');
    A.audit({ type: $('ac-type').value, page: acPage, page_size: 30 }).then(function (res) {
      if (!fresh() || !guard(res)) return;
      if (!res.ok) { box.innerHTML = failed('Activity', 'activity'); return; }
      var items = res.body.items || [];
      box.innerHTML = items.length ? '<ol class="adm-log">' + items.map(logItem).join('') + '</ol>'
        : empty('No activity yet', 'Approvals, payments and schedule changes are recorded here.');
      pager('ac-pager', res.body, function (n) { acPage = n; loadActivity(); });
    }, function () { box.innerHTML = failed('Activity', 'activity'); });
  }
  function logItem(e) {
    return '<li class="adm-logi"><span class="adm-logi-t">' + esc(at(e.at)) + '</span>' +
      '<span class="adm-logi-m"><strong>' + esc(L.event(e.type)) + '</strong>' + esc(e.summary && e.summary !== L.event(e.type) ? ' · ' + e.summary : '') +
      '<small>' + esc(e.actor ? e.actor.name : '') + (e.reference ? ' · ' : '') +
      (e.appointment_id ? '<button type="button" class="adm-linkish" data-open="' + esc(e.appointment_id) + '">' + esc(e.reference) + '</button>' : '') + '</small></span></li>';
  }
  $('ac-filters').addEventListener('change', function () { acPage = 1; loadActivity(); });

  /* ---------- Detail drawer ---------- */
  var drawerFor = '';
  function openDrawer(id) {
    var d = $('adm-drawer');
    drawerFor = id;
    $('dr-body').innerHTML = skeleton(8);
    if (!d.open) { lastFocus = document.activeElement; d.showModal(); }
    A.get(id).then(function (res) {
      if (!guard(res) || drawerFor !== id) return;
      if (!res.ok) { $('dr-body').innerHTML = failed('This appointment', view); return; }
      var a = res.body.appointment;
      known[a.id] = a;
      paintDrawer(a, res.body.events || []);
    }, function () { $('dr-body').innerHTML = failed('This appointment', view); });
  }
  function paintDrawer(a, events) {
    var p = a.payment || {};
    var many = (session.practitioners || []).length > 1;
    var tx = (p.transactions || []).map(function (t) {
      return '<li><span>' + esc(at(t.at)) + '</span><span>' + esc(t.provider === 'cash' ? 'Cash' : 'Whish') + ' · ' + esc(money(t.amount, t.currency)) +
        ' · ' + esc({ verified: 'Verified', failed: 'Failed', abandoned: 'Not completed', pending: 'Pending' }[t.status] || t.status) +
        (t.reference ? ' · ' + esc(t.reference) : '') + '</span></li>';
    }).join('');
    var cash = (p.actions || []).indexOf('confirm_cash') >= 0 && session.permissions && session.permissions.confirm_cash;
    $('dr-body').innerHTML =
      '<p class="adm-card-k">' + esc(a.reference) + ' · requested ' + esc(at(a.created_at)) + '</p>' +
      '<h2 class="adm-drawer-h" id="dr-title" tabindex="-1">' + esc(a.patient.name) + '</h2>' +
      '<p class="adm-drawer-badges">' + apptBadge(a.status) + ' ' + payBadge(p) + ' ' +
        badge({ label: 'Financial ' + L.financial(a.financial_closed_at).label.toLowerCase(), tone: L.financial(a.financial_closed_at).tone }) + '</p>' +
      '<div class="adm-card-acts">' + actionButtons(a) + '</div>' +
      '<h3 class="adm-h3">Appointment</h3><dl class="adm-dl">' +
        '<div><dt>When</dt><dd>' + esc(T.dayLabelYear(a.local_date)) + ', ' + esc(a.local_time) + ' Beirut time</dd></div>' +
        '<div><dt>Service</dt><dd>' + esc(a.service.name) + ' · ' + esc(a.service.duration_min) + ' min</dd></div>' +
        '<div><dt>Where</dt><dd>' + (a.mode === 'online' ? 'Online, video call' : 'Beirut clinic') + '</dd></div>' +
        (many ? '<div><dt>Practitioner</dt><dd>' + esc(a.practitioner.name) + '</dd></div>' : '') +
        '<div><dt>For</dt><dd>' + (a.for_whom === 'child' ? 'Their child' : 'Themselves') + '</dd></div>' +
        (a.hold_expires_at ? '<div><dt>Held until</dt><dd>' + esc(at(a.hold_expires_at)) + '</dd></div>' : '') +
      '</dl>' +
      '<h3 class="adm-h3">Contact</h3><dl class="adm-dl">' +
        '<div><dt>WhatsApp</dt><dd><a href="' + waLink(a.patient.phone) + '" target="_blank" rel="noopener">' + esc(a.patient.phone) + '</a></dd></div>' +
        (a.patient.email ? '<div><dt>Email</dt><dd><a href="mailto:' + esc(a.patient.email) + '">' + esc(a.patient.email) + '</a></dd></div>' : '') +
      '</dl>' +
      (a.note ? '<details class="adm-note"><summary>Note from the patient</summary><p>' + esc(a.note) + '</p></details>' : '') +
      '<h3 class="adm-h3">Payment</h3><dl class="adm-dl">' +
        '<div><dt>Method</dt><dd>' + esc(L.method(p.method).label) + '</dd></div>' +
        '<div><dt>Amount</dt><dd>' + esc(money(p.amount, p.currency)) + (p.status !== 'paid' && p.outstanding != null ? ' · ' + esc(money(p.outstanding, p.currency)) + ' owed' : '') + '</dd></div>' +
        '<div><dt>Confirmation</dt><dd>' + verifiedBy(p) + (p.receipt_reference ? ' · Ref. ' + esc(p.receipt_reference) : '') + '</dd></div>' +
      '</dl>' +
      (tx ? '<ul class="adm-tx">' + tx + '</ul>' : '') +
      (cash ? '<p class="mt-4"><button class="btn btn-spring btn-sm" type="button" id="dr-cash">Confirm cash received</button></p>' : '') +
      '<p class="adm-fine">Paid is not the same as completed: the session is marked completed separately, once it has taken place.</p>' +
      '<h3 class="adm-h3">History</h3>' +
      (events.length ? '<ol class="adm-log adm-log-tight">' + events.map(logItem).join('') + '</ol>' : '<p class="adm-muted">No history yet.</p>');
    var cb = $('dr-cash');
    if (cb) cb.addEventListener('click', function () {
      var row = JSON.parse(JSON.stringify(p));
      row.appointment = { id: a.id, reference: a.reference, service_name: a.service.name, patient_name: a.patient.name,
                          local_date: a.local_date, local_time: a.local_time };
      confirmCash(row);
    });
    $('dr-title').focus();
  }
  var lastFocus = null;
  function closeDrawer() {
    var d = $('adm-drawer');
    if (d.open) d.close();
  }
  $('dr-close').addEventListener('click', closeDrawer);
  $('adm-drawer').addEventListener('close', function () {
    drawerFor = '';
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  });
  $('adm-drawer').addEventListener('click', function (e) { if (e.target === $('adm-drawer')) closeDrawer(); });

  /* ---------- Appointment actions ---------- */
  function summaryLine(a) {
    return '<p class="adm-dl-p"><strong>' + esc(a.patient.name) + '</strong> · ' + esc(a.reference) + '<br>' +
      esc(a.service.name) + ' · ' + esc(T.dayLabel(a.local_date, true)) + ', ' + esc(a.local_time) + ' Beirut time</p>';
  }
  function runAction(kind, a) {
    var after = function (res, msg) {
      toast(msg);
      refresh();
      if ($('adm-drawer').open) openDrawer(a.id);
    };
    if (kind === 'approve') {
      return dialog({ title: 'Approve this request?', ok: 'Approve and notify', tone: 'spring',
        body: summaryLine(a) + '<p class="adm-dl-p">The patient gets a WhatsApp message with a secure link to choose how to pay.</p>',
        send: function (key) { return A.approve(a.id, {}, key); },
        done: function (res) { after(res, a.reference + ' approved. The patient is being notified.'); } });
    }
    if (kind === 'decline') {
      return dialog({ title: 'Decline this request?', ok: 'Decline request', tone: 'danger',
        body: summaryLine(a) + '<div class="adm-form">' +
          field('dc-reason', 'Reason', '<select class="input" id="dc-reason"><option value="">Choose a reason</option>' +
            ['No suitable time available', 'Not the right service for this concern', 'Outside what the clinic treats', 'Duplicate request', 'Other']
              .map(function (r) { return '<option>' + r + '</option>'; }).join('') + '</select>') +
          field('dc-msg', 'Message to the patient (optional)', '<textarea class="textarea" id="dc-msg" maxlength="500" placeholder="Sent with the WhatsApp message."></textarea>') +
          '</div><p class="adm-dl-p">The time is released and the patient is told by WhatsApp. The message passes through Meta, so leave out medical details.</p>',
        check: function () { return $('dc-reason').value ? null : ['dc-reason', 'Choose a reason.']; },
        fieldFor: { reason: 'dc-reason', message: 'dc-msg' },
        send: function (key) { return A.decline(a.id, { reason: $('dc-reason').value, message: $('dc-msg').value.trim() || null }, key); },
        done: function (res) { after(res, a.reference + ' declined.'); } });
    }
    if (kind === 'reschedule') return propose(a, after);
    if (kind === 'cancel') {
      return dialog({ title: 'Cancel this appointment?', ok: 'Cancel appointment', tone: 'danger', cancelLabel: 'Keep it',
        body: summaryLine(a) + '<div class="adm-form">' +
          field('cn-reason', 'Reason (shared with the patient)', '<textarea class="textarea" id="cn-reason" maxlength="500"></textarea>') + '</div>' +
          (a.payment && a.payment.status === 'paid' ? '<p class="notice notice-info mt-3">This appointment is paid. Any refund is handled separately.</p>' : ''),
        send: function (key) { return A.cancel(a.id, { reason: $('cn-reason').value.trim() || null }, key); },
        done: function (res) { after(res, a.reference + ' cancelled.'); } });
    }
    if (kind === 'complete') {
      return dialog({ title: 'Mark as completed?', ok: 'Mark completed',
        body: summaryLine(a) + '<p class="adm-dl-p">Use this once the session has taken place. It does not change the payment.</p>',
        send: function (key) { return A.complete(a.id, {}, key); },
        done: function (res) { after(res, a.reference + ' marked completed.'); } });
    }
    if (kind === 'no_show') {
      return dialog({ title: 'Mark as a no-show?', ok: 'Mark no-show', tone: 'danger',
        body: summaryLine(a) + '<p class="adm-dl-p">The patient did not attend. It does not change the payment.</p>',
        send: function (key) { return A.noShow(a.id, {}, key); },
        done: function (res) { after(res, a.reference + ' marked no-show.'); } });
    }
  }

  /* Propose another time: a day, then only the times the calendar says
     are free for that service, from the same availability the patients see. */
  function propose(a, after) {
    var first = T.addDays(T.today(), 1);
    dialog({ title: 'Propose another time', ok: 'Send new time',
      body: summaryLine(a) + '<div class="adm-form"><div class="adm-form-2">' +
        field('pr-date', 'Day', '<input class="input" id="pr-date" type="date" min="' + first + '" value="' + esc(a.local_date >= first ? a.local_date : first) + '">') +
        field('pr-time', 'Time', '<select class="input" id="pr-time" disabled><option>Loading…</option></select>') +
        '</div>' +
        field('pr-msg', 'Message to the patient (optional)', '<textarea class="textarea" id="pr-msg" maxlength="500"></textarea>') +
        '</div><p class="adm-dl-p">The patient is asked by WhatsApp to accept the new time.</p>',
      open: function () {
        var load = function () {
          var sel = $('pr-time'), d = $('pr-date').value;
          sel.disabled = true; sel.innerHTML = '<option>Loading…</option>';
          if (!d || !API.availability) return;
          API.availability.slots({ service_id: a.service.id, practitioner_id: a.practitioner.id, mode: a.mode, date: d }).then(function (res) {
            if ($('pr-date').value !== d) return;
            var free = ((res.ok && res.body && res.body.slots) || []).filter(function (s) { return s.available; });
            sel.innerHTML = free.length ? free.map(function (s) { return '<option>' + esc(s.time) + '</option>'; }).join('')
              : '<option value="">No free times</option>';
            sel.disabled = !free.length;
          }, function () { sel.innerHTML = '<option value="">Could not load times</option>'; });
        };
        $('pr-date').addEventListener('change', load);
        load();
      },
      check: function () {
        if (!$('pr-date').value) return ['pr-date', 'Choose a day.'];
        if ($('pr-time').disabled || !$('pr-time').value) return ['pr-time', 'Choose a free time, or another day.'];
        return null;
      },
      fieldFor: { date: 'pr-date', time: 'pr-time', message: 'pr-msg' },
      send: function (key) { return A.reschedule(a.id, { date: $('pr-date').value, time: $('pr-time').value, message: $('pr-msg').value.trim() || null }, key); },
      done: function (res) { after(res, 'New time sent to the patient.'); } });
  }

  function field(id, label, control) {
    return '<p class="adm-field"><label class="field-label" for="' + id + '">' + esc(label) + '</label>' + control +
      '<span class="field-err" id="err-' + id + '" hidden></span></p>';
  }

  /* ---------- The confirmation dialog ----------
     One for every change. It checks its own fields, sends once, keeps the
     same Idempotency-Key for a retry of the same change, shows the
     server's message on a refusal, and closes only on success. */
  var dl = null;
  function dialog(o) {
    var d = $('adm-dialog');
    dl = { o: o, key: API.newKey(), busy: false };
    $('dl-title').textContent = o.title;
    $('dl-body').innerHTML = o.body || '';
    $('dl-err').hidden = true;
    var ok = $('dl-ok');
    ok.textContent = o.ok || 'Confirm';
    ok.className = 'btn btn-sm ' + (o.tone === 'danger' ? 'btn-danger' : o.tone === 'spring' ? 'btn-spring' : 'btn-brand');
    ok.disabled = false;
    $('dl-cancel').textContent = o.cancelLabel || 'Cancel';
    if (!d.open) { dl.from = document.activeElement; d.showModal(); }
    if (o.open) o.open();
    var firstField = $('dl-body').querySelector('input:not([readonly]), select, textarea');
    (firstField || ok).focus();
  }
  function closeDialog() {
    var d = $('adm-dialog');
    if (d.open) d.close();
  }
  $('dl-cancel').addEventListener('click', function () { if (!dl || !dl.busy) closeDialog(); });
  $('adm-dialog').addEventListener('cancel', function (e) { if (dl && dl.busy) e.preventDefault(); });
  $('adm-dialog').addEventListener('close', function () {
    if (dl && dl.from && dl.from.focus && document.contains(dl.from)) dl.from.focus();
    dl = null;
  });
  function markField(id, msg) {
    var el = $(id), err = $('err-' + id);
    if (el) el.setAttribute('aria-invalid', String(!!msg));
    if (err) { err.textContent = msg || ''; err.hidden = !msg; }
    if (el && msg) el.setAttribute('aria-describedby', 'err-' + id);
  }
  function dialogError(text) {
    var box = $('dl-err');
    box.textContent = text;
    box.hidden = false;
    box.focus();
  }
  $('dl-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!dl || dl.busy) return;
    var o = dl.o, state = dl;
    Array.prototype.forEach.call($('dl-body').querySelectorAll('[aria-invalid="true"]'), function (el) { markField(el.id, ''); });
    $('dl-err').hidden = true;
    var bad = o.check && o.check();
    if (bad) { markField(bad[0], bad[1]); $(bad[0]).focus(); return; }
    state.busy = true;
    var ok = $('dl-ok'), label = ok.textContent;
    ok.disabled = true; ok.setAttribute('aria-busy', 'true'); ok.textContent = 'Saving…';
    var release = function () { state.busy = false; ok.disabled = false; ok.removeAttribute('aria-busy'); ok.textContent = label; };
    o.send(state.key).then(function (res) {
      release();
      if (dl !== state) return;
      if (res.ok) { closeDialog(); if (o.done) o.done(res); return; }
      if (res.status === 401) return sessionEnded(res);
      var msg = res.body && res.body.error && res.body.error.message;
      if (res.status === 422 && res.body && res.body.errors && o.fieldFor) {
        var first = null;
        Object.keys(res.body.errors).forEach(function (k) {
          var id = o.fieldFor[k];
          if (id) { markField(id, String(res.body.errors[k])); first = first || id; }
        });
        if (first) { $(first).focus(); return; }
      }
      if (res.status === 409) {
        // Someone, or something, changed it first. Show why, and refresh
        // what is on screen; this change is not sent again.
        state.key = API.newKey();
        dialogError((msg || 'This was changed in the meantime.') + ' The list has been refreshed.');
        refresh();
        return;
      }
      if (res.status === 403) return dialogError('You do not have permission to do this.');
      if (res.status === 429) return dialogError('Too many changes in a short time. Wait a moment and try again.');
      dialogError((msg ? msg + ' ' : '') + 'Nothing was changed. Try again; it is safe to press it again.');
    }, function (err) {
      release();
      if (dl !== state) return;
      dialogError(err && err.name === 'AbortError'
        ? 'The server did not answer in time, so this may or may not have gone through. Press it again to make sure; it will not be done twice.'
        : 'Could not reach the server. Nothing was changed. Check the connection and try again.');
    });
  });

  $('adm-signout').addEventListener('click', function () { clearData(); });

  start();
})();
