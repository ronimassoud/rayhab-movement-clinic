/* Rayhab, four-step booking request.
   Logic transcribed from the canvas component in "Rayhab UI.dc.html" §04,
   then connected to the booking API.

   No account, no payment. The form produces a *request*; the clinic
   reviews it, and once it is approved the patient gets a WhatsApp message
   with a secure link to choose how to pay (payment/index.html).

   It talks to the booking API through api/client.js (contracts in
   README.md, "Launch and backend handoff"):
     GET  {api}/services                       the catalog: names, durations, prices
     GET  {api}/availability?service_id=&practitioner_id=&mode=&date=
     POST {api}/appointments                   the request itself
   Success is shown only when the server answers 2xx with status
   "requested". Anything else, including no endpoint at all, is an honest
   failure with a retry and a WhatsApp fallback; nothing is ever faked.

   Dates are Beirut calendar days ('yyyy-mm-dd') and times are Beirut wall
   times, through api/time.js, so a visitor abroad sees the clinic's days
   and its real GMT offset, summer or winter. */
(function () {
  'use strict';

  var T = window.RayhabTime;
  var API = window.RayhabAPI;
  var L = window.RayhabLabels;

  /* Mounts the flow onto a given #booking root. Exposed so the modal can
     mount a freshly fetched copy; the standalone page mounts on load. */
  function mountBooking(root, opts) {
    if (!root || root.dataset.mounted || !T) return;
    root.dataset.mounted = '1';
    opts = opts || {};

  /* ---------- Catalog ----------
     The built-in list is what the page offers when the catalog cannot be
     loaded; the server's list replaces it when it can, and only the
     server's list carries prices. */
  var TYPES = [
    { id: 'assessment', name: 'Scoliosis assessment', duration_min: 60, tag: 'Start here',
      description: 'First visit. Three-dimensional assessment, movement screen, and the first version of your plan.' },
    { id: 'follow', name: 'Scoliosis rehabilitation session', duration_min: 45, tag: '',
      description: 'Coached corrective exercise and progression. For existing patients.' },
    { id: 'online', name: 'Online scoliosis consultation', duration_min: 40, tag: '', modes: ['online'],
      description: 'Imaging review, exercise guidance and a remote plan. For patients outside Lebanon.' },
    { id: 'sports', name: 'Sports or general physiotherapy', duration_min: 45, tag: '',
      description: 'Injury rehabilitation, return to sport, mobility and joint training.' },
    { id: 'pain', name: 'Pain management assessment', duration_min: 60, tag: '',
      description: 'Persistent or recurring pain: a full assessment, a clear explanation and a graded plan.' },
    { id: 'pain-follow', name: 'Pain management follow-up', duration_min: 45, tag: '',
      description: 'Coached graded activity, progression and updates to your home program. For existing patients.' }
  ];
  var catalog = { services: TYPES, practitioners: [], live: false };

  /* ---------- Clinic calendar ----------
     The clinic's usual opening pattern, used when live availability cannot
     be loaded: closed Sunday and Wednesday; mornings and afternoons Monday,
     Tuesday, Thursday and Friday; Saturday mornings only. */
  var CLOSED_DOW = [0, 3];
  var HOURS = {
    1: [['09:00', '12:00'], ['15:00', '18:00']],
    2: [['09:00', '12:00'], ['15:00', '18:00']],
    4: [['09:00', '12:00'], ['15:00', '18:00']],
    5: [['09:00', '12:00'], ['15:00', '18:00']],
    6: [['09:00', '13:00']]
  };
  var LEAD_DAYS = 1;   // the clinic confirms within one working day
  var HORIZON = 90;    // how far ahead a request can be made
  var WINDOW = 6;      // days visible at once
  var CLINIC_WA = '96171383315';
  // Changes whenever the wording of either consent line changes, so the
  // server can store which wording each patient agreed to.
  var CONSENT_VERSION = '2026-10-15';

  var DOW = T.DOW, DOW_FULL = T.DOW_FULL, MON = T.MON, MON_FULL = T.MON_FULL;

  function firstBookable() { return T.addDays(T.today(), LEAD_DAYS); }
  function lastBookable() { return T.addDays(T.today(), HORIZON); }
  function isOpen(d) { return CLOSED_DOW.indexOf(T.dow(d)) < 0; }

  var openedAt = Date.now();

  /* ---------- State ---------- */
  var st = freshState();
  function freshState() {
    return {
      step: 1, forWhom: 'me', type: 'assessment', practitioner: '', mode: 'clinic',
      winStart: 0, date: null, slot: null, blurred: {},
      first: '', last: '', email: '', cc: '+961', phone: '', note: '',
      consent: false, consentWa: false,
      touched: false, loading: false, done: false, reference: '',
      sendError: '',      // '' | 'network' | 'timeout' | 'server' | 'busy' | 'unavailable'
      serverErr: {},      // field selector -> message, from a 422
      slotMsg: ''         // shown in step 2 when the chosen time went meanwhile
    };
  }

  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  /* ---------- Derived ---------- */
  function currentType() {
    var list = catalog.services;
    return list.filter(function (t) { return t.id === st.type; })[0] || list[0];
  }
  function modesFor(t) { return t.modes && t.modes.length ? t.modes : ['clinic', 'online']; }
  function isOnline() { return st.mode === 'online'; }
  function durLabel(t) { return t.duration_min + ' min'; }
  function priceLabel(t) { return t.price && L ? L.money(t.price.amount, t.price.currency) : ''; }
  function practitionerName(id) {
    var p = catalog.practitioners.filter(function (x) { return x.id === id; })[0];
    return p ? p.name : '';
  }
  function choosesPractitioner() { return catalog.practitioners.length > 1; }

  /* Field rules. Each returns an error string, or '' when the value is
     acceptable, so the message and the validity come from one place. */
  function nameErr(v, what) {
    v = v.trim();
    if (!v) return 'Enter your ' + what + '.';
    if (v.length < 2) return 'That looks too short.';
    if (!/[A-Za-zÀ-ɏ؀-ۿ]/.test(v)) return 'Use letters for your ' + what + '.';
    return '';
  }
  function emailErr() {
    var v = st.email.trim();
    if (!v) return '';   // optional: the clinic answers on WhatsApp
    // One @, something either side, a dot in the domain, no spaces.
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v)) return 'Check the email address.';
    return '';
  }
  /* The number in international form, +96171383315, or '' when it cannot
     be one. With a country chosen, a leading 0 of the local form is
     dropped (03 123 456 in Lebanon is +961 3 123 456). With "Other", the
     patient types the whole number, starting with + or 00. */
  function e164() {
    var v = st.phone.trim();
    if (!v || /[^0-9+()\-\s.]/.test(v)) return '';
    if (st.cc === 'other' || /^(\+|00)/.test(v)) {
      var all = v.replace(/^00/, '+').replace(/[^\d+]/g, '');
      return /^\+\d{8,15}$/.test(all) ? all : '';
    }
    var nat = v.replace(/\D/g, '').replace(/^0+/, '');
    var full = st.cc + nat;
    return nat.length >= 6 && full.replace(/\D/g, '').length <= 15 ? full : '';
  }
  function phoneErr() {
    var v = st.phone.trim();
    if (!v) return 'Enter a WhatsApp number the clinic can reach you on.';
    if (/[^0-9+()\-\s.]/.test(v)) return 'Use digits, spaces, + or ( ) only.';
    if (st.cc === 'other' && !/^(\+|00)/.test(v)) return 'Start with + and the country code.';
    var digits = v.replace(/\D/g, '');
    if (digits.length < 6) return 'That number looks too short.';
    if (!e164()) return 'That number looks too long.';
    return '';
  }
  function fieldErrors() {
    // The browser's checks first; then anything the server rejected (422),
    // until that field is edited again.
    var se = st.serverErr || {};
    return {
      '#f-first': nameErr(st.first, 'first name') || se['#f-first'] || '',
      '#f-last': nameErr(st.last, 'last name') || se['#f-last'] || '',
      '#f-phone': phoneErr() || se['#f-phone'] || '',
      '#f-email': emailErr() || se['#f-email'] || ''
    };
  }
  function detailsOk() {
    var e = fieldErrors();
    for (var k in e) { if (e[k]) return false; }
    return st.consent && st.consentWa;
  }
  function canNext() {
    if (st.step === 1) return !!st.type;
    if (st.step === 2) return !!st.slot;
    if (st.step === 3) return detailsOk();
    return true;
  }
  function visibleDays() {
    var out = [], from = T.addDays(firstBookable(), st.winStart);
    for (var i = 0; i < WINDOW; i++) out.push(T.addDays(from, i));
    return out;
  }
  function whenLabel() {
    if (!st.slot || !st.date) return 'Not chosen yet';
    return T.dayLabel(st.date) + ' · ' + st.slot;
  }
  function whereLabel() {
    return isOnline() ? 'Online, video call' : 'Rayhab Movement Clinic, Beirut';
  }
  function yourTime() {
    return st.slot && st.date ? T.localHint(st.date, st.slot) : '';
  }

  /* ---------- Talking to the booking API ---------- */
  var live = !!(API && API.available());

  function loadCatalog() {
    if (!live || !API.availability) return;
    API.availability.services().then(function (res) {
      var b = res.ok && res.body;
      if (!b || !Array.isArray(b.services) || !b.services.length) return;
      catalog.services = b.services;
      catalog.practitioners = Array.isArray(b.practitioners) ? b.practitioners : [];
      catalog.live = true;
      if (!catalog.services.some(function (t) { return t.id === st.type; })) st.type = catalog.services[0].id;
      fitMode();
      renderTypes();
      render();
    }, function () { /* the built-in list stays */ });
  }

  /* Which times are free comes from the practice calendar. Until it
     answers the day shows placeholders that cannot be picked; if it cannot
     be reached, the clinic's opening pattern is shown and every time is a
     request the clinic confirms, and a note under the days says which. */
  var avail = {};   // key -> 'loading' | 'failed' | [{ time, available }]
  function availKey(date) { return [st.type, st.practitioner, st.mode, date].join('|'); }
  function loadAvailability(date) {
    if (!date || !isOpen(date)) return;
    var key = availKey(date);
    if (avail[key]) return;
    if (!live || !API.availability) { avail[key] = 'failed'; return; }
    avail[key] = 'loading';
    API.availability.slots({ service_id: st.type, practitioner_id: st.practitioner, mode: st.mode, date: date })
      .then(function (res) {
        var slots = res.ok && res.body && res.body.slots;
        avail[key] = Array.isArray(slots) ? slots : 'failed';
        if (st.step === 2 || st.date === date) render();
      }, function () {
        avail[key] = 'failed';
        if (st.step === 2 || st.date === date) render();
      });
  }
  function dayState(d) {
    if (!isOpen(d)) return 'closed';
    var a = avail[availKey(d)];
    if (Array.isArray(a) && !a.some(function (s) { return s.available; })) return 'full';
    return 'open';
  }

  function slotsFor(date, mins) {
    if (!date || !isOpen(date)) return [];
    var got = avail[availKey(date)];
    if (got === 'loading') return 'loading';
    if (Array.isArray(got)) {
      return got.map(function (s) { return { label: s.time, taken: !s.available }; });
    }
    var out = [];
    (HOURS[T.dow(date)] || []).forEach(function (b) {
      var t = T.toMin(b[0]), end = T.toMin(b[1]);
      while (t + mins <= end) {
        out.push({ label: T.fromMin(t), taken: false });
        t += mins;
      }
    });
    return out;
  }

  // The next day after `date` that is open and not known to be full.
  function nextFreeFrom(date) {
    var d = date, limit = lastBookable();
    for (var i = 0; i < 21 && d <= limit; i++) {
      if (dayState(d) === 'open') return d;
      d = T.addDays(d, 1);
    }
    return null;
  }

  function fitMode() {
    var modes = modesFor(currentType());
    if (modes.indexOf(st.mode) < 0) st.mode = modes[0];
  }

  /* ---------- Renderers ---------- */
  var M_TITLES = ['What do you need?', 'When suits you?', 'Your details', 'Check and confirm'];

  function renderMobileHead() {
    // The 390 mockup replaces the rail with a progress bar and the
    // current step's title, so keep both in sync with `st`.
    var rail = root.querySelector('#bk-rail');
    if (rail) rail.classList.toggle('is-done', st.done);
    var segs = $$('#bk-progress span');
    segs.forEach(function (el, i) {
      el.classList.toggle('on', st.done || i < st.step);
    });
    var eb = $('#bk-meyebrow'), ti = $('#bk-mtitle'), bk = $('#bk-mback');
    if (eb) eb.textContent = 'Step ' + st.step + ' of 4';
    if (ti) ti.textContent = M_TITLES[st.step - 1] || '';
    if (bk) bk.hidden = st.step === 1 || st.done;
    var dw = $('#m-doneWhen');
    if (dw) dw.textContent = whenLabel() + (isOnline() ? ', online.' : ' at the Beirut clinic.') +
      ' The clinic replies by WhatsApp within one working day.';
  }

  /* ---- Stepper ----
     After React Bits' Stepper. A tile glides along the track to the current
     step on a spring; a finished step shows a tick that draws itself; and
     when the four titles no longer fit beside their badges, only the
     current one keeps its title. */
  var SPRING = 'linear(0, 0.0603, 0.2033, 0.3821, 0.5633, 0.7258, 0.8584, 0.9574, 1.0242, 1.0634, 1.0809, 1.0828, 1.0747, 1.0613, 1.046, 1.0313, 1.0186, 1.0085, 1.0012, 0.9965, 0.994, 0.9931, 0.9933, 0.9941, 0.9953, 0.9966, 0.9978, 0.9988, 1)';
  var spring = (window.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)'))
    ? SPRING : 'cubic-bezier(0.34, 1.4, 0.64, 1)';
  var stillMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var still = function () { return !!(stillMq && stillMq.matches); };
  var TICK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';
  var wasComplete = [false, false, false, false];
  var gliderPlaced = false;
  var titleWidths = null;

  function placeGlider(animate) {
    var track = $('#bk-track'), glider = $('#bk-glider');
    if (!track || !glider) return;
    var seg = $('#st' + Math.min(st.step, 4));
    if (!seg) return;
    glider.style.transition = animate
      ? 'transform 560ms ' + spring + ', width 560ms ' + spring + ', height 560ms ' + spring + ', opacity 200ms ease'
      : 'opacity 200ms ease';
    glider.style.transform = 'translate3d(' + seg.offsetLeft + 'px,' + seg.offsetTop + 'px,0)';
    glider.style.width = seg.offsetWidth + 'px';
    glider.style.height = seg.offsetHeight + 'px';
    glider.style.opacity = st.done ? '0' : '1';
  }

  // Tight when the badges and every title would not fit the track.
  function fitTitles() {
    var track = $('#bk-track');
    if (!track || !track.clientWidth) return;
    if (!titleWidths) {
      track.classList.remove('is-tight');
      titleWidths = [1, 2, 3, 4].map(function (n) { return $('#lbl' + n).scrollWidth + 8; });
    }
    var badges = [1, 2, 3, 4].reduce(function (s, n) { return s + $('#dot' + n).getBoundingClientRect().width + 20; }, 0);
    var titles = titleWidths.reduce(function (s, w) { return s + w; }, 0);
    track.classList.toggle('is-tight', badges + titles > track.clientWidth - 8 - 12);
  }

  function renderProgress() {
    renderMobileHead();
    [1, 2, 3, 4].forEach(function (n) {
      var seg = $('#st' + n), dot = $('#dot' + n), lbl = $('#lbl' + n);
      var complete = st.done || st.step > n;
      var current = st.step === n && !st.done;
      var status = complete ? 'complete' : current ? 'active' : 'upcoming';
      seg.setAttribute('data-status', status);
      dot.setAttribute('data-status', status);
      lbl.setAttribute('data-status', status);
      if (complete && !wasComplete[n - 1]) {
        dot.innerHTML = TICK_SVG;
        var path = dot.querySelector('path');
        if (path && path.animate && !still()) {
          path.style.strokeDasharray = '24';
          path.animate([{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }],
                       { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
        }
      } else if (!complete && wasComplete[n - 1]) {
        dot.textContent = String(n);
      }
      wasComplete[n - 1] = complete;
      // A finished step is a way back to it; the current and later ones are not.
      seg.disabled = !complete || st.done || st.loading;
      if (current) seg.setAttribute('aria-current', 'step');
      else seg.removeAttribute('aria-current');
      seg.setAttribute('aria-label', 'Step ' + n + ': ' + lbl.textContent +
        (complete ? ', done. Go back to this step' : current ? ', current step' : ''));
    });
    fitTitles();
    placeGlider(gliderPlaced && !still());
    gliderPlaced = true;
  }

  /* The step content slides in from the side it is coming from and fades
     up, like the component's panes. Transform and opacity only, so nothing
     reflows while it moves. */
  var shownPane = null, shownStep = 0;
  function animatePane() {
    var pane = st.loading ? $('#bk-loading') : st.done ? $('#bk-done') : $('#step' + st.step);
    if (!pane || pane === shownPane) return;
    var dir = (st.done || st.loading || st.step >= shownStep) ? 1 : -1;
    var first = !shownPane;
    shownPane = pane; shownStep = st.step;
    if (first || !pane.animate || still()) return;
    pane.getAnimations().forEach(function (an) { an.cancel(); });
    pane.animate([{ transform: 'translateX(' + (dir * 36) + 'px)' }, { transform: 'none' }],
                 { duration: 560, easing: spring });
    pane.animate([{ opacity: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1 }],
                 { duration: 420, easing: 'ease-out' });
  }

  if (window.ResizeObserver) {
    var track0 = $('#bk-track');
    if (track0) new ResizeObserver(function () { fitTitles(); placeGlider(false); }).observe(track0);
  }

  /* ---- Service list ----
     Written from the catalog, so a renamed service, a new price or a new
     service on the server reaches the page without an edit here. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function renderTypes() {
    var list = $('.bk-typelist');
    if (!list) return;
    list.innerHTML = catalog.services.map(function (t) {
      var on = t.id === st.type;
      var meta = durLabel(t) + (priceLabel(t) ? ' · ' + priceLabel(t) : '');
      return '<div class="bk-type' + (on ? ' is-on' : '') + '" data-type="' + esc(t.id) + '" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '">' +
        '<span class="bk-radio" aria-hidden="true"></span><span>' +
        '<span class="bk-typetop"><span class="bk-typename">' + esc(t.name) + '</span>' +
        (t.tag ? '<span class="tag-start">' + esc(t.tag) + '</span>' : '') + '</span>' +
        '<span class="bk-typedesc">' + esc(t.description) + '</span>' +
        '<span class="bk-typemeta">' + esc(meta) + '</span></span></div>';
    }).join('');

    var wrap = $('#bk-pracwrap'), sel = $('#bk-prac');
    if (wrap && sel) {
      wrap.hidden = !choosesPractitioner();
      if (choosesPractitioner()) {
        sel.innerHTML = '<option value="">Any practitioner</option>' + catalog.practitioners.map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (p.id === st.practitioner ? ' selected' : '') + '>' + esc(p.name) + '</option>';
        }).join('');
      }
    }
  }

  function renderDays() {
    var wrapEl = $('#bk-days');
    wrapEl.innerHTML = '';
    var days = visibleDays();
    // Ask about the whole visible week once the patient is choosing a day,
    // so a day with nothing left can be shown as such before it is tapped.
    if (st.step >= 2) days.forEach(loadAvailability);

    // Month heading spans the visible window, which can straddle a month.
    var a = T.dayParts(days[0]), z = T.dayParts(days[days.length - 1]);
    var label = a.month === z.month
      ? MON_FULL[a.month] + ' ' + a.year
      : MON[a.month] + ' – ' + MON[z.month] + ' ' + z.year;
    var monthEl = $('#bk-month');
    if (monthEl) monthEl.textContent = label;

    var prev = $('#bk-prev'), fwd = $('#bk-fwd');
    if (prev) prev.disabled = st.winStart === 0;
    if (fwd) fwd.disabled = T.addDays(firstBookable(), st.winStart + WINDOW) > lastBookable();

    days.forEach(function (d) {
      var state = dayState(d);
      var selected = st.date === d;
      var p = T.dayParts(d);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bk-day' + (selected ? ' is-active' : '') + (state === 'closed' ? ' is-closed' : '') + (state === 'full' ? ' is-full' : '');
      b.setAttribute('aria-pressed', String(!!selected));
      // A day with nothing to choose cannot be chosen; it stays in the row
      // so the week still reads as a week.
      b.disabled = state !== 'open' && !selected;
      b.innerHTML =
        '<span class="bk-dow">' + DOW[p.dow] + '</span>' +
        '<span class="bk-num">' + p.date + '</span>' +
        '<span class="bk-availdot" aria-hidden="true"></span>';
      b.setAttribute('aria-label', T.dayLabel(d, true) +
        (state === 'closed' ? ', closed' : state === 'full' ? ', no times left' : ''));
      b.addEventListener('click', function () {
        st.date = d; st.slot = null; st.slotMsg = ''; render();
      });
      wrapEl.appendChild(b);
    });
  }

  function renderAvailNote() {
    var note = $('#bk-availnote');
    if (!note) return;
    var got = st.date ? avail[availKey(st.date)] : null;
    var text = st.slotMsg ||
      (got === 'failed' ? 'Live availability could not be loaded, so these are the clinic’s usual hours. The time you pick is a request the clinic confirms.' : '');
    var t = note.querySelector('.bk-availnote-t');
    (t || note).textContent = text;
    note.hidden = !text;
    note.classList.toggle('is-warn', !!st.slotMsg);
    var refresh = $('#bk-refresh');
    if (refresh) refresh.hidden = !(st.slotMsg || got === 'failed');
  }

  function renderSlots() {
    var grid = $('#bk-slots');
    var none = $('#bk-noslots');
    var day = st.date;
    if (day) loadAvailability(day);
    renderAvailNote();
    var list = day ? slotsFor(day, currentType().duration_min) : [];
    var loading = list === 'loading';
    var free = !loading && list.some(function (s) { return !s.taken; });
    var showGrid = loading || free;

    $('#bk-slotwrap').hidden = !showGrid;
    none.hidden = showGrid;
    grid.setAttribute('aria-busy', String(loading));

    var lbl = $('#bk-slotlabel');
    if (lbl && day) {
      lbl.textContent = (loading ? 'Checking the clinic calendar' : 'Available times') +
        ' · Beirut time (' + T.offsetLabel(day, '12:00') + ')';
    }
    var hint = $('#bk-yourtime');
    if (hint) {
      var y = yourTime();
      hint.textContent = y ? 'That is ' + y + ' where you are.' : '';
      hint.hidden = !y;
    }

    if (loading) {
      // Placeholders the size of the times, so the grid does not jump when
      // they arrive, and nothing to pick before the calendar has answered.
      grid.innerHTML = '';
      for (var i = 0; i < 8; i++) {
        var sk = document.createElement('span');
        sk.className = 'slot-skel';
        sk.setAttribute('aria-hidden', 'true');
        grid.appendChild(sk);
      }
      return;
    }

    if (!free) {
      grid.innerHTML = '';
      var nxt = day ? nextFreeFrom(T.addDays(day, 1)) : nextFreeFrom(firstBookable());
      var t = $('#bk-noslots-t'), d2 = $('#bk-noslots-d'), jump = $('#bk-jump');
      if (t) t.textContent = !day ? 'Pick a day to see times'
        : isOpen(day) ? 'No times left on ' + DOW_FULL[T.dow(day)]
        : 'Closed on ' + DOW_FULL[T.dow(day)];
      if (d2) d2.textContent = nxt
        ? (day && isOpen(day) ? 'Every time that day has been requested. ' : 'The clinic is closed that day. ') +
          'The next day with times is ' + T.dayLabel(nxt, true) + '.'
        : 'Choose another day from the row above, or move to later dates.';
      if (jump) {
        jump.hidden = !nxt;
        if (nxt) jump.textContent = 'Jump to ' + DOW_FULL[T.dow(nxt)];
        jump.onclick = nxt ? function () {
          var off = T.daysBetween(firstBookable(), nxt);
          st.winStart = Math.max(0, Math.min(off, off - WINDOW + 1));
          st.date = nxt; st.slot = null; render();
        } : null;
      }
      return;
    }

    // A time the calendar now reports as taken cannot stay selected.
    if (st.slot && !list.some(function (s) { return s.label === st.slot && !s.taken; })) st.slot = null;

    grid.innerHTML = '';
    list.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot-btn';
      b.textContent = s.label;
      b.setAttribute('aria-pressed', String(st.slot === s.label));
      if (s.taken) {
        b.disabled = true;
        b.setAttribute('aria-label', s.label + ', already requested');
      } else {
        b.addEventListener('click', function () { st.slot = s.label; st.slotMsg = ''; render(); });
      }
      grid.appendChild(b);
    });
  }

  function renderSummary() {
    var t = currentType();
    var price = priceLabel(t);
    $('#sumType').textContent = t.name;
    $('#sumDur').textContent = durLabel(t);
    $('#sumWho').textContent = st.forWhom === 'me' ? 'For myself' : 'For my child';
    $('#sumWhen').textContent = whenLabel();
    $('#sumWhere').textContent = whereLabel();
    var pr = $('#sumPriceRow');
    if (pr) { pr.hidden = !price; $('#sumPrice').textContent = price; }
    var wr = $('#sumWithRow');
    if (wr) { wr.hidden = !(choosesPractitioner() && st.practitioner); $('#sumWith').textContent = practitionerName(st.practitioner); }

    $('#rvType').textContent = t.name + ' · ' + durLabel(t) + (price ? ' · ' + price : '') +
      (choosesPractitioner() ? ' · ' + (practitionerName(st.practitioner) || 'Any practitioner') : '');
    var y = yourTime();
    $('#rvWhen').textContent = whenLabel() + (st.slot ? ' (Beirut time' + (y ? '; ' + y + ' your time' : '') + ')' : '');
    $('#rvWhere').textContent = whereLabel();
    $('#rvName').textContent =
      ((st.first + ' ' + st.last).trim() || 'Not entered yet') +
      ' · ' + (st.forWhom === 'me' ? 'For myself' : 'For my child');
    var phone = e164();
    var shown = phone && st.cc !== 'other' && phone.indexOf(st.cc) === 0 ? st.cc + ' ' + phone.slice(st.cc.length) : phone;
    $('#rvContact').textContent = phone
      ? 'WhatsApp ' + shown + (st.email.trim() ? ' · ' + st.email.trim() : '')
      : 'Not entered yet';
    $('#doneWhen').textContent = whenLabel();
    var dt = $('#doneType'), dwh = $('#doneWhere'), dr = $('#doneRef');
    if (dt) dt.textContent = t.name + ' (' + durLabel(t) + ')';
    if (dwh) dwh.textContent = isOnline() ? 'as an online video call' : 'at the Beirut clinic';
    if (dr) { dr.hidden = !st.reference; dr.querySelector('strong').textContent = st.reference; }
  }

  /* The step 4 failure panel: what went wrong, in plain words, with a retry
     and a WhatsApp fallback that carries the request but none of the
     patient's personal details. */
  var SEND_COPY = {
    network: ['Your request didn’t reach the clinic, so nothing has been booked yet.',
              'Check your connection and try again. Your details are still here.'],
    timeout: ['The clinic didn’t answer in time, so the request may not have arrived.',
              'Try again in a moment. If it keeps happening, send it on WhatsApp instead.'],
    server: ['Something went wrong on the clinic’s side, so nothing has been booked yet.',
             'Try again in a moment, or send the request on WhatsApp instead.'],
    busy: ['Too many requests were sent from here in a short time.',
           'Wait a minute and try again, or send the request on WhatsApp instead.'],
    unavailable: ['Online booking requests aren’t available right now, so nothing has been booked yet.',
                  'Send the request on WhatsApp instead and the clinic will confirm it there.']
  };
  function renderSendError() {
    var box = $('#bk-senderr');
    if (!box) return;
    var copy = SEND_COPY[st.sendError];
    box.hidden = !copy || st.step !== 4;
    if (!copy) return;
    $('#bk-senderr-t').textContent = copy[0];
    $('#bk-senderr-d').textContent = copy[1];
    var retry = $('#bk-retry');
    if (retry) retry.hidden = st.sendError === 'unavailable';
    var wa = $('#bk-wa');
    if (wa) {
      var t = currentType();
      var msg = 'Hello, I would like to request a ' + t.name + ' (' + durLabel(t) + ')' +
                (st.slot ? ' on ' + whenLabel() : '') + ', ' + (isOnline() ? 'online' : 'at the Beirut clinic') + '.';
      wa.href = 'https://wa.me/' + CLINIC_WA + '?text=' + encodeURIComponent(msg);
    }
  }

  function renderConsent(sel, on) {
    var el = $(sel);
    if (!el) return;
    el.setAttribute('aria-checked', String(on));
    el.classList.toggle('is-on', on);
  }

  function renderValidation() {
    var errs = fieldErrors();
    Object.keys(errs).forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      // A field is only marked once it has been left, or once Continue has
      // been pressed, so nobody is told they are wrong mid-typing.
      var show = (st.touched || st.blurred[sel]) && !!errs[sel];
      el.setAttribute('aria-invalid', String(show));
      var msg = $('#err-' + el.id);
      if (msg) {
        msg.textContent = show ? errs[sel] : '';
        msg.hidden = !show;
      }
    });
    renderConsent('#bk-consent', st.consent);
    renderConsent('#bk-consent-wa', st.consentWa);
    $('#bk-detailerr').hidden = !(st.touched && !detailsOk());
    var phone = $('#f-phone');
    if (phone) phone.placeholder = st.cc === 'other' ? '+ country code and number' : st.cc === '+961' ? '3 123 456' : 'Number';
  }

  function render() {
    // A failed send belongs to step 4; leaving it clears the message.
    if (st.step !== 4 && !st.loading) st.sendError = '';
    // Step panels
    [1, 2, 3, 4].forEach(function (n) {
      $('#step' + n).hidden = !(st.step === n && !st.done && !st.loading);
    });
    $('#bk-loading').hidden = !st.loading;
    $('#bk-done').hidden = !st.done;
    $('#bk-actions').hidden = st.done || st.loading;
    $('#bk-aside').hidden = st.done;

    // Type radios
    $$('.bk-type').forEach(function (el) {
      var on = el.dataset.type === st.type;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-checked', String(on));
      el.tabIndex = on ? 0 : -1;
    });

    // Toggles. A service offered one way only switches the other off.
    var modes = modesFor(currentType());
    $('#who-me').setAttribute('aria-pressed', String(st.forWhom === 'me'));
    $('#who-child').setAttribute('aria-pressed', String(st.forWhom === 'child'));
    $('#mode-clinic').setAttribute('aria-pressed', String(st.mode === 'clinic'));
    $('#mode-online').setAttribute('aria-pressed', String(st.mode === 'online'));
    $('#mode-clinic').disabled = modes.indexOf('clinic') < 0;
    $('#mode-online').disabled = modes.indexOf('online') < 0;

    renderProgress();
    animatePane();
    renderDays();
    renderSlots();
    renderSummary();
    renderValidation();
    renderSendError();

    // Footer actions
    var back = $('#bk-back');
    back.hidden = !(st.step > 1);
    var next = $('#bk-next');
    var last = st.step === 4;
    var nextLabel = next.querySelector('.bk-nextlabel') || next;
    nextLabel.textContent = last ? 'Request appointment' : st.step === 3 ? 'Review request' : 'Continue';
    next.classList.toggle('is-last', last);
    var ok = canNext();
    next.classList.toggle('btn-primary', ok);
    next.classList.toggle('btn-disabled', !ok);
    // Step 3 stays clickable so pressing it can surface validation.
    next.disabled = (!ok && st.step !== 3) || st.loading;

    var hint = $('#bk-hint');
    // Once a time is chosen the action bar has nothing to add: the panel's
    // own .bk-hold line already explains what happens next, and repeating
    // it right underneath read as a stutter.
    hint.textContent = st.step === 2 && !st.slot ? 'Pick a time to continue.' : '';
  }

  /* ---------- Wiring ---------- */
  function pickType(id) {
    st.type = id;
    st.slot = null;
    fitMode();
    render();
  }
  // Delegated, because the list is rewritten when the catalog arrives.
  var typeList = $('.bk-typelist');
  typeList.addEventListener('click', function (e) {
    var el = e.target.closest('.bk-type');
    if (el) pickType(el.dataset.type);
  });
  typeList.addEventListener('keydown', function (e) {
    var el = e.target.closest('.bk-type');
    if (!el) return;
    var all = $$('.bk-type'), i = all.indexOf(el), to = null;
    // Radiogroup keyboard contract: arrows move and select, Space/Enter select.
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = (i + 1) % all.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = (i - 1 + all.length) % all.length;
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pickType(el.dataset.type); return; }
    if (to !== null) {
      e.preventDefault();
      pickType(all[to].dataset.type);
      $$('.bk-type')[to].focus();
    }
  });

  var prac = $('#bk-prac');
  if (prac) prac.addEventListener('change', function () { st.practitioner = prac.value; st.slot = null; render(); });

  var prevBtn = $('#bk-prev'), fwdBtn = $('#bk-fwd');
  if (prevBtn) prevBtn.addEventListener('click', function () {
    st.winStart = Math.max(0, st.winStart - WINDOW); render();
  });
  if (fwdBtn) fwdBtn.addEventListener('click', function () {
    st.winStart += WINDOW; render();
  });

  $('#who-me').addEventListener('click', function () { st.forWhom = 'me'; render(); });
  $('#who-child').addEventListener('click', function () { st.forWhom = 'child'; render(); });
  $('#mode-clinic').addEventListener('click', function () { st.mode = 'clinic'; st.slot = null; render(); });
  $('#mode-online').addEventListener('click', function () { st.mode = 'online'; st.slot = null; render(); });

  // "Refresh times": forget what was loaded for the visible days and ask again.
  var refreshBtn = $('#bk-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function () {
    visibleDays().forEach(function (d) { delete avail[availKey(d)]; });
    st.slotMsg = '';
    render();
  });

  [['#f-first', 'first'], ['#f-last', 'last'], ['#f-email', 'email'],
   ['#f-phone', 'phone'], ['#f-note', 'note']].forEach(function (p) {
    var el = $(p[0]);
    el.addEventListener('input', function (e) {
      st[p[1]] = e.target.value;
      if (st.serverErr && st.serverErr[p[0]]) delete st.serverErr[p[0]];
      renderValidation();
      var n = $('#bk-next');
      var ok = canNext();
      n.classList.toggle('btn-primary', ok);
      n.classList.toggle('btn-disabled', !ok);
    });
    // Nobody is told they are wrong while still typing: a field is only
    // marked once they leave it, or once Continue is pressed.
    el.addEventListener('blur', function () {
      st.blurred[p[0]] = true;
      renderValidation();
    });
  });
  var cc = $('#f-cc');
  if (cc) cc.addEventListener('change', function () {
    st.cc = cc.value;
    if (st.serverErr['#f-phone']) delete st.serverErr['#f-phone'];
    renderValidation();
  });

  [['#bk-consent', 'consent'], ['#bk-consent-wa', 'consentWa']].forEach(function (c) {
    var el = $(c[0]);
    if (!el) return;
    el.addEventListener('click', function () { st[c[1]] = !st[c[1]]; render(); });
    el.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); st[c[1]] = !st[c[1]]; render(); }
    });
  });

  $$('.bk-edit, .bk-seg').forEach(function (b) {
    b.addEventListener('click', function () {
      st.step = parseInt(b.dataset.step, 10);
      st.done = false;
      render();
      focusStep();
    });
  });

  var mback = root.querySelector('#bk-mback');
  if (mback) mback.addEventListener('click', function () {
    st.step = Math.max(1, st.step - 1); render(); focusStep();
  });

  $('#bk-back').addEventListener('click', function () {
    st.step = Math.max(1, st.step - 1); render(); focusStep();
  });

  $('#bk-next').addEventListener('click', function () {
    if (st.step === 4) return submit();
    if (st.step === 3 && !detailsOk()) {
      st.touched = true;
      renderValidation();
      // Send focus to the first thing that needs fixing rather than
      // leaving the patient to hunt for it.
      var errs = fieldErrors();
      var firstBad = Object.keys(errs).filter(function (k) { return errs[k]; })[0];
      var target = firstBad ? $(firstBad)
        : !st.consent ? $('#bk-consent') : !st.consentWa ? $('#bk-consent-wa') : null;
      if (target) target.focus();
      return;
    }
    if (!canNext()) return;
    st.step = Math.min(4, st.step + 1);
    st.touched = false;
    render();
    focusStep();
  });

  var icsBtn = root.querySelector('#bk-ics');
  if (icsBtn) icsBtn.addEventListener('click', function () {
    // The mockup offers this on the success screen. The request is not yet
    // confirmed, so the event is written as tentative. Times are written in
    // UTC, so the event lands at the right hour in any calendar app,
    // whatever its owner's time zone.
    if (!st.slot || !st.date) return;
    var startAt = T.toUtc(st.date, st.slot);
    var endAt = startAt + currentType().duration_min * 60000;
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rayhab Movement Clinic//Booking//EN',
      'BEGIN:VEVENT', 'UID:' + (st.reference || Date.now()) + '@dr-rayhab.com',
      'DTSTAMP:' + T.icsStamp(Date.now()),
      'DTSTART:' + T.icsStamp(startAt), 'DTEND:' + T.icsStamp(endAt),
      'SUMMARY:' + currentType().name + ' - Rayhab (requested)',
      'LOCATION:' + whereLabel(),
      'STATUS:TENTATIVE',
      'DESCRIPTION:Requested appointment' + (st.reference ? ' ' + st.reference : '') +
        '. The clinic confirms by WhatsApp within one working day.',
      'END:VEVENT', 'END:VCALENDAR'
    ];
    var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rayhab-request.ics';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  $('#bk-restart').addEventListener('click', function () {
    st = freshState();
    openedAt = Date.now();
    lastSent = '';
    st.date = nextFreeFrom(firstBookable());
    ['#f-first', '#f-last', '#f-email', '#f-phone', '#f-note'].forEach(function (s) { $(s).value = ''; });
    if (cc) cc.value = '+961';
    render();
    focusStep();
  });

  function focusStep() {
    var h = st.done ? $('#bk-done h2') : $('#step' + st.step + ' h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  }

  // The fields a 422 can name, mapped to the inputs they belong to.
  var FIELD_FOR = { first_name: '#f-first', last_name: '#f-last', email: '#f-email', phone: '#f-phone' };

  function payload() {
    var hp = $('#f-website');
    return {
      service_id: st.type,
      practitioner_id: st.practitioner || null,
      for_whom: st.forWhom,
      mode: isOnline() ? 'online' : 'clinic',
      date: st.date,
      time: st.slot,
      timezone: T.TZ,
      first_name: st.first.trim(),
      last_name: st.last.trim(),
      phone: e164(),
      email: st.email.trim() || null,
      note: st.note.trim(),
      consents: { storage: !!st.consent, whatsapp: !!st.consentWa, version: CONSENT_VERSION },
      // Abuse signals, checked by the server: a field people never see,
      // and how long the form was open.
      website: hp ? hp.value : '',
      elapsed_ms: Date.now() - openedAt
    };
  }

  /* The same request, sent again after a failure, carries the same
     Idempotency-Key, so a retry after a lost answer cannot become a second
     request. Any change to what is being asked for gets a new key. */
  var lastSent = '', sendKey = '';
  function keyFor(body) {
    var sig = JSON.stringify(body, function (k, v) { return k === 'elapsed_ms' ? undefined : v; });
    if (sig !== lastSent) { lastSent = sig; sendKey = API.newKey(); }
    return sendKey;
  }

  function failSend(kind) {
    st.loading = false;
    st.sendError = kind;
    st.step = 4;
    render();
    var box = $('#bk-senderr');
    if (box) box.focus();
  }

  function backToTimes(msg) {
    visibleDays().forEach(function (d) { delete avail[availKey(d)]; });
    if (st.date) delete avail[availKey(st.date)];
    st.loading = false;
    st.slot = null;
    st.step = 2;
    st.slotMsg = msg;
    render(); focusStep();
  }

  function submit() {
    if (st.loading) return;            // one request at a time
    if (!live || !API.appointments) return failSend('unavailable');
    st.loading = true;
    st.sendError = '';
    render();
    var body = payload();
    API.appointments.create(body, keyFor(body)).then(function (res) {
      var b = res.body || {};
      if (res.ok && b.status === 'requested') {
        st.loading = false;
        st.done = true;
        st.reference = b.reference || '';
        render(); focusStep();
        return;
      }
      if (res.status === 422 && b.errors) {
        // The server's own field messages go next to the fields they name.
        st.serverErr = {};
        Object.keys(b.errors).forEach(function (k) {
          if (FIELD_FOR[k]) st.serverErr[FIELD_FOR[k]] = String(b.errors[k]);
        });
        if (b.errors.consents) { st.consent = false; st.consentWa = false; }
        st.loading = false;
        var onFields = Object.keys(st.serverErr).length || b.errors.consents;
        st.step = onFields ? 3 : 4;
        st.touched = true;
        if (st.step === 4) st.sendError = 'server';
        render();
        var first = ['#f-first', '#f-last', '#f-phone', '#f-email'].filter(function (k) { return st.serverErr[k]; })[0];
        if (first) $(first).focus(); else if (b.errors.consents) $('#bk-consent').focus(); else focusStep();
        return;
      }
      if (res.status === 409) {
        // The time went while the patient was filling in the form.
        return backToTimes('That time was just taken by someone else. Pick another and your details will be kept.');
      }
      if (res.status === 410 || res.status === 419) {
        return backToTimes('This page was open for a while, so the times have been checked again. Pick a time; your details are kept.');
      }
      if (res.status === 0 || res.status === 404 || res.status === 405 || res.status === 501) return failSend('unavailable');
      if (res.status === 429) return failSend('busy');
      failSend('server');
    }, function (err) {
      failSend(err && err.name === 'AbortError' ? 'timeout' : 'network');
    });
  }

  var retryBtn = root.querySelector('#bk-retry');
  if (retryBtn) retryBtn.addEventListener('click', submit);

    /* A link can name the service and who it is for, so arriving from
       "Book this" on a service page, or from a router card that already
       says "my child", does not ask the same question twice. Anything
       unrecognised is ignored and the default stands. */
    var wanted = opts.type || param('type');
    if (wanted && catalog.services.some(function (t) { return t.id === wanted; })) st.type = wanted;
    var who = opts.forWhom || param('for');
    if (who === 'child' || who === 'me') st.forWhom = who;
    fitMode();
    st.date = nextFreeFrom(firstBookable());

    renderTypes();
    render();
    loadCatalog();
  }

  /* Reads a query parameter from the current URL. The standalone page is
     reached by navigation, so its preselection arrives this way; inside the
     modal there is no navigation and modal.js passes opts instead. */
  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }

  window.mountBooking = mountBooking;

  // Standalone /book.html mounts itself.
  mountBooking(document.getElementById('booking'));
})();
