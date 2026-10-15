/* Rayhab, payment choice (payment/index.html).

   Opened from the WhatsApp message the patient receives once the clinic
   approves a request:

     https://dr-rayhab.com/payment/#t={token}

   The token is opaque and short-lived; the server keeps only its hash.
   It travels in the #fragment, which browsers never send to a server, so
   it does not end up in access logs, in a Referer, or in analytics.

     GET  /api/payment-selection/{token}   what to show (read-only, polled)
     POST /api/payment-selection/{token}   { method: "whish" | "cash" }
     POST /api/payments/whish/create       { token } -> { checkout_url }

   Whish sends the patient back to #t={token}&r=1. Coming back proves
   nothing: the page shows "Verifying payment" and asks the server until it
   reports the payment verified, failed, or still pending after about two
   minutes. Every state shown comes from the server; nothing is stored in
   the browser. */
(function () {
  'use strict';

  var API = window.RayhabAPI, L = window.RayhabLabels, T = window.RayhabTime;
  var root = document.querySelector('.pay');
  if (!root || !API || !API.payments || !L || !T) return;

  var $ = function (id) { return document.getElementById(id); };
  var CLINIC_WA = 'https://wa.me/96171383315';

  function hashParams() {
    var out = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    return out;
  }
  var params = hashParams();
  var token = params.t || '';
  var returned = params.r === '1';

  var view = null;          // the last selection the server returned
  var chosen = '';          // the method highlighted in the chooser
  var changing = false;     // reopened the chooser from "Change method"
  var busy = false;
  var pollTimer = 0, pollStarted = 0;
  var keys = {};            // one Idempotency-Key per action, kept for retries

  function keyFor(action) { return keys[action] || (keys[action] = API.newKey()); }
  function doneWith(action) { delete keys[action]; }

  /* ---------- Rendering ---------- */
  function show(which) {
    ['ps-loading', 'ps-choose', 'ps-message'].forEach(function (id) { $(id).hidden = id !== which; });
  }
  function focusHeading(id) {
    var h = $(id).querySelector('h2');
    if (h) h.focus();
  }

  function renderSummary() {
    if (!view || !view.appointment) { $('pay-summary').hidden = true; return; }
    var a = view.appointment, p = view.payment || {};
    $('ps-service').textContent = a.service.name + (a.service.duration_min ? ' · ' + a.service.duration_min + ' min' : '');
    $('ps-with').textContent = a.practitioner ? a.practitioner.name : 'Rayhab Movement Clinic';
    var hint = T.localHint(a.local_date, a.local_time);
    $('ps-when').textContent = T.dayLabel(a.local_date) + ' · ' + a.local_time + ' Beirut time' + (hint ? ' (' + hint + ' your time)' : '');
    $('ps-where').textContent = a.location || (a.mode === 'online' ? 'Online, video call' : 'Rayhab Movement Clinic, Beirut');
    $('ps-amount').textContent = L.money(p.outstanding != null && p.status !== 'paid' ? p.outstanding : p.amount, p.currency) || '—';
    $('ps-ref').textContent = a.reference || '—';
    $('pay-summary').hidden = false;
  }

  /* One message layout for every state other than the chooser. */
  function message(o) {
    stopPolling();
    show('ps-message');
    var mark = $('ps-mark');
    mark.className = 'pay-mark is-' + (o.tone || 'info');
    mark.innerHTML = o.tone === 'success' ? '✓' : o.tone === 'pending' ? '<span class="pay-spin"></span>' : o.tone === 'danger' ? '!' : 'i';
    $('ps-msg-eyebrow').textContent = o.eyebrow || '';
    $('ps-msg-title').textContent = o.title;
    $('ps-msg-text').textContent = o.text || '';
    var facts = $('ps-msg-facts');
    facts.innerHTML = '';
    (o.facts || []).forEach(function (f) {
      var li = document.createElement('li');
      li.textContent = f;
      facts.appendChild(li);
    });
    facts.hidden = !(o.facts && o.facts.length);
    var acts = $('ps-msg-actions');
    acts.innerHTML = '';
    (o.actions || []).forEach(function (act, i) {
      var el = document.createElement(act.href ? 'a' : 'button');
      el.className = act.link ? 'bk-linkbtn' : 'btn ' + (i === 0 ? 'btn-spring' : 'btn-ghost-light');
      el.textContent = act.label;
      if (act.href) { el.href = act.href; if (/^https?:/.test(act.href)) { el.target = '_blank'; el.rel = 'noopener'; } }
      else { el.type = 'button'; el.addEventListener('click', act.run); }
      acts.appendChild(el);
    });
    if (o.focus !== false) focusHeading('ps-message');
  }

  var WA = { label: 'WhatsApp the clinic', href: CLINIC_WA, link: true };

  /* What the server's answer means for the patient. Order matters: a
     closed appointment outranks its payment, and a verified payment
     outranks everything else. */
  function renderView(opts) {
    opts = opts || {};
    renderSummary();
    var a = view.appointment, p = view.payment || {};
    var amount = L.money(p.amount, p.currency);

    if (a.status === 'declined' || a.status === 'cancelled' || a.status === 'expired') {
      var closed = {
        declined: ['Request declined', 'The clinic could not take this request. If you have not heard why, or would like another time, message the clinic.'],
        cancelled: ['Appointment cancelled', 'This appointment has been cancelled, so there is nothing to pay. If that is unexpected, message the clinic.'],
        expired: ['Request expired', 'This request was not confirmed in time, so there is nothing to pay. You can request a new appointment.']
      }[a.status];
      return message({ tone: 'neutral', eyebrow: L.appointment(a.status).label, title: closed[0], text: closed[1],
        actions: [{ label: 'Request a new appointment', href: '../book.html' }, WA] });
    }

    if (p.status === 'paid') {
      return message({ tone: 'success', eyebrow: 'Paid · ' + L.method(p.method).label,
        title: 'Payment received',
        text: (p.method === 'whish' ? 'Whish has confirmed your payment of ' : 'The clinic has recorded your payment of ') + amount +
              '. ' + (a.status === 'confirmed' ? 'Your appointment is confirmed.' : 'The clinic will confirm the appointment.'),
        facts: [p.receipt_reference ? 'Receipt reference: ' + p.receipt_reference : '', 'Keep this page or the WhatsApp message for your records.'].filter(Boolean),
        actions: [{ label: 'Read: what to expect', href: '../scoliosis/' }] });
    }
    if (p.status === 'refunded') {
      return message({ tone: 'neutral', eyebrow: 'Refunded', title: 'Payment refunded',
        text: 'This payment has been refunded. If you have questions about it, message the clinic.', actions: [WA] });
    }

    var methods = view.allowed_methods || [];
    var attempt = p.last_attempt && p.last_attempt.status;

    // Back from Whish, or a payment Whish has not settled yet.
    if (p.method === 'whish' && (attempt === 'pending' || (returned && !attempt))) return verifying(opts);

    if (changing || (!p.method || p.status === 'not_selected')) {
      if (!methods.length) {
        return message({ tone: 'neutral', title: 'Nothing to choose yet',
          text: 'This appointment is not ready for payment. The clinic will message you when it is.', actions: [WA] });
      }
      return chooser(opts);
    }

    if (p.method === 'cash') {
      var facts = [];
      if (view.policy && view.policy.cash) facts.push(view.policy.cash);
      facts.push('Amount due: ' + L.money(p.outstanding, p.currency) + '. It is marked paid only once the clinic records it.');
      return message({ tone: 'info', eyebrow: L.paymentSummary('cash', p.status),
        title: a.status === 'confirmed' ? 'Appointment confirmed, payment due at the clinic' : 'Cash selected',
        text: 'You chose to pay in cash at the clinic.',
        facts: facts,
        actions: (view.can_change_method && methods.indexOf('whish') >= 0
          ? [{ label: 'Pay online with Whish instead', run: function () { openChooser('whish'); } }] : []).concat([WA]),
        focus: opts.focus });
    }

    // Whish chosen, not paid: never started, left, or failed.
    var flag = attempt === 'failed' ? ['Payment failed', 'Whish could not complete the payment, so nothing was charged. You can try again.']
             : attempt === 'abandoned' ? ['Payment not completed', 'The Whish checkout was closed before paying, so nothing was charged.']
             : ['Payment not started', 'You chose Whish but have not paid yet.'];
    var acts = [];
    if (view.can_retry || !attempt) acts.push({ label: attempt ? 'Try Whish again' : 'Continue to Whish', run: startWhish });
    if (view.can_change_method && methods.indexOf('cash') >= 0) acts.push({ label: 'Pay cash at the clinic instead', run: function () { openChooser('cash'); } });
    acts.push(WA);
    return message({ tone: attempt === 'failed' ? 'danger' : 'warn', eyebrow: L.paymentSummary('whish', p.status),
      title: flag[0], text: flag[1],
      facts: view.policy && view.policy.deadline ? ['Please pay before ' + deadlineLabel(view.policy.deadline) + '.'] : [],
      actions: acts, focus: opts.focus });
  }

  function deadlineLabel(isoUtc) {
    var b = T.fromInstant(isoUtc);
    return T.dayLabel(b.date, true) + ' at ' + b.time + ' Beirut time';
  }

  /* ---------- Choosing ---------- */
  function chooser(opts) {
    stopPolling();
    show('ps-choose');
    var a = view.appointment, p = view.payment || {};
    var methods = view.allowed_methods || [];
    $('ps-choose-eyebrow').textContent = L.appointment(a.status).label === 'Approved' ? 'Appointment approved' : L.appointment(a.status).label;
    var amt = L.money(p.outstanding != null ? p.outstanding : p.amount, p.currency);
    Array.prototype.forEach.call(document.querySelectorAll('[data-amount]'), function (el) { el.textContent = amt; });
    if (view.policy) {
      if (view.policy.whish) $('pm-whish-desc').textContent = view.policy.whish;
      if (view.policy.cash) $('pm-cash-desc').textContent = view.policy.cash;
    }
    ['whish', 'cash'].forEach(function (m) { $('pm-' + m).hidden = methods.indexOf(m) < 0; });
    if (methods.length === 1) chosen = methods[0];
    if (methods.indexOf(chosen) < 0) chosen = '';
    var dl = $('ps-deadline');
    dl.hidden = !(view.policy && view.policy.deadline);
    if (!dl.hidden) dl.textContent = 'Please choose before ' + deadlineLabel(view.policy.deadline) + ', or the clinic may offer the time to someone else.';
    $('ps-cancelchange').hidden = !changing;
    $('ps-choose-err').hidden = true;
    paintChoice();
    if (!opts || opts.focus !== false) focusHeading('ps-choose');
  }

  function paintChoice() {
    ['whish', 'cash'].forEach(function (m) {
      var el = $('pm-' + m), on = chosen === m;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-checked', String(on));
      el.tabIndex = on || (!chosen && m === visibleMethods()[0]) ? 0 : -1;
    });
    var btn = $('ps-confirm');
    btn.disabled = !chosen || busy;
    btn.setAttribute('aria-busy', String(busy));
    btn.textContent = busy ? (chosen === 'whish' ? 'Opening Whish…' : 'Saving…')
      : chosen === 'whish' ? 'Continue to Whish' : chosen === 'cash' ? 'Confirm cash at the clinic' : 'Choose a payment method';
  }
  function visibleMethods() {
    return ['whish', 'cash'].filter(function (m) { return !$('pm-' + m).hidden; });
  }

  function openChooser(preselect) {
    changing = true;
    chosen = preselect || '';
    chooser();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.pay-method'), function (el) {
    el.addEventListener('click', function () { if (!busy) { chosen = el.dataset.method; paintChoice(); } });
    el.addEventListener('keydown', function (e) {
      var list = visibleMethods(), i = list.indexOf(el.dataset.method), to = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = (i + 1) % list.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = (i - 1 + list.length) % list.length;
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!busy) { chosen = el.dataset.method; paintChoice(); } return; }
      if (to !== null && !busy) { e.preventDefault(); chosen = list[to]; paintChoice(); $('pm-' + chosen).focus(); }
    });
  });

  $('ps-cancelchange').addEventListener('click', function () { changing = false; renderView(); });

  function chooseError(text) {
    var box = $('ps-choose-err');
    box.textContent = text;
    box.hidden = false;
    box.focus();
  }

  $('ps-confirm').addEventListener('click', function () {
    if (busy || !chosen) return;
    var method = chosen;
    busy = true; paintChoice();
    API.payments.choose(token, method, keyFor('choose-' + method)).then(function (res) {
      busy = false;
      if (res.ok && res.body && res.body.payment) {
        doneWith('choose-' + method);
        view = res.body; changing = false;
        if (method === 'whish') return startWhish();
        return renderView();
      }
      if (res.status === 409 || res.status === 410) {
        // Already decided elsewhere, or the appointment changed: show what is true now.
        changing = false;
        return load({ note: res.code === 'method_finalized' ? 'The payment method was already chosen.' : '' });
      }
      if (res.status === 401 || res.status === 404) return linkProblem(res);
      if (res.status === 429) { paintChoice(); return chooseError('Too many attempts in a short time. Wait a minute and try again.'); }
      paintChoice();
      chooseError('Your choice could not be saved. Try again in a moment, or message the clinic.');
    }, function (err) {
      busy = false; paintChoice();
      chooseError(err && err.name === 'AbortError'
        ? 'The clinic did not answer in time, so your choice may not have been saved. Try again; choosing twice is safe.'
        : 'Your choice could not be sent. Check your connection and try again.');
    });
  });

  /* ---------- Whish ---------- */
  function startWhish() {
    if (busy) return;
    busy = true;
    message({ tone: 'pending', eyebrow: 'Whish', title: 'Opening Whish…', text: 'You are being taken to Whish to pay securely. Do not close this page.' });
    API.payments.whishCheckout(token, keyFor('whish')).then(function (res) {
      busy = false;
      var url = res.ok && res.body && res.body.checkout_url;
      if (url && API.demo && url.indexOf('mock-checkout:') === 0 && window.RayhabMock) {
        doneWith('whish');
        window.RayhabMock.checkout(token, function () {
          history.replaceState(null, '', location.pathname + location.search + '#t=' + encodeURIComponent(token) + '&r=1');
          returned = true;
          load();
        });
        return;
      }
      if (url && /^https:\/\//.test(url)) { doneWith('whish'); location.assign(url); return; }
      if (res.status === 409 && res.code === 'already_paid') return load();
      if (res.status === 401 || res.status === 404 || res.status === 410) return linkProblem(res);
      whishUnavailable(res.status === 503 || res.code === 'whish_unavailable');
    }, function () {
      busy = false;
      whishUnavailable(false);
    });
  }

  function whishUnavailable(down) {
    var methods = (view && view.allowed_methods) || [];
    var acts = [{ label: 'Try again', run: startWhish }];
    if (view && (view.can_change_method || !view.payment.method) && methods.indexOf('cash') >= 0) {
      acts.push({ label: 'Pay cash at the clinic instead', run: function () { openChooser('cash'); } });
    }
    acts.push(WA);
    message({ tone: 'warn', eyebrow: 'Whish',
      title: down ? 'Whish is not available right now' : 'Whish could not be opened',
      text: 'Nothing has been charged. Try again in a few minutes' +
            (methods.indexOf('cash') >= 0 ? ', or pay in cash at the clinic instead.' : '.'),
      actions: acts });
  }

  /* ---------- Verifying ----------
     Asks the server, never Whish's redirect, at 2, 3, 5, 8 and then every
     10 seconds, for about two minutes. Then it says plainly that it is
     taking longer, without suggesting the patient pay again. */
  function verifying(opts) {
    if (!pollStarted) pollStarted = Date.now();
    if (Date.now() - pollStarted > 120000) {
      return message({ tone: 'warn', eyebrow: 'Whish · Verifying', title: 'Verification is taking longer than usual',
        text: 'Whish has not confirmed the payment yet. Please do not pay again: if money left your account, it will be matched to this appointment.',
        facts: ['You can close this page; the clinic will message you once the payment is confirmed.'],
        actions: [{ label: 'Check again', run: function () { pollStarted = Date.now(); load(); } }, WA] });
    }
    if (!pollTimer) {
      message({ tone: 'pending', eyebrow: 'Whish', title: 'Verifying payment',
        text: 'We are confirming your payment with Whish. This usually takes a few seconds. Please do not pay again.',
        focus: opts && opts.focus });
    }
    var waited = (Date.now() - pollStarted) / 1000;
    var next = waited < 2 ? 2000 : waited < 5 ? 3000 : waited < 10 ? 5000 : waited < 18 ? 8000 : 10000;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(function () { pollTimer = -1; load({ poll: true }); }, next);
  }
  function stopPolling() {
    if (pollTimer > 0) clearTimeout(pollTimer);
    pollTimer = 0;
  }

  /* ---------- Loading ---------- */
  function linkProblem(res) {
    var expired = res.status === 410 || res.code === 'link_expired';
    message({ tone: 'neutral', eyebrow: expired ? 'Link expired' : 'Link not recognized',
      title: expired ? 'This payment link has expired' : 'This payment link does not work',
      text: expired
        ? 'For your security, payment links only work for a limited time. Message the clinic and they will send you a new one.'
        : 'The link may be incomplete. Open it again from the clinic’s WhatsApp message, or ask the clinic for a new one.',
      actions: [{ label: 'WhatsApp the clinic', href: CLINIC_WA }] });
  }

  function load(opts) {
    opts = opts || {};
    var polling = opts.poll;
    if (!polling && !view) show('ps-loading');
    return API.payments.selection(token).then(function (res) {
      if (res.ok && res.body && res.body.appointment) {
        view = res.body;
        var p = view.payment || {};
        var pending = p.method === 'whish' && p.status !== 'paid' &&
                      ((p.last_attempt && p.last_attempt.status === 'pending') || (returned && !p.last_attempt));
        if (!pending) {
          pollStarted = 0;
          if (returned) {
            // The return visit is over; a reload should not wait again.
            returned = false;
            history.replaceState(null, '', location.pathname + location.search + '#t=' + encodeURIComponent(token));
          }
        }
        renderView({ focus: !polling });
        if (opts.note) {
          var t = $('ps-msg-text');
          if (!$('ps-message').hidden) t.textContent = opts.note + ' ' + t.textContent;
        }
        return;
      }
      // A 404 with no error code is a missing endpoint (no backend yet), not
      // a rejected link.
      if (res.status === 0 || ((res.status === 404 || res.status === 405 || res.status === 501) && !res.code)) return unavailable();
      if (res.status === 404 || res.status === 410 || res.status === 401 || res.status === 403) return linkProblem(res);
      if (polling) return verifying({ focus: false });   // keep waiting through a hiccup
      problem('Something went wrong on the clinic’s side. Try again in a moment.');
    }, function (err) {
      if (polling) return verifying({ focus: false });
      problem(err && err.name === 'AbortError'
        ? 'The clinic did not answer in time. Check your connection and try again.'
        : 'This page could not reach the clinic. Check your connection and try again.');
    });
  }

  function problem(text) {
    message({ tone: 'danger', eyebrow: 'Connection', title: 'Your appointment could not be loaded', text: text,
      actions: [{ label: 'Try again', run: function () { load(); } }, WA] });
  }
  function unavailable() {
    message({ tone: 'neutral', title: 'Online payment choice isn’t available yet',
      text: 'Message the clinic on WhatsApp to choose how to pay. Nothing has been charged.',
      actions: [{ label: 'WhatsApp the clinic', href: CLINIC_WA }] });
  }

  // A token is letters, digits, - and _; anything else is not one of ours.
  if (!token || !/^[A-Za-z0-9_-]{8,256}$/.test(token)) {
    linkProblem({ status: 404 });
  } else {
    load();
  }
  window.addEventListener('hashchange', function () {
    var next = hashParams();
    if (next.t && next.t !== token) { token = next.t; returned = next.r === '1'; view = null; changing = false; pollStarted = 0; stopPolling(); load(); }
  });
})();
