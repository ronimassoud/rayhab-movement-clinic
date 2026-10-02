/* Rayhab, booking modal.

   Any link to book.html opens the booking flow in a dialog over the current
   page instead of navigating. The markup is fetched from book.html once and
   cached, so there is a single source of truth and book.html still works on
   its own as the no-JS fallback. */
(function () {
  'use strict';

  var ANIM_MAX = 600;     // only a backstop; the CSS owns the real duration
  var dialog = null;
  var cached = null;      // the parsed #booking node, never mounted itself
  var lastTrigger = null;

  function isBookLink(a) {
    try {
      return new URL(a.href, location.href).pathname.replace(/\/+$/, '').slice(-10) === '/book.html';
    } catch (e) { return false; }
  }

  function onBookPage() {
    return location.pathname.replace(/\/+$/, '').slice(-10) === '/book.html';
  }

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function build() {
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.id = 'book-modal';
    dialog.setAttribute('aria-label', 'Book with Rayhab');
    dialog.innerHTML =
      '<button class="modal-close" type="button" aria-label="Close booking">' +
        '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13"/></svg>' +
      '</button>' +
      '<div class="modal-body"></div>';
    document.body.appendChild(dialog);

    dialog.querySelector('.modal-close').addEventListener('click', close);

    // Esc; take over so the close animation runs.
    dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(); });

    // Click outside the dialog box closes it. Backdrop clicks target the
    // dialog itself; anything inside targets a child. That check matters:
    // keyboard activation fires a click at (0,0), so a coordinate test
    // alone would dismiss the modal when someone presses Enter on a button.
    dialog.addEventListener('click', function (e) {
      if (e.target !== dialog) return;
      var r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right ||
          e.clientY < r.top  || e.clientY > r.bottom) close();
    });

    return dialog;
  }

  function wire(body, opts) {
    // Inside the modal the rail's wordmark and "Exit" should dismiss the
    // dialog rather than navigate away from the page behind it.
    Array.prototype.forEach.call(body.querySelectorAll('.bk-rail a[href]'), function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); close(); });
    });
    if (typeof window.mountBooking === 'function') {
      window.mountBooking(body.querySelector('#booking'), opts);
    }
  }

  /* The dialog never navigates, so a query string on the trigger link would
     otherwise be dropped. "Book this" on a service page and the router
     cards use it to name the service, so it has to survive the hand-off. */
  function opened(href) {
    var out = {};
    try {
      var q = new URL(href, location.href).search;
      var t = /[?&]type=([^&#]*)/.exec(q);
      var w = /[?&]for=([^&#]*)/.exec(q);
      if (t) out.type = decodeURIComponent(t[1]);
      if (w) out.forWhom = decodeURIComponent(w[1]);
    } catch (e) { /* a malformed href just means no preselection */ }
    return out;
  }

  function present() {
    var d = build();
    d.showModal();
    document.documentElement.classList.add('modal-open');
    if (reduced()) { d.classList.add('is-open'); return; }
    // Two frames so the starting styles are committed before transitioning.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { d.classList.add('is-open'); });
    });
  }

  function open(url, trigger) {
    var d = build();
    var body = d.querySelector('.modal-body');
    lastTrigger = trigger || null;

    if (cached) {
      body.innerHTML = '';
      body.appendChild(cached.cloneNode(true));
      wire(body, opened(url));
      present();
      return Promise.resolve();
    }

    return fetch(url, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (html) {
        var node = new DOMParser().parseFromString(html, 'text/html').getElementById('booking');
        if (!node) throw new Error('no #booking in ' + url);
        cached = node;
        body.innerHTML = '';
        body.appendChild(cached.cloneNode(true));
        wire(body, opened(url));
        present();
      });
  }

  function close() {
    if (!dialog || !dialog.open) return;
    dialog.classList.remove('is-open');

    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      dialog.removeEventListener('transitionend', onEnd);
      dialog.close();
      dialog.querySelector('.modal-body').innerHTML = '';
      document.documentElement.classList.remove('modal-open');
      if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
      lastTrigger = null;
    };

    function onEnd(e) {
      // Children transition too, and the dialog's own opacity is the last
      // thing to land, so anything else would close it mid-animation.
      if (e.target === dialog && e.propertyName === 'opacity') finish();
    }

    if (reduced()) { finish(); return; }

    // The exit length lives in the stylesheet. Waiting for the transition
    // means the two cannot drift apart, which is what truncated the old
    // close: it fired at 240ms while the transform ran for 260ms.
    dialog.addEventListener('transitionend', onEnd);
    // If the tab is hidden or the transition is interrupted, transitionend
    // never arrives, so the dialog still has to come down.
    window.setTimeout(finish, ANIM_MAX);
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || !isBookLink(a)) return;
    if (onBookPage()) return;                 // already there; let it be
    if (!window.HTMLDialogElement) return;    // no <dialog>: navigate normally

    e.preventDefault();
    open(a.href, a)['catch'](function () {
      window.location.href = a.href;          // fetch failed, fall back
    });
  });
})();
