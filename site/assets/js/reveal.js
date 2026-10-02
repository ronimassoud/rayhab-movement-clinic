/* Rayhab, scroll reveals, reading progress and section spy.

   No dependencies, and the motion itself is done with CSS transitions
   rather than per-frame JavaScript. That is deliberate: the global
   prefers-reduced-motion kill-switch in rayhab.css neutralises CSS
   transitions and has no effect on inline styles written from script, so
   anything animated in JS would need its own copy of the policy. Keeping
   reveals in CSS keeps that policy in one place.

   Markup API, so the Python generators can emit reveals without this file
   carrying a list of selectors:

     data-reveal                 fade and rise this element
     data-reveal="children"      stagger its direct children instead
     data-reveal-stagger="60"    ms between children (default 70)
     data-reveal-delay="120"     ms before the group starts (default 0)
     data-reveal-y="8"           px of travel (default 14; 0 fades only)

   Content is hidden only while <html> carries .js-motion, which an inline
   script in the head adds. If this file never runs, that script's failsafe
   drops the class and everything is simply visible. */
(function () {
  'use strict';

  var root = document.documentElement;

  function disarm() {
    if (window.rhMotionFail) {
      window.clearTimeout(window.rhMotionFail);
      window.rhMotionFail = null;
    }
  }

  /* Dropping the class makes every reveal rule stop matching, which leaves
     the page in its normal, fully visible state. This is the safe exit. */
  function release() {
    root.className = root.className.replace(/ ?js-motion/, '');
    disarm();
  }

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (!('IntersectionObserver' in window) || !/js-motion/.test(root.className) ||
      reduce.matches) {
    release();
    return;
  }

  /* ---------- Reveals ---------- */

  var SETTLE = 1200;   // comfortably past the longest stagger we emit

  function kidsOf(el) {
    return Array.prototype.slice.call(el.children);
  }

  /* Once an element has arrived, its data-reveal attribute comes off. The
     reveal rules tie with the card hover-lift rules on specificity and win
     on source order, so leaving them matching would silently kill the lift
     on every .pillar, .morecard, .pidx and linked card on the site. */
  function settle(el, children) {
    el.removeAttribute('data-reveal');
    el.style.transitionDelay = '';
    el.style.removeProperty('--rv-y');
    if (children) {
      children.forEach(function (k) { k.style.transitionDelay = ''; });
    }
    el.className = el.className.replace(/ ?rv-in/, '');
  }

  function show(el) {
    var children = el.getAttribute('data-reveal') === 'children' ? kidsOf(el) : null;
    var delay = parseInt(el.getAttribute('data-reveal-delay'), 10) || 0;

    if (children) {
      var step = parseInt(el.getAttribute('data-reveal-stagger'), 10);
      if (isNaN(step)) step = 70;
      children.forEach(function (k, i) {
        k.style.transitionDelay = (delay + i * step) + 'ms';
      });
    } else if (delay) {
      el.style.transitionDelay = delay + 'ms';
    }

    el.className += ' rv-in';
    window.setTimeout(function () { settle(el, children); }, SETTLE + delay);
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      show(e.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.01 });

  var targets = root.querySelectorAll('[data-reveal]');
  for (var i = 0; i < targets.length; i++) {
    var y = targets[i].getAttribute('data-reveal-y');
    if (y !== null) targets[i].style.setProperty('--rv-y', parseInt(y, 10) + 'px');
    io.observe(targets[i]);
  }
  disarm();

  /* If the setting is turned on while the page is open, stop hiding things. */
  var onReduce = function (e) { if (e.matches) release(); };
  if (reduce.addEventListener) reduce.addEventListener('change', onReduce);
  else if (reduce.addListener) reduce.addListener(onReduce);

  /* ---------- Measured angles count to their result ----------
     The four Cobb angles on the site are its only measured outcome, and
     they sit on the page as flat text. Counting the result down from the
     starting angle puts the eye on the change rather than on the number.

     The markup already contains the true final value, so this only ever
     animates towards what the page would show anyway. Nothing here invents
     a figure, and the screen-reader text is left alone. */
  var counters = document.querySelectorAll('.metric-now[data-count-from]');
  if (counters.length) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        cio.unobserve(e.target);
        count(e.target);
      });
    }, { threshold: 0.6 });
    for (var c = 0; c < counters.length; c++) cio.observe(counters[c]);
  }

  function count(el) {
    var suffix = el.textContent.replace(/[\d.]/g, '');
    var to = parseFloat(el.textContent);
    var from = parseFloat(el.getAttribute('data-count-from'));
    if (isNaN(to) || isNaN(from) || from === to) return;

    var DUR = 900;
    var t0 = 0;
    function frame(now) {
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / DUR);
      // Ease out, so it decelerates into the real figure rather than
      // stopping dead on it.
      var v = from + (to - from) * (1 - Math.pow(1 - p, 3));
      el.textContent = Math.round(v) + suffix;
      if (p < 1) window.requestAnimationFrame(frame);
      else el.textContent = to + suffix;   // land exactly, never on a rounding
    }
    window.requestAnimationFrame(frame);
  }

  /* ---------- Reading progress and section spy ---------- */

  var prose = document.querySelector('.artwrap .prose');
  var heads = prose ? prose.querySelectorAll('h2[id]') : [];
  if (!prose || !heads.length) return;

  var bar = document.createElement('div');
  bar.className = 'read-bar';
  bar.setAttribute('aria-hidden', 'true');
  bar.appendChild(document.createElement('span'));
  document.body.appendChild(bar);

  /* The table of contents is the same list of headings, so the spy marks
     the entry rather than duplicating the structure. aria-current is the
     honest attribute here: it is the item the reader is currently in. */
  var tocLinks = {};
  var toc = document.querySelector('.toc');
  if (toc) {
    Array.prototype.forEach.call(toc.querySelectorAll('a[href^="#"]'), function (a) {
      tocLinks[a.getAttribute('href').slice(1)] = a;
    });
  }

  var current = null;
  var ticking = false;

  function measure() {
    ticking = false;

    // Progress across the body text only. Running it over the whole
    // document would count the hero and the footer as reading.
    var box = prose.getBoundingClientRect();
    var start = box.top + window.pageYOffset;
    var span = Math.max(1, prose.offsetHeight - window.innerHeight * 0.5);
    var done = (window.pageYOffset - start) / span;
    root.style.setProperty('--read', Math.max(0, Math.min(1, done)).toFixed(4));

    if (!toc) return;

    // The heading the reader is in is the last one that has passed under
    // the nav. Reading the list directly is cheap at four to six headings
    // and avoids the ambiguity of overlapping observer thresholds.
    var line = (parseInt(getComputedStyle(root).getPropertyValue('--nav-h'), 10) || 80) + 24;
    var found = null;
    for (var j = 0; j < heads.length; j++) {
      if (heads[j].getBoundingClientRect().top <= line) found = heads[j].id;
      else break;
    }
    if (found === current) return;
    if (current && tocLinks[current]) tocLinks[current].removeAttribute('aria-current');
    if (found && tocLinks[found]) tocLinks[found].setAttribute('aria-current', 'true');
    current = found;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(measure);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  measure();
})();
