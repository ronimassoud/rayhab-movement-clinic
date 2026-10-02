#!/usr/bin/env python3
"""Fail the build if any internal link, script, style or image is missing.

The site is hand-assembled and partly generated, so a renamed file can break
navigation silently. This runs before every deploy.
"""
import os
import re
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "site"
REF = re.compile(r'(?:src|href)="([^"#:]+)(#[^"]*)?"')
SKIP = ("http://", "https://", "mailto:", "tel:", "//", "data:")

broken = []
checked = 0

# Pages that deliberately carry no motion gate. book.html is the no-JS
# booking fallback and has no modal.js, which is the anchor the injector
# keys off, so it is excluded by construction rather than by this list.
NO_MOTION = {"book.html"}
missing_motion = []

for base, _dirs, files in os.walk(ROOT):
    for name in files:
        if not name.endswith(".html"):
            continue
        page = os.path.join(base, name)
        with open(page, encoding="utf-8") as fh:
            html = fh.read()

        # The gate and reveal.js reach 63 generated pages through
        # content/motion_tags.py and 8 hand-written ones through the same
        # function. Asserting it here is what actually stops the two halves
        # drifting apart; a note in the README would not.
        if name not in NO_MOTION:
            if "js-motion" not in html:
                missing_motion.append("%s -> no motion gate" % page)
            if "assets/js/reveal.js" not in html:
                missing_motion.append("%s -> no reveal.js" % page)
        for match in REF.finditer(html):
            target = match.group(1)
            if target.startswith(SKIP):
                continue
            checked += 1
            resolved = os.path.normpath(os.path.join(base, target))
            if os.path.isdir(resolved):
                resolved = os.path.join(resolved, "index.html")
            if not os.path.exists(resolved):
                broken.append("%s -> %s" % (page, target))

print("checked %d internal references" % checked)
if broken:
    print("\n%d broken:" % len(broken))
    for item in broken:
        print("  " + item)
    sys.exit(1)
print("all resolve")

if missing_motion:
    print("\n%d pages missing motion markup:" % len(missing_motion))
    for item in missing_motion:
        print("  " + item)
    sys.exit(1)
print("motion markup present on every page that should carry it")
