#!/usr/bin/env python3
"""Fail the build if any internal link, script, style or image is missing.

The site is hand-assembled and partly generated, so a renamed file can break
navigation silently. This runs before every deploy.
"""
import os
import re
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "site"
# The path is what has to exist on disk; a query string and a fragment are
# both read by the browser, not the filesystem. Fragments were already
# stripped here, queries were not, so a link like book.html?type=assessment
# was looked up as a filename and reported broken.
REF = re.compile(r'(?:src|href)="([^"#?:]+)(\?[^"#]*)?(#[^"]*)?"')
SKIP = ("http://", "https://", "mailto:", "tel:", "//", "data:")

broken = []
checked = 0

# Pages that deliberately carry no motion gate, by path under the site
# root. book.html is the no-JS booking fallback; the redirect stub and the
# self-contained 404 need none; the payment page and the admin are working
# tools, not editorial pages.
NO_MOTION = {"book.html", "services/frc-joint-training.html", "404.html",
             "payment/index.html", "admin/index.html"}
missing_motion = []

for base, _dirs, files in os.walk(ROOT):
    for name in files:
        if not name.endswith(".html"):
            continue
        page = os.path.join(base, name)
        with open(page, encoding="utf-8") as fh:
            html = fh.read()

        # The gate and the GSAP scripts reach 63 generated pages through
        # content/motion_tags.py and 8 hand-written ones through the same
        # function. Asserting it here is what actually stops the two halves
        # drifting apart; a note in the README would not.
        # The card panel the nav opens into below 1181px is injected by
        # content/navcards.py into every page with the nav.
        if 'class="site-nav"' in html and 'id="navcards"' not in html:
            missing_motion.append("%s -> nav without its card panel" % page)
        if os.path.relpath(page, ROOT).replace(os.sep, "/") not in NO_MOTION:
            if "js-motion" not in html:
                missing_motion.append("%s -> no motion gate" % page)
            for need in ("assets/js/vendor/gsap.min.js",
                         "assets/js/vendor/ScrollTrigger.min.js",
                         "assets/js/motion.js"):
                if need not in html:
                    missing_motion.append("%s -> no %s" % (page, need))
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

# ---- Search and sharing metadata ----
# Every indexable page (no noindex tag) needs a title, a description, a
# canonical on the production origin and an absolute share image. All of it
# is written by content/seo_tags.py; this catches a page that skipped it.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "content"))
from site_config import SITE_URL  # noqa: E402
from sitemap import indexable_urls  # noqa: E402

meta_problems = []
for base, _dirs, files in os.walk(ROOT):
    for name in files:
        if not name.endswith(".html"):
            continue
        page = os.path.join(base, name)
        with open(page, encoding="utf-8") as fh:
            head = fh.read().split("</head>", 1)[0]
        if re.search(r'<meta name="robots" content="[^"]*noindex', head):
            continue
        need = {
            "title": r"<title>[^<]{10,}</title>",
            "description": r'<meta name="description" content="[^"]{50,}"',
            "canonical on " + SITE_URL: r'<link rel="canonical" href="' + re.escape(SITE_URL) + "/",
            "absolute og:image": r'<meta property="og:image" content="https://',
        }
        for what, pattern in need.items():
            if not re.search(pattern, head):
                meta_problems.append("%s -> no %s" % (page, what))
if meta_problems:
    print("\n%d metadata problems:" % len(meta_problems))
    for item in meta_problems:
        print("  " + item)
    sys.exit(1)
print("title, description, canonical and share image on every indexable page")

# ---- Sitemap ----
# The sitemap must list exactly the indexable pages: nothing missing, and
# nothing that redirects, 404s or is marked noindex.
with open(os.path.join(ROOT, "sitemap.xml"), encoding="utf-8") as fh:
    listed = set(re.findall(r"<loc>([^<]+)</loc>", fh.read()))
expected = set(indexable_urls(ROOT))
if listed != expected:
    print("\nsitemap differs from the indexable pages (run content/sitemap.py):")
    for u in sorted(expected - listed):
        print("  missing  " + u)
    for u in sorted(listed - expected):
        print("  extra    " + u)
    sys.exit(1)
print("sitemap lists exactly the %d indexable pages" % len(expected))

# ---- In-page anchors ----
# The link check above ignores #fragments; a link to a section that does not
# exist lands at the top of the page, which reads as broken.
ids = {}
pages = {}
for base, _dirs, files in os.walk(ROOT):
    for name in files:
        if name.endswith(".html"):
            path = os.path.normpath(os.path.join(base, name))
            with open(path, encoding="utf-8") as fh:
                pages[path] = fh.read()
            ids[path] = set(re.findall(r'\sid="([^"]+)"', pages[path]))
bad_anchors = []
for path, html in pages.items():
    # A fragment starting with "/" is a route inside a page's own script
    # (the admin's #/requests), not a section, so it is not checked here.
    for target_path, frag in re.findall(r'href="([^"#:]*)#([^"/][^"]*)"', html):
        target = path
        if target_path:
            target = os.path.normpath(os.path.join(os.path.dirname(path), target_path.split("?")[0]))
            if os.path.isdir(target):
                target = os.path.join(target, "index.html")
        if target in ids and frag not in ids[target]:
            bad_anchors.append("%s -> %s#%s" % (path, target_path, frag))
if bad_anchors:
    print("\n%d links to missing sections:" % len(bad_anchors))
    for item in bad_anchors:
        print("  " + item)
    sys.exit(1)
print("every in-page anchor lands on an existing section")

# ---- No secrets in the browser ----
# Everything under assets/js is public. Payment-provider keys, WhatsApp
# tokens and privileged database keys live only on the server; this fails
# the build if anything shaped like one reaches a script.
SECRET = re.compile(
    r"(sk_live_[0-9A-Za-z]{8,}|sk_test_[0-9A-Za-z]{8,}"
    r"|service_role|SUPABASE_SERVICE"
    r"|EAA[A-Za-z0-9]{30,}"                       # Meta / WhatsApp access token
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r"|whish[_-]?(secret|api[_-]?key|merchant[_-]?key)\s*[:=]"
    r"|(api[_-]?key|secret|password)\s*[:=]\s*['\"][^'\"]{12,}['\"])", re.I)
leaks = []
for base, _dirs, files in os.walk(os.path.join(ROOT, "assets", "js")):
    for name in files:
        if not name.endswith(".js") or base.endswith("vendor"):
            continue
        path = os.path.join(base, name)
        with open(path, encoding="utf-8") as fh:
            for no, line in enumerate(fh, 1):
                if SECRET.search(line):
                    leaks.append("%s:%d" % (path, no))
if leaks:
    print("\n%d possible secrets in browser scripts:" % len(leaks))
    for item in leaks:
        print("  " + item)
    sys.exit(1)
print("no secrets in browser scripts")
