# -*- coding: utf-8 -*-
"""Mark every page of a staging build noindex.

The GitHub Pages copy at ronimassoud.github.io/rayhab-movement-clinic/ is a
staging mirror of the production site (SITE_URL in site_config.py). Its
canonicals already point at production; this adds
<meta name="robots" content="noindex"> to each page as well, so search
engines never index the mirror.

Run only by the Pages workflow, on the copy being published. Never run it on
a production build: it would remove the whole site from search results.
Idempotent.
"""
import io
import os
import sys

TAG = '<meta name="robots" content="noindex">'


def main(root):
    changed = 0
    for base, _dirs, names in os.walk(root):
        for name in names:
            if not name.endswith(".html"):
                continue
            path = os.path.join(base, name)
            with io.open(path, encoding="utf-8") as fh:
                html = fh.read()
            if 'name="robots"' in html.split("</head>", 1)[0]:
                continue
            html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + TAG, 1)
            with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(html)
            changed += 1
    print("staging: noindex added to %d pages" % changed)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "site")
