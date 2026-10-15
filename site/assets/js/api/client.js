/* Rayhab, API client.

   The one way the pages talk to the booking backend. Contracts are in
   README.md, "Launch and backend handoff".

     RayhabAPI.request(method, path, body, opts) -> Promise<{ ok, status, body, code }>

   - The base comes from <meta name="rayhab-api"> ("/api", same origin, so
     no CORS and no keys in the browser). With no meta, every call answers
     { ok:false, status:0, code:'no_api' } without touching the network.
   - It resolves for every HTTP answer, whatever the status, and rejects
     only when nothing came back: a network failure, or the timeout
     (err.name === 'AbortError').
   - POST, PATCH and DELETE carry an Idempotency-Key. A caller retrying the
     same action passes the same key (opts.key), so the server can tell a
     retry from a second request.
   - Once the admin session hands over a CSRF token, mutations carry it as
     X-CSRF-Token.
   - Errors arrive as { error: { code, message } }; code is lifted onto the
     result so callers branch on a stable value, not on wording.

   Demo mode. With ?demo=1 on staging or localhost (never on the production
   domain), calls go to an in-memory mock backend instead (api/mock.js,
   loaded on demand), and a banner says nothing is sent. Production pages
   carry no <meta name="rayhab-demo">, so there the flag does nothing. */
(function () {
  'use strict';

  var meta = document.querySelector('meta[name="rayhab-api"]');
  var BASE = meta ? (meta.getAttribute('content') || '').replace(/\/$/, '') : '';
  var csrf = '';

  function demoAllowed() {
    return !!document.querySelector('meta[name="rayhab-demo"]') ||
           /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  }
  var DEMO = demoAllowed() && /[?&]demo=1(?:&|$)/.test(location.search);

  /* The mock is fetched only in demo mode, from beside this file, so a
     normal visit never downloads it. */
  var mockReady = null;
  var here = document.currentScript && document.currentScript.src;
  function loadMock() {
    if (mockReady) return mockReady;
    mockReady = new Promise(function (resolve, reject) {
      if (window.RayhabMock) return resolve(window.RayhabMock);
      var s = document.createElement('script');
      s.src = here ? here.replace(/client\.js(\?.*)?$/, 'mock.js$1') : 'assets/js/api/mock.js';
      s.onload = function () { resolve(window.RayhabMock); };
      s.onerror = function () { reject(new Error('mock unavailable')); };
      document.head.appendChild(s);
    });
    return mockReady;
  }
  if (DEMO) loadMock();

  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function abortError() {
    var e = new Error('timeout'); e.name = 'AbortError'; return e;
  }

  function shape(status, body) {
    body = body || null;
    return {
      ok: status >= 200 && status < 300, status: status, body: body,
      code: body && body.error && body.error.code ? String(body.error.code) : ''
    };
  }

  function request(method, path, body, opts) {
    opts = opts || {};
    var ms = opts.timeout || 15000;
    var mutating = /^(POST|PATCH|PUT|DELETE)$/.test(method);
    var headers = { 'Accept': 'application/json' };
    if (body != null) headers['Content-Type'] = 'application/json';
    if (mutating) headers['Idempotency-Key'] = opts.key || newKey();
    if (mutating && csrf) headers['X-CSRF-Token'] = csrf;

    if (DEMO) {
      return loadMock().then(function (mock) {
        return new Promise(function (resolve, reject) {
          var timer = setTimeout(function () { reject(abortError()); }, ms);
          mock.handle(method, path, body == null ? null : JSON.parse(JSON.stringify(body)), headers)
            .then(function (res) { clearTimeout(timer); resolve(shape(res.status, res.body)); },
                  function (err) { clearTimeout(timer); reject(err); });
        });
      });
    }

    if (!BASE) return Promise.resolve({ ok: false, status: 0, body: null, code: 'no_api' });

    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms) : 0;
    var init = { method: method, credentials: 'same-origin', headers: headers };
    if (body != null) init.body = JSON.stringify(body);
    if (ctl) init.signal = ctl.signal;
    return fetch(BASE + path, init).then(function (r) {
      clearTimeout(timer);
      return r.text().then(function (t) {
        var parsed = null;
        try { parsed = t ? JSON.parse(t) : null; } catch (x) { parsed = null; }
        return shape(r.status, parsed);
      });
    }, function (err) { clearTimeout(timer); throw err; });
  }

  // ?a=1&b=2 from an object, skipping empty values.
  function qs(params) {
    var out = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return out.length ? '?' + out.join('&') : '';
  }

  window.RayhabAPI = {
    request: request,
    qs: qs,
    newKey: newKey,
    demo: DEMO,
    // Where ?demo=1 would work: staging and localhost, never production.
    demoAllowed: demoAllowed(),
    // Is there anything to talk to? False only with no API configured and
    // no demo: callers then show their "not available" state at once.
    available: function () { return DEMO || !!BASE; },
    setCsrf: function (token) { csrf = token || ''; },
    get: function (path, opts) { return request('GET', path, null, opts); },
    post: function (path, body, opts) { return request('POST', path, body || {}, opts); },
    patch: function (path, body, opts) { return request('PATCH', path, body || {}, opts); }
  };
})();
