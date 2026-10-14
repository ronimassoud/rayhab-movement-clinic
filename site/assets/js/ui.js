/* Rayhab, shared UI behaviour: mobile nav, accordions, library bar,
   section spy.
   Progressive enhancement: every control works as markup first. */
(function () {
  'use strict';

  /* ---- Mobile navigation ----
     Below 1181px the menu button opens the card panel (#navcards): the pill
     grows downward and three cards of grouped links drop in. This block owns
     the state, focus and closing rules. The motion is motion.js's, through
     window.rhNav; without it the .is-open class opens the pill instantly. */
  var toggle = document.querySelector('.nav-toggle');
  var links = toggle ? document.getElementById(toggle.getAttribute('aria-controls') || 'navgroup') : null;

  if (toggle && links) {
    var nav = toggle.closest ? toggle.closest('.site-nav') : null;

    function isOpen() { return toggle.getAttribute('aria-expanded') === 'true'; }

    function setOpen(open, moveFocus) {
      toggle.setAttribute('aria-expanded', String(open));
      if (window.rhNav) window.rhNav.set(open);
      else if (nav) nav.classList.toggle('is-open', open);
      if (!open) { if (moveFocus) toggle.focus(); return; }
      // Opening left focus on the body, so a keyboard or screen-reader user
      // had to tab through the whole bar to reach the links they just asked
      // for. This is a disclosure rather than a modal, so focus moves in but
      // is not trapped.
      if (moveFocus) {
        var first = links.querySelector('a[href], button:not([disabled])');
        // preventScroll: the link is still clipped while the pill grows, and
        // letting the browser scroll it into view shoved the bar out of sight.
        if (first) first.focus({ preventScroll: true });
      }
    }

    toggle.addEventListener('click', function () { setOpen(!isOpen(), true); });

    // Close when focus leaves the bar entirely. relatedTarget is null when
    // focus goes to the page chrome or out of the document, which should
    // also close it.
    if (nav) {
      nav.addEventListener('focusout', function (e) {
        if (!isOpen()) return;
        if (e.relatedTarget && nav.contains(e.relatedTarget)) return;
        setOpen(false, false);
      });

      // Escape used to be bound to the document, so pressing it inside the
      // booking dialog collapsed the nav sitting behind it. Scoped to the
      // bar, the dialog's own cancel handler is the only thing that reacts.
      nav.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); setOpen(false, true); }
      });
    }

    // Any click that is not the toggle itself closes the drawer. Pointer
    // events outside do not move focus, so focusout alone does not cover
    // this, and scoping it to "outside the bar" would miss the Book button,
    // which sits inside .site-nav and would otherwise leave the drawer
    // hanging open behind the booking dialog.
    document.addEventListener('click', function (e) {
      if (!isOpen()) return;
      if (e.target.closest && e.target.closest('.nav-toggle')) return;
      // A click on the cards' own surface is not a click away from them. A
      // click on one of their links still closes, which matters for "Book an
      // assessment": it opens the booking dialog over this page.
      if (e.target.closest && e.target.closest('.navcards') && !e.target.closest('a')) return;
      setOpen(false, false);
    });

    // The current page, marked the way the desktop row marks it. Done here
    // rather than in the markup so the panel is identical on every page.
    var norm = function (p) { return p.replace(/index\.html$/, '').replace(/\/+$/, '/'); };
    var here = norm(location.pathname);
    Array.prototype.forEach.call(links.querySelectorAll('.navcard a[href]'), function (a) {
      if (norm(new URL(a.href, location.href).pathname) === here) a.setAttribute('aria-current', 'page');
    });

    // Reset state when the menu stops being a drawer.
    var mq = window.matchMedia('(min-width:1181px)');
    var reset = function (e) { if (e.matches) setOpen(false, false); };
    if (mq.addEventListener) mq.addEventListener('change', reset);
    else if (mq.addListener) mq.addListener(reset);
  }

  /* ---- Nav labels: jelly ----
     A port of React Bits' JellyRadio motion to the nav row, without React
     or the motion library: the site has no build step for its scripts, and
     the effect is three springs per label, which a few lines can run.

     The label under the pointer (or keyboard focus) swells, widening a
     beat before it grows tall, and shoves its neighbours aside, nearest
     first. Everything else gives up a little size. When the pointer leaves
     the row, the current page's label takes the swell back, so at rest the
     page you are on is the one standing proud.

     The numbers are the component's defaults, and the springs use its
     maths: damping = 2 * sqrt(k * m) * (1 - bounce), with the horizontal
     scale stiffer and bouncier than the vertical one (that split is the
     "jelly"), and stiffness softening with distance from the chosen label.

     Only on the horizontal desktop row. The drawer is a column, and a
     sideways shove has no meaning there. Off entirely under reduced motion. */
  var row = document.getElementById('navgroup');
  if (row && window.requestAnimationFrame && window.matchMedia) {
    var J = { swell: 0.2, barge: 6, shrink: 0.05, jelly: 1, bounce: 0.25, stagger: 22, stiffness: 580 };
    var wideMq = window.matchMedia('(min-width:1181px)');
    var stillMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    var chips = Array.prototype.slice.call(row.querySelectorAll('a'));
    var home = -1;
    chips.forEach(function (a, i) { if (a.getAttribute('aria-current') === 'page') home = i; });

    var spring = function (p) { return { p: p, v: 0, to: p, k: 1, c: 0, m: 1, at: 0, live: false }; };
    var state = chips.map(function () { return { x: spring(0), sx: spring(1), sy: spring(1) }; });
    var widths = [];
    var on = false, frame = 0, last = 0;

    var aim = function (s, to, k, m, bounce, delay, now) {
      s.to = to; s.k = k; s.m = m; s.c = 2 * Math.sqrt(k * m) * (1 - bounce);
      s.at = now + delay; s.live = true;
    };
    var jump = function (s, to) { s.p = s.to = to; s.v = 0; s.live = false; };

    // Semi-implicit Euler in four substeps a frame: stable at these
    // stiffnesses, and close enough to the analytic spring to be the same
    // motion to the eye.
    var step = function (s, now, dt) {
      if (!s.live || now < s.at) return s.live;
      for (var n = 0; n < 4; n++) {
        var a = (-s.k * (s.p - s.to) - s.c * s.v) / s.m;
        s.v += a * dt / 4;
        s.p += s.v * dt / 4;
      }
      if (Math.abs(s.v) < 0.002 && Math.abs(s.p - s.to) < 0.0005) { s.p = s.to; s.v = 0; s.live = false; }
      return true;
    };

    var paint = function () {
      for (var i = 0; i < chips.length; i++) {
        var m = state[i];
        chips[i].style.transform = 'translateX(' + m.x.p.toFixed(2) + 'px) scale(' +
          m.sx.p.toFixed(4) + ',' + m.sy.p.toFixed(4) + ')';
      }
    };

    var tick = function (now) {
      var dt = Math.min(0.032, (now - last) / 1000 || 0.016);
      last = now;
      var any = false;
      state.forEach(function (m) {
        if (step(m.x, now, dt)) any = true;
        if (step(m.sx, now, dt)) any = true;
        if (step(m.sy, now, dt)) any = true;
      });
      paint();
      frame = any ? window.requestAnimationFrame(tick) : 0;
    };

    var chosen = -2;
    var apply = function (sel, instant) {
      if (!on || sel === chosen) return;
      chosen = sel;
      var now = window.performance.now();
      var push = sel < 0 ? 0 : (widths[sel] || 0) * J.swell / 2 + J.barge;
      var flying = state.some(function (m) { return m.x.live || m.sx.live || m.sy.live; });
      for (var i = 0; i < chips.length; i++) {
        var m = state[i];
        var far = sel < 0 ? 0 : Math.abs(i - sel);
        var x = sel < 0 ? 0 : (i > sel ? 1 : i < sel ? -1 : 0) * push;
        var s = sel < 0 ? 1 : (i === sel ? 1 + J.swell : 1 - J.shrink);
        if (instant) { jump(m.x, x); jump(m.sx, s); jump(m.sy, s); continue; }
        var k = J.stiffness * (1 - 0.12 * Math.min(far, 3));
        var delay = flying ? 0 : far * J.stagger;
        var j = J.jelly;
        aim(m.x, x, k, 0.9, J.bounce, delay, now);
        aim(m.sx, s, k * (1 + 0.24 * j), 0.9 - 0.1 * j, Math.min(0.85, J.bounce + 0.3 * j), delay, now);
        aim(m.sy, s, k * (1 - 0.14 * j), 0.9 + 0.05 * j, J.bounce, delay + 50 * j, now);
      }
      if (instant) { paint(); return; }
      if (!frame) { last = now; frame = window.requestAnimationFrame(tick); }
    };

    // offsetWidth ignores transforms, so this reads the resting width.
    var measure = function () { widths = chips.map(function (a) { return a.offsetWidth; }); };

    var sync = function () {
      var want = wideMq.matches && !stillMq.matches;
      if (want === on) { if (on) { measure(); var c = chosen; chosen = -2; apply(c, true); } return; }
      on = want;
      if (on) { measure(); chosen = -2; apply(home, true); }
      else {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0; chosen = -2;
        chips.forEach(function (a) { a.style.transform = ''; });
      }
    };

    var indexOf = function (el) {
      var a = el && el.closest ? el.closest('a') : null;
      return a ? chips.indexOf(a) : -1;
    };
    row.addEventListener('pointerover', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      var i = indexOf(e.target);
      if (i > -1) apply(i, false);
    });
    row.addEventListener('pointerleave', function () { apply(home, false); });
    row.addEventListener('focusin', function (e) { var i = indexOf(e.target); if (i > -1) apply(i, false); });
    row.addEventListener('focusout', function (e) {
      if (e.relatedTarget && row.contains(e.relatedTarget)) return;
      apply(home, false);
    });

    [wideMq, stillMq].forEach(function (q) {
      if (q.addEventListener) q.addEventListener('change', sync);
      else if (q.addListener) q.addListener(sync);
    });
    window.addEventListener('resize', sync);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync);
    sync();
  }

  /* ---- Accordions ----
     Markup: <button class="acc-btn" aria-expanded aria-controls="id">
             <div class="acc-panel" id="id" hidden>
     Panels start open in the HTML so the content is present without JS;
     this closes all but the first on load. */
  /* The markup groups accordions under .faq-card (page FAQs) and .qa
     (sidecard quick answers); .acc is kept for any future group. Matching
     only .acc bound nothing at all, which left every panel frozen. */
  document.querySelectorAll('.acc, .faq-card, .qa').forEach(function (acc) {
    var buttons = acc.querySelectorAll('.acc-btn');

    buttons.forEach(function (btn, i) {
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!panel) return;

      // First item open, rest closed.
      var open = i === 0;
      btn.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      var mark = btn.querySelector('.acc-mark');
      if (mark) mark.textContent = open ? '−' : '+';

      btn.addEventListener('click', function () {
        var isOpen = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!isOpen));
        panel.hidden = isOpen;
        if (mark) mark.textContent = isOpen ? '+' : '−';
      });
    });
  });

  /* ---- Library view bar ----
     On a phone the bar is one horizontal track, and the active view can sit
     a long way along it. Nudging the track, rather than calling
     scrollIntoView, avoids yanking the page vertically as a side effect. */
  var bar = document.querySelector('.libbar');
  if (bar) {
    var active = bar.querySelector('[aria-current="page"]');
    if (active && bar.scrollWidth > bar.clientWidth) {
      var lead = active.offsetLeft - 16;
      var trail = active.offsetLeft + active.offsetWidth + 16 - bar.clientWidth;
      bar.scrollLeft = Math.max(0, Math.min(Math.max(lead, trail), bar.scrollWidth - bar.clientWidth));
    }
  }

  /* ---- Section spy ----
     Marks the table-of-contents entry for the section being read.
     aria-current is the attribute the state actually is, so it reaches
     assistive technology for free. It is a state, not an animation, so it
     lives here rather than in motion.js and works with motion turned off. */
  var prose = document.querySelector('.artwrap .prose');
  var toc = document.querySelector('.toc');
  var heads = prose ? prose.querySelectorAll('h2[id]') : [];
  if (toc && heads.length) {
    var tocLinks = {};
    Array.prototype.forEach.call(toc.querySelectorAll('a[href^="#"]'), function (a) {
      tocLinks[a.getAttribute('href').slice(1)] = a;
    });
    var current = null, ticking = false;
    var measure = function () {
      ticking = false;
      var line = (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'), 10) || 76) + 24;
      var found = null;
      for (var j = 0; j < heads.length; j++) {
        if (heads[j].getBoundingClientRect().top <= line) found = heads[j].id;
        else break;
      }
      if (found === current) return;
      if (current && tocLinks[current]) tocLinks[current].removeAttribute('aria-current');
      if (found && tocLinks[found]) tocLinks[found].setAttribute('aria-current', 'true');
      current = found;
    };
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    measure();
  }

  /* ---- Motion failsafe, the fast path ----
     The head script hides reveal targets and gives motion.js 2.6s to take
     over. If the page has finished loading and GSAP is not there, it is
     not coming, so there is no reason to make the reader wait it out. */
  window.addEventListener('load', function () {
    if (window.gsap) return;
    var el = document.documentElement;
    el.className = el.className.replace(/ ?js-motion/, '');
    if (window.rhMotionFail) { window.clearTimeout(window.rhMotionFail); window.rhMotionFail = null; }
  });
})();
