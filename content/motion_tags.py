# -*- coding: utf-8 -*-
"""Inject the motion gate and reveal.js into a finished page.

Applied after formatting, exactly the way wrap_arrows() already is in all
three generators. That ordering matters: the gate script is almost entirely
braces, which would raise inside build_articles.py's and build_topics.py's
HEAD.format(), and build_services.py is one large '%'-formatted template.
Post-processing sidesteps both without escaping anything.

The same function serves the 9 hand-written pages, so the markup has one
definition and the two halves of the site cannot drift. check_links.py
asserts the result on every deploy.

book.html is excluded by construction: it carries no modal.js, which is the
anchor the script tag is inserted after. It is the no-JS booking fallback
and should stay the plainest page on the site.
"""

VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">'

# Runs before the stylesheets so the class is set before first paint, and
# touches no computed style so it forces no recalculation. The failsafe is
# the whole safety story: if reveal.js is blocked, fails to parse or never
# arrives, the class comes off by itself and the page is simply visible.
GATE = ('<script>!function(d,w){var e=d.documentElement,m=0;'
        'try{m=w.matchMedia("(prefers-reduced-motion: reduce)").matches}catch(x){}'
        'if(!m){e.className+=" js-motion";w.rhMotionFail=w.setTimeout(function(){'
        'e.className=e.className.replace(/ ?js-motion/,"")},2600)}}(document,window);</script>')


def _prefix(html):
    """Generated pages all sit one directory deep; hand-written ones are
    split between the root and one level down. The existing modal.js tag
    already encodes which, so nothing has to be passed in."""
    if '<script src="../assets/js/modal.js"></script>' in html:
        return '../'
    if '<script src="assets/js/modal.js"></script>' in html:
        return ''
    return None


def inject(html):
    """Add the gate and the reveal.js tag. Idempotent, so re-running a
    generator over pages that already carry them changes nothing."""
    pre = _prefix(html)
    if pre is None:          # book.html, and anything else without the modal
        return html

    if 'js-motion' not in html:
        html = html.replace(VIEWPORT, VIEWPORT + '\n' + GATE, 1)

    tag = '<script src="%sassets/js/reveal.js" defer></script>' % pre
    if tag not in html:
        modal = '<script src="%sassets/js/modal.js"></script>' % pre
        html = html.replace(modal, modal + '\n' + tag, 1)

    return html
