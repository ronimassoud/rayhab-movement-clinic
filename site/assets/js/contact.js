/* Rayhab, contact form.

   There is no mail endpoint yet, so rather than swallow a message the
   form validates, then says plainly that sending is not connected and
   points at the booking flow, which does work. Replace the branch marked
   below with a real POST when the endpoint exists. */
(function () {
  'use strict';

  var form = document.getElementById('contact-form');
  var out = document.getElementById('contact-msg');
  if (!form || !out) return;

  var fields = ['#c-first', '#c-last', '#c-email', '#c-msg'];

  function valid() {
    var ok = true;
    fields.forEach(function (sel) {
      var el = form.querySelector(sel);
      var filled = el.value.trim().length > 0;
      if (sel === '#c-email') filled = /.+@.+\..+/.test(el.value);
      el.setAttribute('aria-invalid', String(!filled));
      if (!filled) ok = false;
    });
    return ok;
  }

  function say(text, kind) {
    out.textContent = text;
    out.className = 'notice notice-' + kind;
    out.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    if (!valid()) {
      say('Fill in your name, a valid email and your question so the clinic can reply.', 'error');
      return;
    }

    // --- replace with the real POST once a mail endpoint exists ---
    say('Message sending is not connected yet. In the meantime, please use ' +
        '“Book an assessment”; it reaches the clinic and needs no account.', 'info');
    out.focus && out.setAttribute('tabindex', '-1');
    out.focus();
  });

  form.addEventListener('input', function (e) {
    if (e.target.getAttribute('aria-invalid') === 'true') {
      var sel = '#' + e.target.id;
      var filled = e.target.value.trim().length > 0;
      if (sel === '#c-email') filled = /.+@.+\..+/.test(e.target.value);
      if (filled) e.target.setAttribute('aria-invalid', 'false');
    }
  });
})();
