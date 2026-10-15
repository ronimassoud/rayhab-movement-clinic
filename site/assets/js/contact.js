/* Rayhab, contact form.

   Sends the question to POST {api}/enquiries, the API named by
   <meta name="rayhab-api"> (contract in README.md, "Launch and backend
   handoff"). Each field is checked in the browser first, with its own
   message beside it; the server checks again and can return its own
   field messages (422). The thank-you message appears only when the
   server answers 2xx with status "received". Anything else, including no
   endpoint at all, keeps what was typed and offers WhatsApp and email. */
(function () {
  'use strict';

  var form = document.getElementById('contact-form');
  var out = document.getElementById('contact-msg');
  if (!form || !out) return;

  var meta = document.querySelector('meta[name="rayhab-api"]');
  var API = meta ? (meta.getAttribute('content') || '').replace(/\/$/, '') : '';
  var send = document.getElementById('c-send');
  var openedAt = Date.now();
  var busy = false;

  function val(id) { return (document.getElementById(id).value || '').trim(); }

  var RULES = {
    'c-first': function (v) { return !v ? 'Enter your first name.' : v.length < 2 ? 'That looks too short.' : ''; },
    'c-last': function (v) { return !v ? 'Enter your last name.' : v.length < 2 ? 'That looks too short.' : ''; },
    'c-email': function (v) {
      if (!v) return 'Enter an email so the clinic can reply.';
      return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v) ? '' : 'Check the email address.';
    },
    'c-phone': function (v) {
      if (!v) return '';
      if (/[^0-9+()\-\s]/.test(v)) return 'Use digits, spaces, + or ( ) only.';
      var d = v.replace(/\D/g, '');
      return d.length < 8 ? 'That number looks too short.' : d.length > 15 ? 'That number looks too long.' : '';
    },
    'c-msg': function (v) { return !v ? 'Write your question so the clinic knows how to help.' : v.length < 10 ? 'Add a little more detail.' : ''; }
  };
  var SERVER_FIELD = { first_name: 'c-first', last_name: 'c-last', email: 'c-email', phone: 'c-phone', message: 'c-msg' };

  function mark(id, msg) {
    var el = document.getElementById(id), err = document.getElementById('err-' + id);
    el.setAttribute('aria-invalid', String(!!msg));
    if (err) { err.textContent = msg || ''; err.hidden = !msg; }
  }

  // Checks every field, marks each one, and returns the first that failed.
  function check() {
    var first = null;
    Object.keys(RULES).forEach(function (id) {
      var msg = RULES[id](val(id));
      mark(id, msg);
      if (msg && !first) first = id;
    });
    return first;
  }

  function say(html, kind) {
    out.innerHTML = html;
    out.className = 'notice mt-5 notice-' + kind;
    out.hidden = false;
    out.focus();
  }

  var FALLBACK = ' In the meantime, <a href="https://wa.me/96171383315" target="_blank" rel="noopener">WhatsApp the clinic</a> ' +
                 'on +961 71 383 315 or email <a href="mailto:rayan.halimeh@gmail.com">rayan.halimeh@gmail.com</a>. ' +
                 'What you wrote is still in the form.';

  function setBusy(on) {
    busy = on;
    if (send) {
      send.disabled = on;
      send.setAttribute('aria-busy', String(on));
      send.textContent = on ? 'Sending…' : 'Send question';
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;                       // one send at a time
    var bad = check();
    if (bad) {
      out.hidden = true;
      document.getElementById(bad).focus();
      return;
    }
    if (!API) {
      say('Sending messages online isn’t available right now, so this hasn’t been sent.' + FALLBACK, 'error');
      return;
    }

    setBusy(true);
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? window.setTimeout(function () { ctl.abort(); }, 15000) : 0;
    var body = {
      first_name: val('c-first'), last_name: val('c-last'), email: val('c-email'),
      phone: val('c-phone'), message: val('c-msg'),
      website: document.getElementById('c-website') ? document.getElementById('c-website').value : '',
      elapsed_ms: Date.now() - openedAt
    };
    fetch(API + '/enquiries', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      window.clearTimeout(timer);
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (x) { j = null; }
        return { ok: r.ok, status: r.status, body: j || {} };
      });
    }).then(function (res) {
      setBusy(false);
      if (res.ok && res.body.status === 'received') {
        form.reset();
        Object.keys(RULES).forEach(function (id) { mark(id, ''); });
        say('<strong>Thank you, your question has been sent.</strong> The clinic replies by email, or on WhatsApp if you ' +
            'added a number, usually within one working day. If it is about booking, you can also ' +
            '<a href="book.html">request an appointment</a> now.', 'success');
        return;
      }
      if (res.status === 422 && res.body.errors) {
        var first = null;
        Object.keys(res.body.errors).forEach(function (k) {
          var id = SERVER_FIELD[k];
          if (id) { mark(id, String(res.body.errors[k])); if (!first) first = id; }
        });
        if (first) { out.hidden = true; document.getElementById(first).focus(); return; }
      }
      if (res.status === 429) {
        say('Too many messages were sent from here in a short time, so this one wasn’t sent.' + FALLBACK, 'error');
        return;
      }
      if (res.status === 404 || res.status === 405 || res.status === 501) {
        say('Sending messages online isn’t available right now, so this hasn’t been sent.' + FALLBACK, 'error');
        return;
      }
      say('Something went wrong on the clinic’s side and your question wasn’t sent. Try again in a moment.' + FALLBACK, 'error');
    }, function (err) {
      window.clearTimeout(timer);
      setBusy(false);
      say((err && err.name === 'AbortError'
        ? 'The clinic didn’t answer in time, so your question may not have been sent. Try again in a moment.'
        : 'Your question couldn’t be sent. Check your connection and try again.') + FALLBACK, 'error');
    });
  });

  // A field that was marked wrong is re-checked as it is corrected, and
  // checked once when it is left; nobody is told they are wrong mid-typing.
  form.addEventListener('input', function (e) {
    var id = e.target.id;
    if (RULES[id] && e.target.getAttribute('aria-invalid') === 'true') mark(id, RULES[id](val(id)));
  });
  form.addEventListener('focusout', function (e) {
    var id = e.target.id;
    if (RULES[id] && val(id)) mark(id, RULES[id](val(id)));
  });
})();
