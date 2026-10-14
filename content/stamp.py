# -*- coding: utf-8 -*-
"""Version every local stylesheet and script URL by its content.

    href="assets/css/rayhab.css"  ->  href="assets/css/rayhab.css?v=3f2a9c1e"

The static server and GitHub Pages let browsers keep CSS and JS for a while
(Pages for ten minutes, a local `python -m http.server` for as long as the
browser likes). Without a version, a browser could pair a freshly deployed
page with yesterday's stylesheet. That is how the nav's card panel showed up
on desktop as a loose, unstyled list: the new markup had arrived, the rule
that hides it had not. With the hash in the URL, a changed file is a new URL,
so the two can never be mixed.

Used two ways:
  - the generators call stamp() on each page as the last post-processing
    step, so their output is already versioned;
  - `python content/stamp.py` restamps every page under site/, for the
    hand-written ones and after a stylesheet build. The deploy workflow runs
    it after `npm run build`, so what is published always matches.

Idempotent: a page already carrying the right hashes is left as it is.
"""
import glob
import hashlib
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, "..", "site"))

REF = re.compile(r'((?:href|src)=")((?:\.\./)*assets/(?:css|js)/[^"?#]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")')
_hashes = {}


def _digest(path):
    if path not in _hashes:
        with open(path, "rb") as fh:
            _hashes[path] = hashlib.md5(fh.read()).hexdigest()[:8]
    return _hashes[path]


def stamp(html, page_dir):
    """Add ?v=<hash> to each local CSS/JS reference, resolved from page_dir."""
    def one(m):
        target = os.path.normpath(os.path.join(page_dir, m.group(2)))
        if not os.path.exists(target):
            return m.group(0)          # check_links.py reports it; do not hide it
        return '%s%s?v=%s%s' % (m.group(1), m.group(2), _digest(target), m.group(3))
    return REF.sub(one, html)


def main():
    changed = 0
    pages = glob.glob(os.path.join(SITE, "**", "*.html"), recursive=True)
    for page in pages:
        with io.open(page, encoding="utf-8", newline="") as fh:
            html = fh.read()
        out = stamp(html, os.path.dirname(page))
        if out != html:
            with io.open(page, "w", encoding="utf-8", newline="") as fh:
                fh.write(out)
            changed += 1
    print("stamped %d of %d pages" % (changed, len(pages)))


if __name__ == "__main__":
    sys.exit(main())
