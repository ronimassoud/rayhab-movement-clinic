# -*- coding: utf-8 -*-
"""The card panel the nav opens into below 1181px.

After React Bits' CardNav: below the desktop width the floating pill grows
downward and three cards of grouped links drop in. The desktop link row is
untouched; this panel is hidden there.

One definition for all 72 pages. The generators run it after formatting,
like motion_tags.inject(), and the hand-written pages were run through it
once. It is idempotent. check_links.py fails a deploy if any page with the
nav lacks the panel, so the copies cannot drift apart.

The current page is marked by ui.js, which compares paths, so the markup is
identical on every page of the same folder depth.
"""

from motion_tags import _prefix

ARROW = ('<svg class="navcard-arw" width="14" height="14" viewBox="0 0 24 24" fill="none" '
         'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
         'aria-hidden="true"><path d="M7 17L17 7"></path><path d="M8 7h9v9"></path></svg>')

CARDS = [
    ('care', 'Care', [
        ('services/scoliosis-rehabilitation.html', 'Scoliosis rehabilitation'),
        ('services/pain-management.html', 'Pain management'),
        ('services/physiotherapy.html', 'Physiotherapy'),
        ('services/sports-rehabilitation.html', 'Sports rehabilitation'),
        ('services/frc-joint-training.html', 'FRC &amp; joint training'),
        ('services/', 'All services'),
    ]),
    ('learn', 'Learn', [
        ('education.html', 'Education hub'),
        ('scoliosis/', 'Understanding scoliosis'),
        ('scoliosis/library.html', 'Scoliosis library'),
        ('results.html', 'Case studies'),
    ]),
    ('clinic', 'Clinic', [
        ('', 'Home'),
        ('about.html', 'About Rayan'),
        ('contact.html', 'Contact'),
        ('book.html', 'Book an assessment'),
    ]),
]


def cards(prefix):
    out = ['  <div class="navcards" id="navcards">']
    for key, label, links in CARDS:
        out.append('    <div class="navcard navcard-%s">' % key)
        out.append('      <p class="navcard-label" id="nc-%s">%s</p>' % (key, label))
        out.append('      <ul class="navcard-links" aria-labelledby="nc-%s">' % key)
        for href, text in links:
            url = (prefix + href) if (prefix or href) else './'
            out.append('        <li><a href="%s">%s%s</a></li>' % (url, ARROW, text))
        out.append('      </ul>')
        out.append('    </div>')
    out.append('  </div>')
    return '\n'.join(out)


def inject_navcards(html):
    """Put the panel inside the nav and point the menu button at it."""
    pre = _prefix(html)
    if pre is None or 'class="site-nav"' not in html:
        return html
    html = html.replace('aria-controls="navgroup"', 'aria-controls="navcards"', 1)
    if 'id="navcards"' in html:
        return html
    start = html.index('class="site-nav"')
    end = html.index('</nav>', start)
    return html[:end] + cards(pre) + '\n' + html[end:]
