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

for base, _dirs, files in os.walk(ROOT):
    for name in files:
        if not name.endswith(".html"):
            continue
        page = os.path.join(base, name)
        with open(page, encoding="utf-8") as fh:
            html = fh.read()
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
