# -*- coding: utf-8 -*-
"""Prepare a staging build: noindex every page, and allow demo mode.

The GitHub Pages copy at ronimassoud.github.io/rayhab-movement-clinic/ is a
staging mirror of the production site (SITE_URL in site_config.py). Its
canonicals already point at production; this adds
<meta name="robots" content="noindex"> to each page as well, so search
engines never index the mirror.

It also adds <meta name="rayhab-demo" content="allowed">. With it, ?demo=1
on a booking, payment or admin page swaps the API for the in-memory mock in
assets/js/api/mock.js, so the flows can be reviewed before the backend
exists. Production pages never carry the tag, so there ?demo=1 does nothing.

Run only by the Pages workflow, on the copy being published. Never run it on
a production build: it would remove the whole site from search results and
switch demo mode on. Idempotent.
"""
import io
import os
import sys

NOINDEX = '<meta name="robots" content="noindex">'
DEMO = '<meta name="rayhab-demo" content="allowed">'


def main(root):
    noindexed = demo = 0
    for base, _dirs, names in os.walk(root):
        for name in names:
            if not name.endswith(".html"):
                continue
            path = os.path.join(base, name)
            with io.open(path, encoding="utf-8") as fh:
                html = fh.read()
            head = html.split("</head>", 1)[0]
            add = []
            if 'name="robots"' not in head:
                add.append(NOINDEX)
                noindexed += 1
            if 'name="rayhab-demo"' not in head:
                add.append(DEMO)
                demo += 1
            if not add:
                continue
            html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + "\n".join(add), 1)
            with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(html)
    print("staging: noindex added to %d pages, demo mode allowed on %d" % (noindexed, demo))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "site")
