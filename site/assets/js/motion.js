/* Rayhab, motion. Requires gsap and ScrollTrigger; uses SplitText if present.

   One module for every page except book.html. Scenes:

     reveals        [data-reveal] sections rise as they enter
     hero           floating cards and the photo fan settle into place
     headline       the home headline rises line by line (SplitText)
     tilt           fanned cards close from a wider spread as they scroll in
     nav            the floating pill steps aside going down, returns going up
     line art       the Cobb-angle drawing in the closing band draws with scroll
     process        the rule above each of the six stages fills in turn
     count          measured angles count to their result
     reading        progress across an article's body
     cases          where you are in the five case studies (results.html)

   Three rules hold for all of them.

   1. Nothing here is required. Content is hidden only while <html> carries
      .js-motion, which an inline script in the head adds and removes again
      after 2.6s unless this file disarms it. If GSAP is blocked, fails to
      parse or never arrives, the page is simply visible.

   2. The global prefers-reduced-motion switch in the stylesheet stops CSS
      transitions and cannot reach the inline styles GSAP writes each
      frame. So the preference is checked here, once, and every scene is
      registered inside gsap.matchMedia() on that query: if the setting is
      turned on while the page is open, GSAP reverts all of it.

   3. No scroll hijacking. normalizeScroll and ScrollSmoother are never
      used: either would break the fixed nav, the fixed booking bar and
      scrolling inside the booking dialog. */
(function () {
  'use strict';

  var root = document.documentElement;

  function release() {
    root.className = root.className.replace(/ ?js-motion/, '');
    if (window.rhMotionFail) { window.clearTimeout(window.rhMotionFail); window.rhMotionFail = null; }
  }

  if (!window.gsap || !window.ScrollTrigger || !/js-motion/.test(root.className)) { release(); return; }

  var gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(window.SplitText);

  /* ignoreMobileResize stops iOS Safari's collapsing address bar from firing
     a refresh mid-scroll, which is what makes scroll-linked work jump on a
     phone. limitCallbacks throttles onUpdate to actual changes. */
  ScrollTrigger.config({ ignoreMobileResize: true, limitCallbacks: true });

  var EASE = 'power3.out';
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  var mm = gsap.matchMedia();

  mm.add({
    motion: '(prefers-reduced-motion: no-preference)',
    desktop: '(min-width: 1061px)',
    phone: '(max-width: 700px)'
  }, function (ctx) {
    var c = ctx.conditions;
    if (!c.motion) { release(); return; }

    // From here the page is ours to reveal, so the failsafe stands down.
    if (window.rhMotionFail) { window.clearTimeout(window.rhMotionFail); window.rhMotionFail = null; }

    /* ---------- Reveals ----------
       The markup API is unchanged from the CSS version this replaces:
         data-reveal                 fade and rise this element
         data-reveal="children"      stagger its direct children instead
         data-reveal-stagger="60"    ms between children (default 70)
         data-reveal-delay="120"     ms before the group starts
         data-reveal-y="8"           px of travel (default 14)
       When an element has arrived its attribute and inline styles come off,
       so the hidden-state rule stops matching and nothing GSAP wrote is
       left to fight a hover style. */
    $$('[data-reveal]').forEach(function (el) {
      var kids = el.getAttribute('data-reveal') === 'children';
      var targets = kids ? Array.prototype.slice.call(el.children) : [el];
      var y = parseInt(el.getAttribute('data-reveal-y'), 10);
      if (isNaN(y)) y = 14;
      var step = parseInt(el.getAttribute('data-reveal-stagger'), 10);
      if (isNaN(step)) step = 70;
      // Down a single column a stagger is only a delay, so a phone gets the group at once.
      if (c.phone) step = 0;

      gsap.fromTo(targets, { opacity: 0, y: y }, {
        opacity: 1, y: 0, duration: 0.7, ease: EASE,
        delay: (parseInt(el.getAttribute('data-reveal-delay'), 10) || 0) / 1000,
        stagger: kids ? step / 1000 : 0,
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        onComplete: function () {
          el.removeAttribute('data-reveal');
          gsap.set(targets, { clearProps: 'opacity,transform,translate,rotate,scale' });
        }
      });
    });

    /* ---------- Hero ----------
       The headline and the standfirst are never hidden: on most pages the
       headline is the largest paint and hiding it would delay it. What
       moves is what floats: the tilted cards and the photo fan. */
    var floats = $$('.hero-card, .hero-shot, .measure-card');
    if (floats.length) {
      gsap.fromTo(floats, { opacity: 0, y: 28, scale: 0.94 }, {
        opacity: 1, y: 0, scale: 1, duration: 0.9, ease: EASE, stagger: 0.14, delay: 0.35,
        // Opacity stays inline: the stylesheet's starting pose still matches
        // while .js-motion is on <html>, and clearing it would hide them again.
        onComplete: function () { gsap.set(floats, { clearProps: 'transform,translate,rotate,scale' }); }
      });
    }

    var fan = $$('.tilt-fan img');
    if (fan.length === 3) {
      // Dealt from a closed stack: the outer two start square behind the middle one.
      // Position goes through --lift rather than y: a y tween would hand the
      // transform to GSAP, which folds the CSS lean into it and freezes it.
      gsap.fromTo(fan, { opacity: 0, '--lift': '40px' }, { opacity: 1, '--lift': '0px', duration: 0.8, ease: EASE, stagger: 0.09, delay: 0.2 });
      gsap.fromTo([fan[0], fan[2]], { '--tilt': '0deg' }, {
        '--tilt': function (i) { return i === 0 ? '-7deg' : '7deg'; },
        duration: 1.1, ease: 'power2.out', delay: 0.45
      });
    }

    /* ---------- Home headline ----------
       Lines rise from behind a mask. autoSplit re-splits when the display
       font swaps in, which changes where the lines break. The headline is
       held invisible by the stylesheet until this runs, so there is no
       flash of the finished line before it animates. */
    var h1 = $('.home-hero .d1');
    if (h1) {
      if (window.SplitText) {
        window.SplitText.create(h1, {
          type: 'lines', mask: 'lines', autoSplit: true,
          onSplit: function (self) {
            gsap.set(h1, { visibility: 'visible' });
            return gsap.from(self.lines, { yPercent: 105, duration: 0.9, ease: 'power4.out', stagger: 0.09 });
          }
        });
      } else {
        gsap.set(h1, { visibility: 'visible' });
      }
    }

    /* ---------- Tilted cards further down the page ----------
       The three quotes start spread wider and lower than they rest, and
       close up as the band scrolls in. Scrubbed, so it is tied to the
       reader's hand rather than to a clock. Desktop only: on a phone the
       cards are a plain column. */
    if (c.desktop) {
      var quotes = $$('.proof-grid > .tilt');
      if (quotes.length === 3) {
        gsap.fromTo([quotes[0], quotes[2]],
          { '--tilt': function (i) { return i === 0 ? '-11deg' : '11deg'; }, '--lift': '44px' },
          { '--tilt': function (i) { return i === 0 ? '-4deg' : '4deg'; }, '--lift': '0px', ease: 'none',
            scrollTrigger: { trigger: '.proof-grid', start: 'top 92%', end: 'top 45%', scrub: 0.6 } });
      }
    }

    /* ---------- Navigation ----------
       Out of the way while reading down, back the moment the reader turns
       round. It never hides while the card panel is open or while focus is
       inside it, so a keyboard user cannot lose the thing they are in. */
    var nav = $('.site-nav');
    if (nav) {
      var hidden = false;
      var show = function () {
        if (!hidden) return;
        hidden = false;
        gsap.to(nav, { yPercent: 0, duration: 0.45, ease: EASE, overwrite: 'auto' });
      };
      var hide = function () {
        if (hidden) return;
        if (nav.contains(document.activeElement) || nav.classList.contains('is-open')) return;
        hidden = true;
        gsap.to(nav, { yPercent: -140, duration: 0.35, ease: 'power2.in', overwrite: 'auto' });
      };
      ScrollTrigger.create({
        start: 0, end: 'max',
        onUpdate: function (self) {
          var y = self.scroll();
          nav.classList.toggle('is-stuck', y > 24);
          if (y < 320 || self.direction < 0) show();
          else if (self.direction > 0) hide();
        }
      });
      nav.addEventListener('focusin', show);
      var cleanupNav = function () { nav.removeEventListener('focusin', show); gsap.set(nav, { clearProps: 'transform' }); };
    }

    /* ---------- Line art in the closing band ----------
       The stylesheet paints the drawing as a background, which cannot be
       drawn stroke by stroke. With motion on, an inline copy replaces it
       and each stroke follows the scroll. */
    var band = $('.cta-band');
    if (band) {
      var NS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'cta-art');
      svg.setAttribute('viewBox', '0 0 280 280');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML =
        '<path pathLength="1" d="M30 80L250 66" stroke="#62E36B" stroke-width="1.2"/>' +
        '<path pathLength="1" d="M34 212L254 226" stroke="#62E36B" stroke-width="1.2"/>' +
        '<path pathLength="1" d="M140 30C100 92 186 148 132 254" stroke="#F5F3EC" stroke-width="2" stroke-linecap="round" opacity=".55"/>' +
        '<path class="cta-arc" d="M240 74A140 140 0 0 1 246 220" stroke="#62E36B" stroke-dasharray="3 6"/>';
      band.insertBefore(svg, band.firstChild);
      band.classList.add('has-art');
      var strokes = $$('path[pathLength]', svg);
      gsap.set(strokes, { strokeDasharray: 1, strokeDashoffset: 1 });
      gsap.timeline({ scrollTrigger: { trigger: band, start: 'top 85%', end: 'center 55%', scrub: 0.6 } })
        .to(strokes, { strokeDashoffset: 0, ease: 'none', stagger: 0.25 })
        .fromTo($('.cta-arc', svg), { opacity: 0 }, { opacity: 1, ease: 'none' }, '>-0.3');
    }

    /* ---------- The six stages ----------
       Each stage sits under a hairline. A second, heavier rule fills across
       it as the section passes, one stage after the next, so the row reads
       as a sequence being walked rather than six separate boxes. */
    var stages = $$('.stages .stage');
    if (stages.length && !c.phone) {
      gsap.fromTo(stages, { '--fill': 0 }, {
        '--fill': 1, ease: 'none', stagger: 0.5,
        scrollTrigger: { trigger: '.stages', start: 'top 80%', end: 'bottom 55%', scrub: 0.5 }
      });
    }

    /* ---------- Measured angles ----------
       The four Cobb angles are the site's only measured outcome. Counting
       the result down from the starting angle puts the eye on the change.
       The markup holds the true final value, so this only ever animates
       toward what the page would show anyway, and it lands on it exactly. */
    $$('.metric-now[data-count-from]').forEach(function (el) {
      var suffix = el.textContent.replace(/[\d.]/g, '');
      var to = parseFloat(el.textContent);
      var from = parseFloat(el.getAttribute('data-count-from'));
      if (isNaN(to) || isNaN(from) || from === to) return;
      var state = { v: from };
      gsap.to(state, {
        v: to, duration: 1, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 80%', once: true },
        onUpdate: function () { el.textContent = Math.round(state.v) + suffix; },
        onComplete: function () { el.textContent = to + suffix; }
      });
    });

    /* ---------- Reading progress ----------
       Across the body text only: counting the hero and the footer would
       report reading that is not happening. */
    var prose = $('.artwrap .prose');
    var bar = null;
    if (prose) {
      bar = document.createElement('div');
      bar.className = 'read-bar';
      bar.setAttribute('aria-hidden', 'true');
      bar.appendChild(document.createElement('span'));
      document.body.appendChild(bar);
      gsap.to(bar.firstChild, {
        scaleX: 1, ease: 'none',
        scrollTrigger: { trigger: prose, start: 'top 20%', end: 'bottom 60%', scrub: 0.3 }
      });
    }

    /* ---------- Case-study progress (results.html) ---------- */
    var scene = $('[data-scene="cases"]');
    var grid = $('.casegrid');
    var cases = $$('.casegrid .case');
    if (scene && grid && cases.length > 1 && c.desktop) {
      var fill = $('.case-track-rail i', scene);
      var num = $('.case-track-n b', scene);
      scene.classList.add('is-live');
      ScrollTrigger.create({
        trigger: grid, start: 'top center', end: 'bottom bottom', scrub: 0.5, invalidateOnRefresh: true,
        onUpdate: function (self) {
          gsap.set(fill, { scaleX: self.progress });
          /* A range, not a single number. Case 01 is a full-width feature
             and the other four sit two to a row, so for most of the scroll
             there is no one current case. Reporting what is actually in
             view is the only version that is true. */
          var vh = window.innerHeight, first = 0, last = 0;
          for (var i = 0; i < cases.length; i++) {
            var r = cases[i].getBoundingClientRect();
            if (r.bottom > vh * 0.3 && r.top < vh * 0.8) { if (!first) first = i + 1; last = i + 1; }
          }
          if (!first) return;
          var label = first === last ? String(first) : first + '–' + last;
          if (num.firstChild.nodeValue !== label) num.firstChild.nodeValue = label;
        }
      });
    }

    // matchMedia reverts every tween and trigger made above. These are the
    // things it cannot know about: nodes and classes this file added.
    return function () {
      if (scene) scene.classList.remove('is-live');
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      if (band) { band.classList.remove('has-art'); var a = $('.cta-art', band); if (a) band.removeChild(a); }
      if (cleanupNav) cleanupNav();
      if (h1) gsap.set(h1, { visibility: 'visible' });
    };
  });

  /* ---------- The card panel (below 1181px) ----------
     After React Bits' CardNav. ui.js owns the open state, focus and closing
     rules and calls window.rhNav.set(); this supplies the motion. The pill
     grows from its bar height to its content, the cards rise in after it,
     and closing runs the other way before the panel is hidden. Its own
     matchMedia, so crossing 1181px or changing the motion setting only
     rebuilds this, not every scene on the page. Without it (GSAP missing,
     reduced motion, desktop), ui.js toggles .is-open and the pill opens
     instantly. */
  mm.add('(prefers-reduced-motion: no-preference) and (max-width: 1180px)', function () {
    var nav = $('.site-nav'), panel = $('#navcards');
    if (!nav || !panel) return;
    var cards = $$('.navcard', panel);
    var barH = function () {
      return parseFloat(getComputedStyle(root).getPropertyValue('--nav-pill')) || 64;
    };

    window.rhNav = {
      set: function (open) {
        var from = nav.getBoundingClientRect().height;
        if (open) {
          nav.classList.add('is-open');
          gsap.set(nav, { height: 'auto' });
          var to = nav.getBoundingClientRect().height;   // the screen-height cap applies
          gsap.fromTo(nav, { height: from }, {
            height: to, duration: 0.45, ease: EASE, overwrite: 'auto',
            onComplete: function () { gsap.set(nav, { height: 'auto' }); }
          });
          gsap.fromTo(cards, { opacity: 0, y: 24 }, {
            opacity: 1, y: 0, duration: 0.45, ease: EASE, stagger: 0.08, delay: 0.1, overwrite: 'auto'
          });
        } else {
          gsap.to(cards, { opacity: 0, y: 10, duration: 0.18, ease: 'power2.in', overwrite: 'auto' });
          gsap.fromTo(nav, { height: from }, {
            height: barH(), duration: 0.36, ease: 'power3.inOut', overwrite: 'auto',
            onComplete: function () {
              nav.classList.remove('is-open');
              gsap.set(nav, { clearProps: 'height' });
              gsap.set(cards, { clearProps: 'opacity,transform' });
            }
          });
        }
      }
    };

    return function () {
      window.rhNav = null;
      gsap.set(nav, { clearProps: 'height' });
      gsap.set(cards, { clearProps: 'opacity,transform' });
    };
  });

  /* The display font loads with swap. When it lands, heading heights change
     and every start and end measured before that point is wrong. This is
     the most likely cause of a mis-timed trigger on this site. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  }
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });

  /* While the booking dialog is open, html.modal-open sets overflow:hidden,
     which changes the scroller's height. Measuring in that window gives a
     stale layout and lands scenes wrong on close, so everything pauses.
     Watching the class avoids reaching into modal.js for a hook. */
  var frozen = false;
  new MutationObserver(function () {
    var open = /modal-open/.test(root.className);
    if (open === frozen) return;
    frozen = open;
    if (open) ScrollTrigger.getAll().forEach(function (t) { t.disable(false); });
    else {
      ScrollTrigger.getAll().forEach(function (t) { t.enable(false); });
      ScrollTrigger.refresh();
    }
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
})();
