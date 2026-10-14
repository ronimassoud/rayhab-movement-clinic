/* Rayhab, shared UI behaviour: mobile nav, accordions, library bar,
   section spy.
   Progressive enhancement: every control works as markup first. */
(function () {
  'use strict';

  /* ---- Mobile navigation ---- */
  var toggle = document.querySelector('.nav-toggle');
  var links = document.getElementById('navgroup');

  if (toggle && links) {
    var nav = toggle.closest ? toggle.closest('.site-nav') : null;

    function isOpen() { return toggle.getAttribute('aria-expanded') === 'true'; }

    function setOpen(open, moveFocus) {
      toggle.setAttribute('aria-expanded', String(open));
      links.classList.toggle('open', open);
      if (!open) { if (moveFocus) toggle.focus(); return; }
      // Opening left focus on the body, so a keyboard or screen-reader user
      // had to tab through the whole bar to reach the links they just asked
      // for. This is a disclosure rather than a modal, so focus moves in but
      // is not trapped.
      if (moveFocus) {
        var first = links.querySelector('a[href], button:not([disabled])');
        if (first) first.focus();
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
      setOpen(false, false);
    });

    // Reset state when the menu stops being a drawer.
    var mq = window.matchMedia('(min-width:1181px)');
    var reset = function (e) { if (e.matches) setOpen(false, false); };
    if (mq.addEventListener) mq.addEventListener('change', reset);
    else if (mq.addListener) mq.addListener(reset);
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
