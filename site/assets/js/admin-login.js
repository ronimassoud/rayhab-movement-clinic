/* Rayhab, staff sign-in (admin/login.html).

   Password, then an authenticator code, always. The API does both steps
   with the identity provider server-side and then sets its own session
   cookie, so nothing secret is handled or kept in this page.

     POST /api/admin/login        { email, password } -> { mfa: "verify" | "enroll" }
     POST /api/admin/mfa/enroll   -> { qr_code, secret }        (first sign-in only)
     POST /api/admin/mfa/verify   { code } -> { ok }             (session cookie set)
     POST /api/admin/logout       (when opened as login.html?signout=1) */
(function () {
  'use strict';

  var API = window.RayhabAPI;
  var $ = function (id) { return document.getElementById(id); };
  if (!API) return;
  var demo = API.demo ? '?demo=1' : '';
  var busy = false;

  function step(id) {
    ['lg-password', 'lg-enroll', 'lg-verify'].forEach(function (s) { $(s).hidden = s !== id; });
    var h = $(id).querySelector('h1');
    if (h) h.focus();
  }
  function mark(id, msg) {
    var el = $(id), err = $('err-' + id);
    el.setAttribute('aria-invalid', String(!!msg));
    if (err) { err.textContent = msg || ''; err.hidden = !msg; }
  }
  function fail(box, text) {
    $(box).textContent = text;
    $(box).hidden = false;
    $(box).focus();
  }
  function setBusy(btn, on, label) {
    busy = on;
    $(btn).disabled = on;
    $(btn).setAttribute('aria-busy', String(on));
    if (label) $(btn).textContent = label;
  }
  function generic(res, err) {
    if (err) return err.name === 'AbortError' ? 'The server did not answer in time. Try again.' : 'Could not reach the server. Check the connection and try again.';
    if (res.status === 0 || res.status === 404) return 'Sign-in is not connected yet.';
    if (res.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
    return (res.body && res.body.error && res.body.error.message) || 'Something went wrong. Try again.';
  }
  function done() { location.replace('./' + demo); }

  /* Step 1 */
  $('lg-password').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var email = $('lg-email').value.trim(), pass = $('lg-pass').value;
    mark('lg-email', email ? '' : 'Enter your email.');
    mark('lg-pass', pass ? '' : 'Enter your password.');
    $('lg-err1').hidden = true;
    if (!email) return $('lg-email').focus();
    if (!pass) return $('lg-pass').focus();
    setBusy('lg-go1', true, 'Checking…');
    API.post('/admin/login', { email: email, password: pass }, { timeout: 15000 }).then(function (res) {
      setBusy('lg-go1', false, 'Continue');
      if (res.ok && res.body && res.body.mfa === 'verify') { step('lg-verify'); return; }
      if (res.ok && res.body && res.body.mfa === 'enroll') { enroll(); return; }
      if (res.status === 401) { $('lg-pass').value = ''; return fail('lg-err1', 'That email and password do not match.'); }
      if (res.status === 403) return fail('lg-err1', 'This account has no access to the clinic admin. Ask the clinic to add you.');
      if (res.status === 422 && res.body && res.body.errors) {
        if (res.body.errors.email) mark('lg-email', res.body.errors.email);
        if (res.body.errors.password) mark('lg-pass', res.body.errors.password);
        return;
      }
      fail('lg-err1', generic(res));
    }, function (err) { setBusy('lg-go1', false, 'Continue'); fail('lg-err1', generic(null, err)); });
  });

  /* Step 2a: the QR code comes from the identity provider, through the API. */
  function enroll() {
    step('lg-enroll');
    API.post('/admin/mfa/enroll', {}, { timeout: 15000 }).then(function (res) {
      if (!res.ok || !res.body || !res.body.qr_code) {
        if (res.status === 401) return restart('The sign-in took too long. Start again.');
        return fail('lg-err2', generic(res));
      }
      var img = document.createElement('img');
      img.alt = 'QR code to add Rayhab admin to your authenticator app';
      img.width = 200; img.height = 200;
      img.src = /^data:image\//.test(res.body.qr_code) ? res.body.qr_code : 'data:image/svg+xml;utf8,' + encodeURIComponent(res.body.qr_code);
      $('lg-qrwrap').innerHTML = '';
      $('lg-qrwrap').appendChild(img);
      $('lg-secret').textContent = String(res.body.secret || '').replace(/(.{4})/g, '$1 ').trim();
      $('lg-code-e').focus();
    }, function (err) { fail('lg-err2', generic(null, err)); });
  }

  function verify(form, input, btn, box, label) {
    $(form).addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var code = $(input).value.replace(/\s/g, '');
      $(box).hidden = true;
      if (!/^\d{6}$/.test(code)) { mark(input, 'Enter the 6-digit code.'); return $(input).focus(); }
      mark(input, '');
      setBusy(btn, true, 'Checking…');
      API.post('/admin/mfa/verify', { code: code }, { timeout: 15000 }).then(function (res) {
        setBusy(btn, false, label);
        if (res.ok) return done();
        if (res.status === 401) return restart('Too many wrong codes, or it took too long. Start again.');
        if (res.status === 422) { $(input).value = ''; mark(input, 'That code did not work. Try the newest one.'); return $(input).focus(); }
        fail(box, generic(res));
      }, function (err) { setBusy(btn, false, label); fail(box, generic(null, err)); });
    });
  }
  verify('lg-enroll', 'lg-code-e', 'lg-go2', 'lg-err2', 'Finish and sign in');
  verify('lg-verify', 'lg-code-v', 'lg-go3', 'lg-err3', 'Sign in');

  function restart(note) {
    $('lg-pass').value = '';
    step('lg-password');
    if (note) fail('lg-err1', note);
  }
  $('lg-restart').addEventListener('click', function () { restart(''); });

  // Codes are digits; keep the field tidy as people type or paste.
  Array.prototype.forEach.call(document.querySelectorAll('.lg-code'), function (el) {
    el.addEventListener('input', function () { el.value = el.value.replace(/\D/g, '').slice(0, 6); });
  });

  /* Opened as login.html?signout=1: end the session first. */
  if (/[?&]signout=1/.test(location.search)) {
    API.post('/admin/logout', {}, { timeout: 8000 }).then(function () {
      $('lg-note').textContent = 'You are signed out. Sign in again to continue.';
    }, function () {});
    history.replaceState(null, '', location.pathname + (demo || ''));
  }
  step('lg-password');
  $('lg-email').focus();
})();
