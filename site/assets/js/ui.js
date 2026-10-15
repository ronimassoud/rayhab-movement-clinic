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
      // A press inside the bar is settled by its click, not by focus. On
      // iOS, iPadOS and Safari a button does not take focus when tapped, so
      // tapping the toggle to close blurred the focused menu link with no
      // relatedTarget: focusout closed the menu, then the click toggled it
      // straight back open, and the menu could not be closed. While a
      // pointer is down inside the bar, focusout stands aside.
      var pressing = false;
      nav.addEventListener('pointerdown', function () { pressing = true; }, true);
      var release = function () { window.setTimeout(function () { pressing = false; }, 0); };
      document.addEventListener('pointerup', release, true);
      document.addEventListener('pointercancel', release, true);

      nav.addEventListener('focusout', function (e) {
        if (!isOpen() || pressing) return;
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
    // The row's labels. Education and its Scoliosis dropdown count as one
    // label, the Education link: the dropdown hangs below it and is not part
    // of the row. On a scoliosis page Education is the current section, so
    // it is the label that stands proud at rest.
    var chips = [];
    Array.prototype.forEach.call(row.children, function (el) {
      var a = el.classList.contains('nav-drop') ? el.querySelector('a') : el;
      if (a && a.tagName === 'A') chips.push(a);
    });
    var home = -1;
    chips.forEach(function (a, i) {
      var drop = a.parentElement && a.parentElement.classList.contains('nav-drop') ? a.parentElement : null;
      if (a.getAttribute('aria-current') === 'page' || (drop && drop.querySelector('[aria-current="page"]'))) home = i;
    });

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
      // Inside the dropdown, the label that owns it stays the chosen one.
      var drop = el && el.closest ? el.closest('.nav-drop') : null;
      if (drop) a = drop.querySelector('a');
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
              'a.svc-primary, .svcidx-primary.is-linked, .navcard, .startlist a, .portrait, .btn, .pc-btn';
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
        // A light sized for a card would flood a button, so --spot-size
        // can shrink it per element.
        size: parseFloat(cs.getPropertyValue('--spot-size')) || SIZE,
        x: 0, y: 0, presence: 0, flare: 0, pressed: false, drawn: ''
      };
      cards.push(el._spot);
      io.observe(el);
    };
    Array.prototype.forEach.call(document.querySelectorAll(SEL), register);

    var paint = function (s) {
      var size = s.size * (1 + 0.2 * s.flare), boost = 1 + 0.7 * s.flare;
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

  /* ---- Tap feedback on touch screens ----
     Phones and tablets get no hover, so the cursor glow never shows there.
     Every button answers a tap instead: a ripple spreads from where the
     finger landed, in the button's own text color, and the button presses
     in and springs back. Touch and pen only, so a mouse keeps the glow;
     nothing with reduced motion, and nothing on a disabled button. The
     ripple sits in its own clipped layer, so the button's layout and
     outline are untouched. */
  (function () {
    var TAP = '.btn, button, [role="button"], .pc-btn, .bk-type, .slot-btn';
    var still = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    // iOS only shows :active on elements with a touch listener in their path.
    document.addEventListener('touchstart', function () {}, { passive: true });
    document.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (still && still.matches) return;
      var el = e.target.closest && e.target.closest(TAP);
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || !el.animate) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      var layer = document.createElement('span');
      layer.className = 'tap-layer';
      layer.setAttribute('aria-hidden', 'true');
      var dot = document.createElement('span');
      dot.className = 'tap-ripple';
      var x = e.clientX - r.left, y = e.clientY - r.top;
      var reach = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
      dot.style.left = x + 'px'; dot.style.top = y + 'px';
      dot.style.width = dot.style.height = (reach * 2) + 'px';
      layer.appendChild(dot);
      el.appendChild(layer);
      // The spread eases out; the fade holds, then lets go, so the ripple is
      // seen at full size before it goes.
      dot.animate([{ transform: 'translate(-50%, -50%) scale(0)' }, { transform: 'translate(-50%, -50%) scale(1)' }],
                  { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' });
      var fade = dot.animate([{ opacity: 0.24 }, { opacity: 0.24, offset: 0.45 }, { opacity: 0 }],
                             { duration: 680, easing: 'linear', fill: 'forwards' });
      fade.onfinish = fade.oncancel = function () { if (layer.parentNode) layer.parentNode.removeChild(layer); };
      // The press uses the individual scale property, so it never fights a
      // button's own transform.
      el.animate([{ scale: '1' }, { scale: '0.96', offset: 0.35 }, { scale: '1' }],
                 { duration: 320, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1.4)' });
    }, { passive: true });
  })();

  /* ---- Floating cards (.float-card) ----
     The card leans toward the cursor, up to 6 degrees, and lifts 6px, then
     settles back when the cursor leaves. The same lean the case cards had,
     on one listener per card. Fine pointers only, never with reduced
     motion; elsewhere the card simply stays put. bindFloat() is also used
     by the case coverflow for the cards it builds, with a test that pauses
     the lean while the row is being dragged. */
  var bindFloat = function () {};
  (function () {
    if (!window.matchMedia || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    var still = window.matchMedia('(prefers-reduced-motion: reduce)');
    bindFloat = function (card, paused) {
      var raf = 0, ev = null;
      var apply = function () {
        raf = 0;
        if (!ev || still.matches || (paused && paused())) return;
        var r = card.getBoundingClientRect();
        var nx = (ev.clientX - r.left) / r.width - 0.5, ny = (ev.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--ry', (nx * 6).toFixed(2) + 'deg');
        card.style.setProperty('--rx', (-ny * 5).toFixed(2) + 'deg');
        card.style.setProperty('--lift', '-6px');
      };
      card.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        ev = e;
        card.classList.add('is-tracking');
        if (!raf) raf = window.requestAnimationFrame(apply);
      });
      card.addEventListener('pointerleave', function () {
        ev = null;
        card.classList.remove('is-tracking');
        card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); card.style.removeProperty('--lift');
      });
    };
    Array.prototype.forEach.call(document.querySelectorAll('.float-card'), function (card) { bindFloat(card); });
  })();

  /* ---- Case coverflow (results.html) ----
     After React Bits Pro's Prism Carousel, without WebGL. A pool of eight
     slots is laid out every frame around a continuous position p, counted
     in cases; the case under p is large and in colour, and each slot shows
     the case at its index, wrapping, so the row has no ends. A case comes
     into colour as it reaches the centre and greys as it leaves. It moves on
     every 4.5 seconds while it is on screen and nobody is pointing at it,
     focused on it or reading its caption. It stops for good, with the
     play button to restart it, once someone takes over: a drag, a click, a
     key, an arrow or a #case-0N link. Reduced motion gets no autoplay and
     moves without easing. The caption under the
     controls is the written case for the centre. */
  var prism = document.querySelector('.prism .pc');
  if (prism) (function () {
    var stage = prism.querySelector('.pc-stage');
    var srcs = Array.prototype.slice.call(prism.querySelectorAll('.pc-card'));
    var panel = prism.querySelector('.pc-details');
    var details = panel ? Array.prototype.slice.call(panel.querySelectorAll('.case-detail')) : [];
    var countI = prism.querySelector('.pc-i');
    var playBtn = prism.querySelector('.pc-play');
    var n = srcs.length;
    if (!stage || !n) return;
    var reduceQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduce = function () { return !!(reduceQ && reduceQ.matches); };

    var SIZE = 0.86;            // centre height, as a share of the stage
    var NEIGHBOUR = 0.66;       // neighbours' height against the centre
    var WIDTH = [0, 0.72, 0.24, 0.12];   // neighbours' width against their height, by distance
    var SPAN = 3;               // slots drawn either side of the centre
    var GAP = 14, RADIUS = 18, DIM = 0.2;
    var INTERVAL = 4500;
    var K = 120, C = 2 * Math.sqrt(K);   // a critically damped spring, in cases

    var data = srcs.map(function (a) {
      var q = function (s) { var e = a.querySelector(s); return e ? e.textContent : ''; };
      return { id: a.getAttribute('data-case'), aspect: parseFloat(a.getAttribute('data-aspect')) || 0.8,
               media: a.querySelector('.pc-media'), n: q('.pc-n'), t: q('.pc-t'), c: q('.pc-c') };
    });
    var mod = function (k, m) { return ((k % m) + m) % m; };

    var POOL = 2 * SPAN + 2;
    var pool = [];
    for (var s = 0; s < POOL; s++) {
      var el = document.createElement('div');
      el.className = 'pc-item';
      // The sheet itself sits in .pc-float, which floats like the other
      // cards; the slot around it only carries the layout.
      el.innerHTML = '<div class="pc-float float-card"><div class="pc-layer pc-grey"></div><div class="pc-layer pc-colour"></div></div>';
      stage.appendChild(el);
      var face = el.firstChild;
      bindFloat(face, function () { return !!dragging; });
      pool.push({ el: el, grey: face.children[0], colour: face.children[1], k: null, item: -1 });
    }
    var fill = function (slot, i) {
      if (slot.item === i) return;
      slot.item = i;
      slot.grey.textContent = ''; slot.colour.textContent = '';
      slot.grey.appendChild(data[i].media.cloneNode(true));
      slot.colour.appendChild(data[i].media.cloneNode(true));
    };
    prism.classList.add('is-live');
    prism.tabIndex = 0;

    var H = 0;
    var measure = function () { H = stage.clientHeight * SIZE; };
    var widthAt = function (j, i) { return j === 0 ? H * data[i].aspect : j <= SPAN ? H * NEIGHBOUR * WIDTH[j] : 0; };
    var lerp = function (a, b, f) { return a + (b - a) * f; };

    var p = 0, v = 0, target = 0, dragging = null, onScreen = false, raf = 0, last = 0;

    var layout = function (now) {
      var k0 = Math.floor(p), f = p - k0, k, slot;
      var w = {}, h = {}, x = {}, slots = {};
      for (k = k0 - SPAN; k <= k0 + SPAN + 1; k++) {
        slot = pool[mod(k, POOL)]; slots[k] = slot;
        var i = mod(k, n), a = Math.abs(k - p);
        slot.k = k;
        fill(slot, i);
        var j = Math.floor(a);
        w[k] = lerp(widthAt(j, i), widthAt(j + 1, i), a - j);
        h[k] = lerp(H, H * NEIGHBOUR, Math.min(1, a));
        slot.a = a;
      }
      var gap = function (k1, k2) { return GAP * Math.min(1, Math.min(w[k1], w[k2]) / 12); };
      x[k0] = -f * (w[k0] / 2 + gap(k0, k0 + 1) + w[k0 + 1] / 2);
      for (k = k0 + 1; k <= k0 + SPAN + 1; k++) x[k] = x[k - 1] + w[k - 1] / 2 + gap(k - 1, k) + w[k] / 2;
      for (k = k0 - 1; k >= k0 - SPAN; k--) x[k] = x[k + 1] - w[k + 1] / 2 - gap(k, k + 1) - w[k] / 2;

      for (k = k0 - SPAN; k <= k0 + SPAN + 1; k++) {
        slot = slots[k];
        var st = slot.el.style, a2 = slot.a;
        if (w[k] < 1) { st.visibility = 'hidden'; continue; }
        st.visibility = '';
        st.width = w[k].toFixed(2) + 'px';
        st.height = h[k].toFixed(2) + 'px';
        st.transform = 'translate3d(' + (x[k] - w[k] / 2).toFixed(2) + 'px,' + (-h[k] / 2).toFixed(2) + 'px,0)';
        st.borderRadius = (RADIUS * h[k] / H).toFixed(1) + 'px';
        st.zIndex = String(10 - Math.round(a2));
        slot.el.classList.toggle('is-active', a2 < 0.5);

        st.setProperty('--co', Math.max(0, Math.min(1, 1 - a2 * 1.6)).toFixed(3));
        st.setProperty('--b', Math.max(0.35, 1 - DIM * a2 * 1.4).toFixed(3));
      }
    };

    var frame = function (now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!dragging) {
        if (reduce()) { p = target; v = 0; }
        else {
          v += (K * (target - p) - C * v) * dt;
          p += v * dt;
          if (Math.abs(target - p) < 0.0005 && Math.abs(v) < 0.002) { p = target; v = 0; }
        }
      }
      layout(now);
      raf = (dragging || p !== target || v !== 0) ? window.requestAnimationFrame(frame) : 0;
    };
    var wake = function () {
      if (raf) return;
      last = window.performance.now();
      raf = window.requestAnimationFrame(frame);
    };

    /* -- The case on show: counter, caption, the address -- */
    var shown = -1;
    var show = function (user) {
      var i = mod(target, n);
      if (i === shown) return;
      var first = shown < 0;
      shown = i;
      var d = data[i];
      countI.textContent = (i < 9 ? '0' : '') + (i + 1);
      if (user && panel) panel.setAttribute('aria-live', 'polite');
      details.forEach(function (art) {
        var on = art.id === d.id, was = !art.hidden;
        art.hidden = !on;
        if (on && !was && !first && art.animate && !reduce()) {
          art.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
                      { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
        }
      });
      if (user && window.history && history.replaceState) history.replaceState(null, '', '#' + d.id);
    };
    var go = function (to, user) {
      target = to;
      if (user) stopAuto();
      show(user);
      wake();
    };
    var openCase = function () {
      if (!panel) return;
      var r = panel.getBoundingClientRect();
      if (r.top > window.innerHeight - 120 || r.bottom < 80) panel.scrollIntoView({ block: 'start', behavior: reduce() ? 'auto' : 'smooth' });
    };

    /* -- Autoplay -- */
    var playing = true, hover = 0, focusIn = false, elapsed = 0;
    var setPlaying = function (on) {
      playing = on; elapsed = 0;
      if (playBtn) {
        playBtn.setAttribute('aria-pressed', String(!on));
        playBtn.setAttribute('aria-label', on ? 'Pause the carousel' : 'Play the carousel');
      }
    };
    var stopAuto = function () { if (playing) setPlaying(false); };
    if (playBtn) playBtn.addEventListener('click', function () {
      setPlaying(!playing);
      if (playing && panel) panel.setAttribute('aria-live', 'off');
    });
    window.setInterval(function () {
      if (!playing || reduce() || !onScreen || hover || focusIn || dragging || document.hidden) return;
      elapsed += 250;
      if (elapsed >= INTERVAL) { elapsed = 0; go(target + 1, false); }
    }, 250);
    prism.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hover = 1; });
    prism.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hover = 0; });
    prism.addEventListener('focusin', function (e) { if (e.target !== playBtn) focusIn = true; });
    prism.addEventListener('focusout', function () { focusIn = false; });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].intersectionRatio >= 0.5;
        if (onScreen) wake();
      }, { threshold: [0, 0.5, 1] }).observe(stage);
    } else onScreen = true;

    /* -- Drag and swipe, with inertia and snapping; a click picks a case -- */
    var slotWidth = function () {
      var i = mod(Math.round(p), n);
      return widthAt(0, i) / 2 + GAP + widthAt(1, i) / 2;
    };
    stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      dragging = { x: e.clientX, p: p, lastX: e.clientX, t: window.performance.now(), id: e.pointerId, moved: false, vel: 0,
                   hit: e.target.closest ? e.target.closest('.pc-item') : null };
      v = 0;
      wake();
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== dragging.id) return;
      var dx = e.clientX - dragging.x;
      if (!dragging.moved) {
        if (Math.abs(dx) < 6) return;
        dragging.moved = true;
        stage.classList.add('is-dragging');
        if (stage.setPointerCapture) { try { stage.setPointerCapture(dragging.id); } catch (x) {} }
      }
      var now = window.performance.now(), sw = slotWidth();
      p = dragging.p - dx / sw;
      var inst = -((e.clientX - dragging.lastX) / sw) / Math.max(0.001, (now - dragging.t) / 1000);
      dragging.vel = dragging.vel * 0.6 + inst * 0.4;
      dragging.lastX = e.clientX; dragging.t = now;
    });
    var release = function (e, cancelled) {
      if (!dragging || (e && e.pointerId !== dragging.id)) return;
      var d = dragging;
      dragging = null;
      stage.classList.remove('is-dragging');
      if (d.moved) {
        var aim = Math.round(p + Math.max(-2.5, Math.min(2.5, d.vel * 0.22)));
        aim = Math.max(Math.round(d.p) - 2, Math.min(Math.round(d.p) + 2, aim));
        v = reduce() ? 0 : d.vel;
        go(aim, true);
        return;
      }
      if (cancelled || !d.hit) { wake(); return; }
      var slot = pool.filter(function (q) { return q.el === d.hit; })[0];
      if (!slot) return;
      if (Math.round(slot.k) === target) { stopAuto(); openCase(); }
      else go(slot.k, true);
    };
    window.addEventListener('pointerup', function (e) { release(e, false); });
    window.addEventListener('pointercancel', function (e) { release(e, true); });

    // Sideways scrolling moves one case per gesture; up and down stays with the page.
    var wheelLock = 0;
    stage.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 4) return;
      e.preventDefault();
      var now = window.performance.now();
      if (now < wheelLock) { wheelLock = now + 220; return; }
      wheelLock = now + 220;
      go(target + (e.deltaX > 0 ? 1 : -1), true);
    }, { passive: false });

    /* -- Keys and buttons -- */
    prism.addEventListener('keydown', function (e) {
      if (e.target !== prism) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(target + 1, true); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(target - 1, true); }
      else if (e.key === 'Enter') { e.preventDefault(); stopAuto(); openCase(); }
    });
    Array.prototype.forEach.call(prism.querySelectorAll('.pc-btn[data-dir]'), function (b) {
      b.addEventListener('click', function () { go(target + (parseInt(b.getAttribute('data-dir'), 10) || 1), true); });
    });

    /* -- Start: the case in the address, or the featured one -- */
    var fromHash = function () {
      var id = (location.hash || '').slice(1);
      var i = data.map(function (d) { return d.id; }).indexOf(id);
      if (i < 0) return false;
      stopAuto();
      var k = target + ((i - mod(target, n)) % n);
      target = p = k; v = 0;
      show(false);
      wake();
      prism.closest('section').scrollIntoView({ block: 'start' });
      return true;
    };
    measure();
    if (!fromHash()) show(false);
    layout(window.performance.now());
    window.addEventListener('hashchange', fromHash);
    window.addEventListener('resize', function () { measure(); layout(window.performance.now()); wake(); });
    if (reduceQ && reduceQ.addEventListener) reduceQ.addEventListener('change', wake);
  })();

  /* ---- Accordions ----
     Markup: <button class="acc-btn" aria-expanded aria-controls="id">
             <div class="acc-panel" id="id" hidden>
     Panels start open in the HTML so the content is present without JS;
     this closes all but the first on load. */
  /* The markup groups accordions under .faq-card (page FAQs) and .qa
     (sidecard quick answers); .acc is kept for any future group. Matching
     only .acc bound nothing at all, which left every panel frozen. */
  /* FAQ sections (.faq-card) and the sidecard quick answers (.qa) keep one
     answer open at a time: opening a question closes whichever was open, so
     the group never grows into a wall of text.
     Panels slide by height rather than appearing at once. The one closing
     and the one opening run together on the same curve, so the group
     changes height in a single smooth move instead of jumping and then
     settling. A click mid-slide picks up from wherever the panel is. With
     reduced motion they simply show and hide. */
  var accReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var ACC_MS = 480, ACC_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
  var slide = function (panel, open) {
    if (!open && panel.hidden && !panel._slide) return;
    var cs = window.getComputedStyle(panel);
    var from = panel.hidden ? { h: 0, pt: 0, pb: 0, o: 0 }
      : { h: panel.getBoundingClientRect().height, pt: parseFloat(cs.paddingTop), pb: parseFloat(cs.paddingBottom), o: parseFloat(cs.opacity) };
    if (panel._slide) { panel._slide.cancel(); panel._slide = null; }
    panel.hidden = false;
    if (!panel.animate || (accReduce && accReduce.matches)) { panel.hidden = !open; return; }
    var rest = window.getComputedStyle(panel);
    var to = open ? { h: panel.scrollHeight, pt: parseFloat(rest.paddingTop), pb: parseFloat(rest.paddingBottom), o: 1 }
      : { h: 0, pt: 0, pb: 0, o: 0 };
    panel.style.overflow = 'hidden';
    var a = panel.animate([
      { height: from.h + 'px', paddingTop: from.pt + 'px', paddingBottom: from.pb + 'px', opacity: from.o },
      { height: to.h + 'px', paddingTop: to.pt + 'px', paddingBottom: to.pb + 'px', opacity: to.o }
    ], { duration: ACC_MS, easing: ACC_EASE });
    panel._slide = a;
    a.onfinish = function () {
      panel._slide = null;
      panel.style.overflow = '';
      if (!open) panel.hidden = true;
    };
  };

  document.querySelectorAll('.acc, .faq-card, .qa').forEach(function (acc) {
    var buttons = Array.prototype.slice.call(acc.querySelectorAll('.acc-btn'));
    var single = acc.classList.contains('faq-card') || acc.classList.contains('qa');

    var set = function (btn, open, animate) {
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!panel) return;
      btn.setAttribute('aria-expanded', String(open));
      if (animate) slide(panel, open); else panel.hidden = !open;
      var mark = btn.querySelector('.acc-mark');
      if (mark) mark.textContent = open ? '−' : '+';
    };

    buttons.forEach(function (btn, i) {
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!panel) return;
      // The slide replaces the stylesheet's fade-in, which stays for pages
      // without this script.
      panel.style.animation = 'none';

      // First item open, rest closed.
      set(btn, i === 0, false);

      btn.addEventListener('click', function () {
        var isOpen = btn.getAttribute('aria-expanded') === 'true';
        if (single && !isOpen) {
          buttons.forEach(function (other) {
            if (other !== btn && other.getAttribute('aria-expanded') === 'true') set(other, false, true);
          });
        }
        set(btn, !isOpen, true);
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
