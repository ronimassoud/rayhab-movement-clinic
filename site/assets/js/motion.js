/* Rayhab, scroll-linked scenes. Requires gsap + ScrollTrigger.

   Ships on results.html only. That page carries five discrete case studies
   over roughly six screens, which is the one place on the site where a
   reader genuinely loses track of where they are in a set.

   This file owns [data-scene] and nothing else. reveal.js owns
   [data-reveal] and never looks at [data-scene]. The two namespaces are
   disjoint on purpose: it is not possible for them to animate the same
   element and fight over its transform.

   The global prefers-reduced-motion kill-switch in rayhab.css neutralises
   CSS transitions and has no effect on the inline styles GSAP writes every
   frame, so this file has to check the preference itself. That duplication
   is exactly why reveals are not built on GSAP. */
(function () {
  'use strict';

  if (!window.gsap || !window.ScrollTrigger) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var scene = document.querySelector('[data-scene="cases"]');
  if (!scene) return;

  var grid = document.querySelector('.casegrid');
  var cases = document.querySelectorAll('.casegrid .case');
  if (!grid || cases.length < 2) return;

  gsap.registerPlugin(ScrollTrigger);

  /* ignoreMobileResize stops iOS Safari's collapsing address bar from
     firing a refresh mid-scroll, which is what makes scroll-linked work
     jump on a phone. limitCallbacks throttles onUpdate to actual changes. */
  ScrollTrigger.config({ ignoreMobileResize: true, limitCallbacks: true });

  var fill = scene.querySelector('.case-track-rail i');
  var num = scene.querySelector('.case-track-n b');
  var total = cases.length;

  var mm = gsap.matchMedia();

  /* Below 1061px the case grid is a single column and the strip would eat
     a third of a phone viewport for a progress bar. Nothing is registered
     there, so there is nothing to tear down either. */
  mm.add('(min-width: 1061px)', function () {

    scene.classList.add('is-live');

    var st = ScrollTrigger.create({
      trigger: grid,
      start: 'top center',
      end: 'bottom bottom',
      // A little smoothing, so the rail eases toward the scroll position
      // rather than tracking it exactly. This is the part that is genuinely
      // awkward to hand-roll and the reason the library is here.
      scrub: 0.5,
      invalidateOnRefresh: true,
      onUpdate: function (self) {
        gsap.set(fill, { scaleX: self.progress });

        /* A range, not a single number. Case 01 is a full-width feature and
           the other four sit two to a row, so for most of the scroll there
           is no one current case: 02 and 03 are side by side. Counting by
           scroll progress claimed "4 of 5" while 02 was still on screen,
           and taking the topmost claimed 3 while looking at 2. Reporting
           what is actually in view is the only version that is true. */
        var vh = window.innerHeight, first = 0, last = 0;
        for (var i = 0; i < total; i++) {
          var r = cases[i].getBoundingClientRect();
          if (r.bottom > vh * 0.3 && r.top < vh * 0.8) {
            if (!first) first = i + 1;
            last = i + 1;
          }
        }
        if (!first) return;                 // between rows, hold the last reading
        var label = first === last ? String(first) : first + '–' + last;
        if (num.firstChild.nodeValue !== label) num.firstChild.nodeValue = label;
      }
    });

    return function () {
      scene.classList.remove('is-live');
      gsap.set(fill, { clearProps: 'all' });
      st.kill();
    };
  });

  /* The display font loads with swap. When it lands, every heading height
     changes and every start and end measured before that point is wrong.
     This is the most likely cause of a mis-timed trigger on this site. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  }
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });

  /* While the booking dialog is open, html.modal-open sets overflow:hidden,
     which changes the scroller's height. Measuring in that window gives a
     stale layout and lands the scene wrong on close, so it pauses instead.
     Watching the class avoids reaching into modal.js for a hook. */
  var frozen = false;
  new MutationObserver(function () {
    var open = /modal-open/.test(document.documentElement.className);
    if (open === frozen) return;
    frozen = open;
    if (open) ScrollTrigger.getAll().forEach(function (t) { t.disable(false); });
    else {
      ScrollTrigger.getAll().forEach(function (t) { t.enable(false); });
      ScrollTrigger.refresh();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
})();
