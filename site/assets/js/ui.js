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

  /* ---- Spotlight on clickable cards ----
     After React Bits' SpotlightCard. A soft light follows the pointer across
     a card and its edge catches the light. The light reaches 80px past each
     card, so cards in a grid share one light. Pressing makes it swell.

     Only cards that are links or controls get it, which keeps the system's
     rule: a card that answers the cursor is a card you can click.

     One controller for the page, not one per card: a single set of
     listeners, and one animation loop that runs only while something is
     moving and stops once the light has settled. Each card gets two layers
     (a light under its content, a 1px ring over it) and takes its colours
     from CSS (--spot-color, --spot-fill, --spot-edge-color, --spot-rim).
     Fine pointers only; touch gets nothing. Under reduced motion the light
     snaps to the pointer instead of trailing it, and does not flare. */
  (function () {
    if (!window.matchMedia || !window.requestAnimationFrame || !window.IntersectionObserver) return;
    if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    var stillQ = window.matchMedia('(prefers-reduced-motion: reduce)');
    var SEL = 'a.edu-card, .routecard, a.router-card, a.svc-card, a.morecard, a.pidx, a.artcard, ' +
              '.pillar.is-linked, .supcard.is-linked, .consult-lead, .consult-alt, .bk-type, ' +
              'a.svc-primary, .svcidx-primary.is-linked, .navcard';
    var SIZE = 240, SOFTNESS = 0.7, PROXIMITY = 80, SMOOTHING = 0.3;
    var clampN = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

    // The component's gradient: a core, then a smoothstep blended with a
    // gaussian glow by `softness`.
    var falloff = function (color, softness) {
      var soft = clampN(softness, 0, 1);
      var core = Math.pow(1 - soft, 1.5) * 0.85;
      var stop = function (alpha, at) {
        return 'color-mix(in srgb, ' + color + ' ' + (alpha * 100).toFixed(2) + '%, transparent) ' + (at * 100).toFixed(2) + '%';
      };
      var list = [stop(1, 0)];
      for (var i = 0; i <= 14; i++) {
        var t = core + (1 - core) * i / 14;
        var g = (t - core) / (1 - core);
        var smooth = 1 - g * g * (3 - 2 * g);
        var glow = Math.exp(-4.6 * g * g) * (1 - Math.pow(g, 6));
        list.push(stop(smooth + (glow - smooth) * soft, t));
      }
      return list.join(', ');
    };
    var stopsCache = {};
    var stops = function (color, softness) {
      var key = color + '|' + softness;
      return stopsCache[key] || (stopsCache[key] = falloff(color, softness));
    };

    var cards = [], visible = [];
    var pointer = { x: 0, y: 0, active: false };
    var focusEl = null, raf = 0, last = 0;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var s = e.target._spot, at = visible.indexOf(s);
        if (e.isIntersecting && at < 0) visible.push(s);
        else if (!e.isIntersecting && at > -1) visible.splice(at, 1);
      });
      wake();
    });

    var register = function (el) {
      if (el._spot) return;
      var cs = getComputedStyle(el);
      var light = document.createElement('span'), edge = document.createElement('span');
      light.className = 'spot-light'; edge.className = 'spot-edge';
      light.setAttribute('aria-hidden', 'true'); edge.setAttribute('aria-hidden', 'true');
      el.insertBefore(light, el.firstChild);
      el.appendChild(edge);
      el.classList.add('spot');
      var color = cs.getPropertyValue('--spot-color').trim() || '#101C13';
      var rimColor = cs.getPropertyValue('--spot-edge-color').trim() || color;
      el._spot = {
        el: el, light: light, edge: edge,
        fill: stops(color, SOFTNESS), rim: stops(rimColor, 1),
        intensity: parseFloat(cs.getPropertyValue('--spot-fill')) || 0.05,
        glow: parseFloat(cs.getPropertyValue('--spot-rim')) || 0.45,
        x: 0, y: 0, presence: 0, flare: 0, pressed: false, drawn: ''
      };
      cards.push(el._spot);
      io.observe(el);
    };
    Array.prototype.forEach.call(document.querySelectorAll(SEL), register);

    var paint = function (s) {
      var size = SIZE * (1 + 0.2 * s.flare), boost = 1 + 0.7 * s.flare;
      var key = s.x.toFixed(1) + ',' + s.y.toFixed(1) + ',' + size.toFixed(1);
      if (key !== s.drawn) {
        s.drawn = key;
        s.light.style.background = 'radial-gradient(circle ' + size.toFixed(1) + 'px at ' + s.x.toFixed(1) + 'px ' +
          s.y.toFixed(1) + 'px, ' + s.fill + ')';
        s.edge.style.background = 'radial-gradient(circle ' + (size * 0.6).toFixed(1) + 'px at ' + s.x.toFixed(1) + 'px ' +
          s.y.toFixed(1) + 'px, ' + s.rim + ')';
      }
      s.light.style.opacity = String(Math.min(1, s.presence * s.intensity * boost));
      s.edge.style.opacity = String(Math.min(1, s.presence * s.glow * boost));
    };

    var tick = function (now) {
      raf = 0;
      var dt = clampN((now - last) / 1000, 0.001, 0.05);
      last = now;
      var reduce = stillQ.matches, busy = false;
      for (var i = 0; i < visible.length; i++) {
        var s = visible[i], r = s.el.getBoundingClientRect();
        var tx = s.x, ty = s.y, target = 0;
        if (focusEl && s.el.contains(focusEl)) {
          var b = focusEl.getBoundingClientRect();
          tx = b.left + b.width / 2 - r.left; ty = b.top + b.height / 2 - r.top; target = 1;
        } else if (pointer.active) {
          tx = pointer.x - r.left; ty = pointer.y - r.top;
          var gap = Math.hypot(Math.max(0, -tx, tx - r.width), Math.max(0, -ty, ty - r.height));
          target = gap === 0 ? 1 : Math.pow(Math.max(0, 1 - gap / PROXIMITY), 2);
        }
        if (target === 0 && s.presence === 0) continue;        // dark and staying dark
        if (s.presence < 0.02 && target > 0) { s.x = tx; s.y = ty; }   // arrive where the pointer is
        var follow = reduce ? 1 : 1 - Math.exp(-dt / (0.015 + SMOOTHING * 0.22));
        s.x += (tx - s.x) * follow; s.y += (ty - s.y) * follow;
        var fade = reduce ? 1 : 1 - Math.exp(-dt / (target > s.presence ? 0.1 : 0.32));
        s.presence += (target - s.presence) * fade;
        if (Math.abs(target - s.presence) < 0.002) s.presence = target;
        var press = s.pressed && !reduce ? 1 : 0;
        s.flare += (press - s.flare) * (1 - Math.exp(-dt / (press ? 0.05 : 0.28)));
        if (Math.abs(press - s.flare) < 0.002) s.flare = press;
        paint(s);
        if (Math.abs(tx - s.x) > 0.1 || Math.abs(ty - s.y) > 0.1 || s.presence !== target || s.flare !== press) busy = true;
      }
      if (busy) raf = window.requestAnimationFrame(tick);
    };
    var wake = function () {
      if (raf || !visible.length) return;
      last = window.performance.now();
      raf = window.requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
      wake();
    }, { passive: true });
    document.addEventListener('pointerout', function (e) {
      if (e.relatedTarget) return;            // still on the page
      pointer.active = false; wake();
    });
    // Cards that arrive later: the booking dialog is cloned in after load.
    // The first time the pointer reaches one, it and its siblings join.
    document.addEventListener('pointerover', function (e) {
      var c = e.target.closest && e.target.closest(SEL);
      if (!c || c._spot) return;
      var group = c.parentElement ? c.parentElement.querySelectorAll(SEL) : [c];
      Array.prototype.forEach.call(group, register);
      register(c);
    });
    document.addEventListener('pointerdown', function (e) {
      var c = e.target.closest && e.target.closest('.spot');
      if (c && c._spot) { c._spot.pressed = true; wake(); }
    });
    var release = function () {
      cards.forEach(function (s) { s.pressed = false; });
      wake();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    document.addEventListener('focusin', function (e) {
      var t = e.target;
      if (!(t instanceof Element) || !t.closest('.spot')) return;
      try { if (!t.matches(':focus-visible')) return; } catch (x) { /* older engines */ }
      focusEl = t; wake();
    });
    document.addEventListener('focusout', function () { focusEl = null; wake(); });
    window.addEventListener('scroll', function () { if (pointer.active) wake(); }, { capture: true, passive: true });
  })();

  /* ---- Case showcase (results.html) ----
     After React Bits Pro's Showcase 2. The track drags with the mouse and
     carries on with momentum when let go; touch uses the browser's own
     scrolling. A card leans towards the cursor in 3D. Choosing a card shows
     its written case in the panel below and puts its id in the address, so
     the link can be shared; arriving on #case-0N opens that case. Arrow keys
     move between cards. Without this, every case is simply listed. */
  var showcase = document.querySelector('.showcase');
  if (showcase) (function () {
    var track = showcase.querySelector('.sc-track');
    var cards = Array.prototype.slice.call(showcase.querySelectorAll('.sc-card'));
    var details = Array.prototype.slice.call(showcase.querySelectorAll('.case-detail'));
    var panel = showcase.querySelector('.sc-details');
    var arrows = Array.prototype.slice.call(showcase.querySelectorAll('.sc-arrow'));
    var reduceQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduce = function () { return !!(reduceQ && reduceQ.matches); };
    var fine = window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
    if (!track || !cards.length) return;

    var select = function (id, how) {
      how = how || {};
      var found = false;
      cards.forEach(function (c) {
        var on = c.getAttribute('data-case') === id;
        if (on) found = true;
        c.classList.toggle('is-on', on);
        c.setAttribute('aria-pressed', String(on));
      });
      if (!found) return false;
      details.forEach(function (d) {
        var on = d.id === id;
        var was = !d.hidden;
        d.hidden = !on;
        if (on && !was && how.animate && d.animate && !reduce()) {
          d.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
                    { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
        }
      });
      if (how.history && window.history && history.replaceState) history.replaceState(null, '', '#' + id);
      if (how.showCard) {
        var card = cards.filter(function (c) { return c.getAttribute('data-case') === id; })[0];
        if (card) track.scrollTo({ left: card.offsetLeft - track.offsetLeft - (parseFloat(getComputedStyle(track).paddingLeft) || 0), behavior: 'auto' });
      }
      if (how.showPanel) {
        var r = panel.getBoundingClientRect();
        if (r.top > window.innerHeight - 120 || r.bottom < 80) panel.scrollIntoView({ block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' });
      }
      return true;
    };

    // The case in the address wins; otherwise the first.
    var fromHash = function () {
      var id = (location.hash || '').slice(1);
      if (/^case-\d+$/.test(id) && select(id, { showCard: true })) {
        showcase.scrollIntoView({ block: 'start' });
        return true;
      }
      return false;
    };
    if (!fromHash()) select(cards[0].getAttribute('data-case'));
    window.addEventListener('hashchange', fromHash);

    /* -- Drag with momentum (mouse and pen) -- */
    var drag = null, moved = false, vx = 0, coast = 0;
    var stopCoast = function () { if (coast) { window.cancelAnimationFrame(coast); coast = 0; } };
    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      stopCoast();
      drag = { x: e.clientX, left: track.scrollLeft, lastX: e.clientX, t: window.performance.now(), id: e.pointerId };
      moved = false; vx = 0;
    });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (!moved && Math.abs(dx) > 6) {
        moved = true;
        track.classList.add('is-dragging');
        if (track.setPointerCapture) { try { track.setPointerCapture(drag.id); } catch (x) {} }
      }
      if (!moved) return;
      track.scrollLeft = drag.left - dx;
      var now = window.performance.now();
      vx = (e.clientX - drag.lastX) / Math.max(1, now - drag.t);   // px per ms
      drag.lastX = e.clientX; drag.t = now;
    });
    var endDrag = function () {
      if (!drag) return;
      drag = null;
      if (!moved) return;
      if (reduce() || Math.abs(vx) < 0.05) { track.classList.remove('is-dragging'); return; }
      var last = window.performance.now();
      var step = function (now) {
        var dt = Math.min(32, now - last); last = now;
        track.scrollLeft -= vx * dt;
        vx *= Math.pow(0.94, dt / 16);
        if (Math.abs(vx) > 0.02) coast = window.requestAnimationFrame(step);
        else { coast = 0; track.classList.remove('is-dragging'); }
      };
      coast = window.requestAnimationFrame(step);
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    // A drag is not a click on the card it started on.
    track.addEventListener('click', function (e) {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
    }, true);

    /* -- Choosing a case -- */
    cards.forEach(function (c, i) {
      c.addEventListener('click', function () {
        select(c.getAttribute('data-case'), { animate: true, history: true, showPanel: true });
      });
      c.addEventListener('keydown', function (e) {
        var to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? cards.length - 1 : -1;
        if (to < 0 || to >= cards.length || to === i) return;
        e.preventDefault();
        cards[to].focus({ preventScroll: true });
        cards[to].scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' });
      });

      /* -- The 3D lean: towards the cursor, settling back on leave -- */
      if (!fine) return;
      c.addEventListener('pointermove', function (e) {
        if (moved || reduce()) return;
        var r = c.getBoundingClientRect();
        var nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
        c.classList.add('is-tracking');
        c.style.setProperty('--ry', (nx * 12).toFixed(2) + 'deg');
        c.style.setProperty('--rx', (-ny * 10).toFixed(2) + 'deg');
        c.style.setProperty('--lift', '-8px');
      });
      c.addEventListener('pointerleave', function () {
        c.classList.remove('is-tracking');
        c.style.removeProperty('--ry'); c.style.removeProperty('--rx'); c.style.removeProperty('--lift');
      });
    });

    /* -- Arrows: a card's width at a time, greyed at either end -- */
    var stepW = function () {
      var gap = parseFloat(getComputedStyle(track).columnGap) || 20;
      return cards[0].getBoundingClientRect().width + gap;
    };
    var ends = function () {
      var max = track.scrollWidth - track.clientWidth - 2;
      if (arrows[0]) arrows[0].disabled = track.scrollLeft <= 2;
      if (arrows[1]) arrows[1].disabled = track.scrollLeft >= max;
    };
    arrows.forEach(function (a) {
      a.addEventListener('click', function () {
        stopCoast();
        track.scrollBy({ left: (parseInt(a.getAttribute('data-dir'), 10) || 1) * stepW(), behavior: reduce() ? 'auto' : 'smooth' });
      });
    });
    track.addEventListener('scroll', ends, { passive: true });
    window.addEventListener('resize', ends);
    ends();
  })();

  /* ---- Accordions ----
     Markup: <button class="acc-btn" aria-expanded aria-controls="id">
             <div class="acc-panel" id="id" hidden>
     Panels start open in the HTML so the content is present without JS;
     this closes all but the first on load. */
  /* The markup groups accordions under .faq-card (page FAQs) and .qa
     (sidecard quick answers); .acc is kept for any future group. Matching
     only .acc bound nothing at all, which left every panel frozen. */
  /* FAQ sections (.faq-card) keep one answer open at a time: opening a
     question closes whichever was open, so the section never grows into a
     wall of text. The compact quick answers (.qa) still open independently. */
  document.querySelectorAll('.acc, .faq-card, .qa').forEach(function (acc) {
    var buttons = Array.prototype.slice.call(acc.querySelectorAll('.acc-btn'));
    var single = acc.classList.contains('faq-card');

    var set = function (btn, open) {
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!panel) return;
      btn.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      var mark = btn.querySelector('.acc-mark');
      if (mark) mark.textContent = open ? '−' : '+';
    };

    buttons.forEach(function (btn, i) {
      if (!document.getElementById(btn.getAttribute('aria-controls'))) return;

      // First item open, rest closed.
      set(btn, i === 0);

      btn.addEventListener('click', function () {
        var isOpen = btn.getAttribute('aria-expanded') === 'true';
        if (single && !isOpen) {
          buttons.forEach(function (other) { if (other !== btn) set(other, false); });
        }
        set(btn, !isOpen);
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
