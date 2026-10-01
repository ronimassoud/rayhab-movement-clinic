/* Rayhab, four-step booking request.
   Logic transcribed from the canvas component in "Rayhab UI.dc.html" §04:
   same service types, same availability fixture, same validation rules.

   No account, no payment. The form produces a *request*; the clinic
   confirms out of band. Nothing is sent anywhere until a real endpoint
   is wired into submit() below. */
(function () {
  'use strict';

  /* Mounts the flow onto a given #booking root. Exposed so the modal can
     mount a freshly fetched copy; the standalone page mounts on load. */
  function mountBooking(root) {
    if (!root || root.dataset.mounted) return;
    root.dataset.mounted = '1';

  /* ---------- Fixture data ---------- */
  var TYPES = [
    { id: 'assessment', name: 'Scoliosis assessment', dur: '60 min', mins: 60,
      tag: 'Start here',
      desc: 'First visit. Three-dimensional assessment, movement screen, and the first version of your plan.' },
    { id: 'follow', name: 'Scoliosis rehabilitation session', dur: '45 min', mins: 45,
      tag: '',
      desc: 'Coached corrective exercise and progression. For existing patients.' },
    { id: 'online', name: 'Online scoliosis consultation', dur: '40 min', mins: 40,
      tag: '',
      desc: 'Imaging review, exercise guidance and a remote plan. For patients outside Lebanon.' },
    { id: 'sports', name: 'Sports or general physiotherapy', dur: '45 min', mins: 45,
      tag: '',
      desc: 'Injury rehabilitation, return to sport, mobility and joint training.' }
  ];

  /* ---------- Clinic calendar ----------
     Real dates, generated from the day the page is opened. The previous
     version listed a fixed "1-6 September" week with a hardcoded set of
     taken times: it went stale the moment the month turned, and it showed
     bookings that never existed.

     Opening pattern: closed Sunday and Wednesday; mornings and afternoons
     Monday, Tuesday, Thursday and Friday; Saturday mornings only. Times
     are Beirut local, which is what the panel tells the patient. */
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

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
                  'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = startOfDay(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a && b && a.getTime() === b.getTime(); }
  function isoDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function toMin(hhmm) {
    var q = hhmm.split(':');
    return parseInt(q[0], 10) * 60 + parseInt(q[1], 10);
  }
  function fromMin(m) { return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }

  function firstBookable() { return addDays(new Date(), LEAD_DAYS); }
  function lastBookable() { return addDays(new Date(), HORIZON); }
  function isOpen(d) { return CLOSED_DOW.indexOf(d.getDay()) < 0; }

  /* Which times are already taken needs the practice calendar behind it.
     There is no backend yet, so nothing is shown as taken: the flow makes
     a request and the clinic confirms it. Point this at the real source
     and the slot grid will grey out accordingly, no other change needed. */
  function busyTimes(/* isoDateString */) { return []; }

  function slotsFor(date, mins) {
    if (!date || !isOpen(date)) return [];
    var blocks = HOURS[date.getDay()] || [];
    var busy = busyTimes(isoDate(date));
    var out = [];
    blocks.forEach(function (b) {
      var t = toMin(b[0]), end = toMin(b[1]);
      while (t + mins <= end) {
        var label = fromMin(t);
        out.push({ label: label, taken: busy.indexOf(label) >= 0 });
        t += mins;
      }
    });
    return out;
  }

  function nextOpenFrom(date) {
    var d = startOfDay(date), limit = lastBookable();
    for (var i = 0; i < 14 && d <= limit; i++) {
      if (isOpen(d)) return d;
      d = addDays(d, 1);
    }
    return null;
  }

  /* ---------- State ---------- */
  var st = {
    step: 1, forWhom: 'me', type: 'assessment', mode: 'clinic',
    winStart: 0, date: null, slot: null, blurred: {}, blurred: {},
    first: '', last: '', email: '', phone: '', note: '', consent: false,
    touched: false, loading: false, done: false
  };

  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  /* ---------- Derived ---------- */
  function currentType() {
    return TYPES.filter(function (t) { return t.id === st.type; })[0] || TYPES[0];
  }
  function isOnline() { return st.type === 'online' || st.mode === 'online'; }
  /* Field rules. Each returns an error string, or '' when the value is
     acceptable, so the message and the validity come from one place. */
  function nameErr(v, what) {
    v = v.trim();
    if (!v) return 'Enter your ' + what + '.';
    if (v.length < 2) return 'That looks too short.';
    if (!/[A-Za-z\u00C0-\u024F\u0600-\u06FF]/.test(v)) return 'Use letters for your ' + what + '.';
    return '';
  }
  function emailErr() {
    var v = st.email.trim();
    if (!v) return 'Enter an email so the clinic can reply.';
    // One @, something either side, a dot in the domain, no spaces.
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v)) return 'Check the email address.';
    return '';
  }
  function phoneErr() {
    var v = st.phone.trim();
    if (!v) return 'Enter a number the clinic can reach you on.';
    if (/[^0-9+()\-\s]/.test(v)) return 'Use digits, spaces, + or ( ) only.';
    var digits = v.replace(/\D/g, '');
    if (digits.length < 8) return 'That number looks too short.';
    if (digits.length > 15) return 'That number looks too long.';
    return '';
  }
  function fieldErrors() {
    return {
      '#f-first': nameErr(st.first, 'first name'),
      '#f-last': nameErr(st.last, 'last name'),
      '#f-email': emailErr(),
      '#f-phone': phoneErr()
    };
  }
  function emailOk() { return !emailErr(); }
  function phoneOk() { return !phoneErr(); }
  function detailsOk() {
    var e = fieldErrors();
    for (var k in e) { if (e[k]) return false; }
    return st.consent;
  }
  function canNext() {
    if (st.step === 1) return !!st.type;
    if (st.step === 2) return !!st.slot;
    if (st.step === 3) return detailsOk();
    return true;
  }
  function visibleDays() {
    var out = [], from = addDays(firstBookable(), st.winStart);
    for (var i = 0; i < WINDOW; i++) out.push(addDays(from, i));
    return out;
  }
  function whenLabel() {
    if (!st.slot || !st.date) return 'Not chosen yet';
    var d = st.date;
    return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] +
           ' · ' + st.slot;
  }
  function whereLabel() {
    return isOnline() ? 'Online, video call' : 'Rayhab Movement Clinic, Beirut';
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
    if (dw) dw.textContent = whenLabel() + ' at the Beirut clinic. We confirm by WhatsApp within one working day.';
  }

  function renderProgress() {
    renderMobileHead();
    [1, 2, 3, 4].forEach(function (n) {
      var dot = $('#dot' + n), lbl = $('#lbl' + n);
      var complete = st.done || st.step > n;
      dot.textContent = complete ? '✓' : String(n);
      dot.className = 'bk-dot' + (complete ? ' is-done' : st.step === n ? ' is-current' : '');
      lbl.className = 'bk-steplabel' + (st.step === n && !st.done ? ' is-current' : '');
    });
  }

  function renderDays() {
    var wrapEl = $('#bk-days');
    wrapEl.innerHTML = '';
    var days = visibleDays();

    // Month heading spans the visible window, which can straddle a month.
    var a = days[0], z = days[days.length - 1];
    var label = a.getMonth() === z.getMonth()
      ? MON_FULL[a.getMonth()] + ' ' + a.getFullYear()
      : MON[a.getMonth()] + ' \u2013 ' + MON[z.getMonth()] + ' ' + z.getFullYear();
    var monthEl = $('#bk-month');
    if (monthEl) monthEl.textContent = label;

    var prev = $('#bk-prev'), fwd = $('#bk-fwd');
    if (prev) prev.disabled = st.winStart === 0;
    if (fwd) fwd.disabled = addDays(firstBookable(), st.winStart + WINDOW) > lastBookable();

    days.forEach(function (d) {
      var open = isOpen(d);
      var selected = st.date && sameDay(d, st.date);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bk-day' + (selected ? ' is-active' : '') + (open ? '' : ' is-closed');
      b.setAttribute('aria-pressed', String(!!selected));
      b.innerHTML =
        '<span class="bk-dow">' + DOW[d.getDay()] + '</span>' +
        '<span class="bk-num">' + d.getDate() + '</span>' +
        '<span class="bk-availdot" aria-hidden="true"></span>';
      b.setAttribute('aria-label',
        DOW_FULL[d.getDay()] + ' ' + d.getDate() + ' ' + MON_FULL[d.getMonth()] +
        (open ? '' : ', closed'));
      b.addEventListener('click', function () {
        st.date = d; st.slot = null; render();
      });
      wrapEl.appendChild(b);
    });
  }

  function renderSlots() {
    var grid = $('#bk-slots');
    var none = $('#bk-noslots');
    var day = st.date;
    var list = day ? slotsFor(day, currentType().mins) : [];
    var hasSlots = list.length > 0;

    $('#bk-slotwrap').hidden = !hasSlots;
    none.hidden = hasSlots;

    if (!hasSlots) {
      grid.innerHTML = '';
      // Which day is closed depends on the date, so the panel is written
      // here rather than hardcoded in the markup.
      var nxt = day ? nextOpenFrom(addDays(day, 1)) : null;
      var t = $('#bk-noslots-t'), d2 = $('#bk-noslots-d'), jump = $('#bk-jump');
      if (t) t.textContent = day
        ? 'Closed on ' + DOW_FULL[day.getDay()]
        : 'Pick a day to see times';
      if (d2) d2.textContent = nxt
        ? 'The clinic is closed that day. The next open day is ' +
          DOW_FULL[nxt.getDay()] + ' ' + nxt.getDate() + ' ' + MON_FULL[nxt.getMonth()] + '.'
        : 'Choose another day from the row above.';
      if (jump) {
        jump.hidden = !nxt;
        if (nxt) jump.textContent = 'Jump to ' + DOW_FULL[nxt.getDay()];
        jump.onclick = nxt ? function () {
          var off = Math.round((nxt - firstBookable()) / 86400000);
          st.winStart = Math.max(0, Math.min(off, off - WINDOW + 1));
          st.date = nxt; st.slot = null; render();
        } : null;
      }
      return;
    }

    grid.innerHTML = '';
    list.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot-btn';
      b.textContent = s.label;
      b.setAttribute('aria-pressed', String(st.slot === s.label));
      if (s.taken) {
        b.disabled = true;
        b.setAttribute('aria-label', s.label + ', already booked');
      } else {
        b.addEventListener('click', function () { st.slot = s.label; render(); });
      }
      grid.appendChild(b);
    });
  }

  function renderSummary() {
    var t = currentType();
    $('#sumType').textContent = t.name;
    $('#sumDur').textContent = t.dur;
    $('#sumWho').textContent = st.forWhom === 'me' ? 'For myself' : 'For my child';
    $('#sumWhen').textContent = whenLabel();
    $('#sumWhere').textContent = whereLabel();

    $('#rvType').textContent = t.name + ' · ' + t.dur;
    $('#rvWhen').textContent = whenLabel();
    $('#rvWhere').textContent = whereLabel();
    $('#rvName').textContent =
      ((st.first + ' ' + st.last).trim() || 'Not entered yet') +
      ' · ' + (st.forWhom === 'me' ? 'For myself' : 'For my child');
    $('#rvContact').textContent = st.email || 'Not entered yet';
    $('#doneWhen').textContent = whenLabel();
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
    $('#bk-consent').setAttribute('aria-checked', String(st.consent));
    $('#bk-consent').classList.toggle('is-on', st.consent);
    $('#bk-detailerr').hidden = !(st.touched && !detailsOk());
  }

  function render() {
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

    // Toggles
    $('#who-me').setAttribute('aria-pressed', String(st.forWhom === 'me'));
    $('#who-child').setAttribute('aria-pressed', String(st.forWhom === 'child'));
    $('#mode-clinic').setAttribute('aria-pressed', String(st.mode === 'clinic'));
    $('#mode-online').setAttribute('aria-pressed', String(st.mode === 'online'));

    renderProgress();
    renderDays();
    renderSlots();
    renderSummary();
    renderValidation();

    // Footer actions
    var back = $('#bk-back');
    back.hidden = !(st.step > 1);
    var next = $('#bk-next');
    var last = st.step === 4;
    next.textContent = last ? 'Confirm request' : st.step === 3 ? 'Review request' : 'Continue';
    var ok = canNext();
    next.classList.toggle('btn-primary', ok);
    next.classList.toggle('btn-disabled', !ok);
    // Step 3 stays clickable so pressing it can surface validation.
    next.disabled = !ok && st.step !== 3;

    var hint = $('#bk-hint');
    // Once a time is chosen the action bar has nothing to add: the panel's
    // own .bk-hold line already explains what happens next, and repeating
    // it right underneath read as a stutter.
    hint.textContent = st.step === 2 && !st.slot ? 'Pick a time to continue.' : '';
  }

  /* ---------- Wiring ---------- */
  var typeEls = $$('.bk-type');
  function pickType(el) {
    st.type = el.dataset.type;
    st.slot = null;
    if (st.type === 'online') st.mode = 'online';
    else if (st.mode === 'online') st.mode = 'clinic';
    render();
  }
  typeEls.forEach(function (el, i) {
    el.addEventListener('click', function () { pickType(el); });
    el.addEventListener('keydown', function (e) {
      // Radiogroup keyboard contract: arrows move and select, Space/Enter select.
      var next = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % typeEls.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + typeEls.length) % typeEls.length;
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pickType(el); return; }
      if (next !== null) {
        e.preventDefault();
        pickType(typeEls[next]);
        typeEls[next].focus();
      }
    });
  });

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


  [['#f-first', 'first'], ['#f-last', 'last'], ['#f-email', 'email'],
   ['#f-phone', 'phone'], ['#f-note', 'note']].forEach(function (p) {
    var el = $(p[0]);
    el.addEventListener('input', function (e) {
      st[p[1]] = e.target.value;
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

  $('#bk-consent').addEventListener('click', function () {
    st.consent = !st.consent; render();
  });
  $('#bk-consent').addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); st.consent = !st.consent; render(); }
  });

  $$('.bk-edit').forEach(function (b) {
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
      var target = firstBad ? $(firstBad) : (!st.consent ? $('#bk-consent') : null);
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
    // confirmed, so the event is written as tentative.
    if (!st.slot || !st.date) return;
    var startAt = new Date(st.date);
    startAt.setHours(parseInt(st.slot.split(':')[0], 10),
                     parseInt(st.slot.split(':')[1], 10), 0, 0);
    var endAt = new Date(startAt.getTime() + currentType().mins * 60000);
    var stamp = function (dt) {
      return '' + dt.getFullYear() + pad2(dt.getMonth() + 1) + pad2(dt.getDate()) +
             'T' + pad2(dt.getHours()) + pad2(dt.getMinutes()) + '00';
    };
    var start = stamp(startAt), end = stamp(endAt);
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rayhab Movement Clinic//Booking//EN',
      'BEGIN:VEVENT', 'UID:' + Date.now() + '@dr-rayhab.com',
      'DTSTART:' + start, 'DTEND:' + end,
      'SUMMARY:' + currentType().name + ' - Rayhab',
      'LOCATION:' + whereLabel(),
      'STATUS:TENTATIVE',
      'DESCRIPTION:Requested appointment. The clinic confirms by WhatsApp within one working day.',
      'END:VEVENT', 'END:VCALENDAR'
    ];
    var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rayhab-assessment.ics';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  $('#bk-restart').addEventListener('click', function () {
    st = { step: 1, forWhom: 'me', type: 'assessment', mode: 'clinic',
           winStart: 0, date: null, slot: null, blurred: {},
           first: '', last: '', email: '', phone: '', note: '', consent: false,
           touched: false, blurred: {}, loading: false, done: false };
    st.date = nextOpenFrom(firstBookable());
    ['#f-first', '#f-last', '#f-email', '#f-phone', '#f-note'].forEach(function (s) { $(s).value = ''; });
    render();
    focusStep();
  });

  function focusStep() {
    var h = st.done ? $('#bk-done h2') : $('#step' + st.step + ' h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  }

  function submit() {
    st.loading = true; render();
    // Placeholder for the real request. Wire a POST here when the
    // clinic's booking endpoint exists; the payload is `st`.
    window.setTimeout(function () {
      st.loading = false; st.done = true;
      render(); focusStep();
    }, 1400);
  }

    st.date = nextOpenFrom(firstBookable());
    render();
  }

  window.mountBooking = mountBooking;

  // Standalone /book.html mounts itself.
  mountBooking(document.getElementById('booking'));
})();
