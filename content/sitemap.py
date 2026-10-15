# -*- coding: utf-8 -*-
"""Write site/sitemap.xml from the pages that are actually in site/.

A page is listed when it can be indexed: it has a canonical URL on SITE_URL
and no noindex robots tag. That leaves out the booking page, the 404 page
and redirect stubs by construction. Each entry is the page's own canonical,
so the sitemap and the pages cannot disagree.

Runs in CI before the link check (and can be run by hand), so a new article
or page is listed the moment it exists, and a removed one drops out.
check_links.py fails the deploy if the two ever differ.
"""
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_config import SITE_URL  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, "..", "site"))


def indexable_urls(root=SITE):
    urls = []
    for base, _dirs, names in os.walk(root):
        for name in names:
            if not name.endswith(".html"):
                continue
            with io.open(os.path.join(base, name), encoding="utf-8") as fh:
                head = fh.read().split("</head>", 1)[0]
            if re.search(r'<meta name="robots" content="[^"]*noindex', head):
                continue
            m = re.search(r'<link rel="canonical" href="([^"]+)"', head)
            if m and m.group(1).startswith(SITE_URL + "/"):
                urls.append(m.group(1))
    # Home first, then by path, so diffs stay readable.
    return sorted(set(urls), key=lambda u: (u != SITE_URL + "/", u))


def main():
    urls = indexable_urls()
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    out += ["  <url><loc>%s</loc></url>" % u for u in urls]
    out.append("</urlset>")
    with io.open(os.path.join(SITE, "sitemap.xml"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out) + "\n")
    print("sitemap: %d urls" % len(urls))


if __name__ == "__main__":
    main()
