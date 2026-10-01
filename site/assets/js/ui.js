/* Rayhab, shared UI behaviour: mobile nav + accordions.
   Progressive enhancement: every control works as markup first. */
(function () {
  'use strict';

  /* ---- Mobile navigation ---- */
  var toggle = document.querySelector('.nav-toggle');
  var links = document.getElementById('navgroup');

  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      links.classList.toggle('open', !open);
    });

    // Close on Escape, returning focus to the toggle.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        toggle.setAttribute('aria-expanded', 'false');
        links.classList.remove('open');
        toggle.focus();
      }
    });

    // Reset state when the menu stops being a drawer.
    var mq = window.matchMedia('(min-width:1181px)');
    var reset = function (e) {
      if (e.matches) {
        toggle.setAttribute('aria-expanded', 'false');
        links.classList.remove('open');
      }
    };
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
})();
