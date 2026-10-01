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

  var DAYS = [
    { dow: 'Mon', num: '1', month: 'Sep', open: true },
    { dow: 'Tue', num: '2', month: 'Sep', open: true },
    { dow: 'Wed', num: '3', month: 'Sep', open: false },
    { dow: 'Thu', num: '4', month: 'Sep', open: true },
    { dow: 'Fri', num: '5', month: 'Sep', open: true },
    { dow: 'Sat', num: '6', month: 'Sep', open: true }
  ];

  var TAKEN = {
    0: ['10:00', '15:00', '09:45', '10:30'],
    1: ['09:00', '17:00'],
    3: ['11:00', '16:00'],
    4: ['09:00', '12:00', '18:00'],
    5: ['15:00']
  };

  function slotsFor(dayIndex, mins) {
    var base = mins <= 40
      ? ['09:00','09:30','10:00','10:30','11:00','11:30','15:00','15:30','16:00','16:30','17:00','17:30']
      : mins <= 45
      ? ['09:00','09:45','10:30','11:15','15:00','15:45','16:30','17:15']
      : ['09:00','10:00','11:00','12:00','15:00','16:00','17:00','18:00'];
    var taken = TAKEN[dayIndex] || [];
    return base.map(function (s) {
      return { label: s, taken: taken.indexOf(s) >= 0 };
    });
  }

  /* ---------- State ---------- */
  var st = {
    step: 1, forWhom: 'me', type: 'assessment', mode: 'clinic',
    day: 0, slot: null,
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
  function emailOk() { return /.+@.+\..+/.test(st.email); }
  function phoneOk() { return st.phone.replace(/\D/g, '').length >= 7; }
  function detailsOk() {
    return !!(st.first.trim() && st.last.trim() && emailOk() && phoneOk() && st.consent);
  }
  function canNext() {
    if (st.step === 1) return !!st.type;
    if (st.step === 2) return !!st.slot;
    if (st.step === 3) return detailsOk();
    return true;
  }
  function whenLabel() {
    if (!st.slot) return 'Not chosen yet';
    var d = DAYS[st.day];
    return d.dow + ' ' + d.num + ' ' + d.month + ' · ' + st.slot;
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
    DAYS.forEach(function (d, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bk-day' + (st.day === i ? ' is-active' : '') + (d.open ? '' : ' is-closed');
      b.setAttribute('aria-pressed', String(st.day === i));
      b.innerHTML =
        '<span class="bk-dow">' + d.dow + '</span>' +
        '<span class="bk-num">' + d.num + '</span>' +
        '<span class="bk-availdot" aria-hidden="true"></span>';
      b.setAttribute('aria-label',
        d.dow + ' ' + d.num + ' ' + d.month + (d.open ? '' : ', no availability'));
      b.addEventListener('click', function () {
        st.day = i; st.slot = null; render();
      });
      wrapEl.appendChild(b);
    });
  }

  function renderSlots() {
    var day = DAYS[st.day];
    var grid = $('#bk-slots');
    var none = $('#bk-noslots');
    var hasSlots = day.open;

    $('#bk-slotwrap').hidden = !hasSlots;
    none.hidden = hasSlots;
    if (!hasSlots) { grid.innerHTML = ''; return; }

    grid.innerHTML = '';
    slotsFor(st.day, currentType().mins).forEach(function (s) {
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
    var pairs = [
      ['#f-first', st.first.trim()],
      ['#f-last', st.last.trim()],
      ['#f-email', emailOk()],
      ['#f-phone', phoneOk()]
    ];
    pairs.forEach(function (p) {
      var el = $(p[0]);
      var bad = st.touched && !p[1];
      el.setAttribute('aria-invalid', String(bad));
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
    // own .bk-hold line already says times are held for 15 minutes, and
    // repeating it right underneath read as a stutter.
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

  $('#who-me').addEventListener('click', function () { st.forWhom = 'me'; render(); });
  $('#who-child').addEventListener('click', function () { st.forWhom = 'child'; render(); });
  $('#mode-clinic').addEventListener('click', function () { st.mode = 'clinic'; st.slot = null; render(); });
  $('#mode-online').addEventListener('click', function () { st.mode = 'online'; st.slot = null; render(); });

  $('#bk-jump').addEventListener('click', function () { st.day = 3; st.slot = null; render(); });

  [['#f-first', 'first'], ['#f-last', 'last'], ['#f-email', 'email'],
   ['#f-phone', 'phone'], ['#f-note', 'note']].forEach(function (p) {
    $(p[0]).addEventListener('input', function (e) {
      st[p[1]] = e.target.value;
      if (st.touched) renderValidation();
      var n = $('#bk-next');
      var ok = canNext();
      n.classList.toggle('btn-primary', ok);
      n.classList.toggle('btn-disabled', !ok);
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
    if (st.step === 3 && !detailsOk()) { st.touched = true; renderValidation(); return; }
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
    var d = DAYS[st.day];
    if (!st.slot) return;
    var month = 9, year = 2026;                       // fixture month
    var hh = parseInt(st.slot.split(':')[0], 10);
    var mm = parseInt(st.slot.split(':')[1], 10);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var day = pad(parseInt(d.num, 10));
    var start = '' + year + pad(month) + day + 'T' + pad(hh) + pad(mm) + '00';
    var endMin = mm + currentType().mins;
    var end = '' + year + pad(month) + day + 'T' + pad(hh + Math.floor(endMin / 60)) + pad(endMin % 60) + '00';
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
    st = { step: 1, forWhom: 'me', type: 'assessment', mode: 'clinic', day: 0, slot: null,
           first: '', last: '', email: '', phone: '', note: '', consent: false,
           touched: false, loading: false, done: false };
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

    render();
  }

  window.mountBooking = mountBooking;

  // Standalone /book.html mounts itself.
  mountBooking(document.getElementById('booking'));
})();
