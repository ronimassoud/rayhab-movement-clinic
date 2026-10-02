/* Rayhab, shared UI behaviour: mobile nav + accordions.
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
})();
