# -*- coding: utf-8 -*-
"""Normalise every page's <head>: canonical host, fonts, API address and
social sharing tags.

Applied after formatting, like motion_tags.inject() and
navcards.inject_navcards(): the three generators call it on every page they
write, and the hand-written pages are run through it once (and again
whenever this file changes). It is idempotent, and check_links.py fails a
deploy if an indexable page lacks what it adds.

What it does, from the page's own title, description and canonical:
  * points the canonical link at SITE_URL (content/site_config.py);
  * replaces the Google Fonts links with preloads of the self-hosted fonts;
  * writes <meta name="rayhab-api"> for booking.js and contact.js;
  * on indexable pages, writes Open Graph and Twitter card tags between
    <!-- share --> markers, with an absolute 1200x630 image.
Pages marked noindex (the booking page, the 404, redirect stubs) get the
first three but no share tags.
"""
import re

from site_config import (API_BASE, SHARE_IMAGE, SHARE_IMAGE_ALT, SHARE_IMAGE_H,
                         SHARE_IMAGE_W, SITE_NAME, SITE_URL)

PREFIX = re.compile(r'href="((?:\.\./)*)assets/css/rayhab\.css')
CANON = re.compile(r'(<link rel="canonical" href=")https?://[^/"]+(?:/rayhab-movement-clinic)?(/[^"]*")')
GOOGLE = re.compile(r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\n'
                    r'<link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin>\n'
                    r'<link href="https://fonts\.googleapis\.com/css2\?[^"]*" rel="stylesheet">\n')
SHARE = re.compile(r'<!-- share -->.*?<!-- /share -->\n', re.S)
FONTS = ("bricolage-grotesque-latin.woff2", "public-sans-latin.woff2")


def _attr(html, pattern):
    m = re.search(pattern, html)
    return m.group(1) if m else ""


def inject_seo(html):
    head_end = html.find("</head>")
    if head_end < 0:
        return html
    m = PREFIX.search(html)
    pre = m.group(1) if m else ""

    # Canonical on the production origin.
    html = CANON.sub(lambda m: m.group(1) + SITE_URL + m.group(2), html)

    # Self-hosted fonts in place of Google Fonts.
    preload = "".join('<link rel="preload" href="%sassets/fonts/%s" as="font" type="font/woff2" crossorigin>\n'
                      % (pre, f) for f in FONTS)
    if GOOGLE.search(html):
        html = GOOGLE.sub(lambda _m: preload, html, count=1)

    # Where booking.js and contact.js send requests.
    if 'name="rayhab-api"' not in html:
        html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">',
                            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
                            '<meta name="rayhab-api" content="%s">' % API_BASE, 1)

    # Share tags, indexable pages only.
    html = SHARE.sub("", html)
    head = html[:html.find("</head>")]
    if 'name="robots" content="noindex' in head:
        return html
    title = _attr(head, r"<title>(.*?)</title>")
    desc = _attr(head, r'<meta name="description" content="([^"]*)"')
    url = _attr(head, r'<link rel="canonical" href="([^"]*)"')
    if not (title and desc and url):
        return html
    kind = "article" if '<header class="art-hero">' in html else "website"
    image = SITE_URL + SHARE_IMAGE
    tags = [
        '<meta property="og:type" content="%s">' % kind,
        '<meta property="og:site_name" content="%s">' % SITE_NAME,
        '<meta property="og:locale" content="en_US">',
        '<meta property="og:title" content="%s">' % title,
        '<meta property="og:description" content="%s">' % desc,
        '<meta property="og:url" content="%s">' % url,
        '<meta property="og:image" content="%s">' % image,
        '<meta property="og:image:width" content="%d">' % SHARE_IMAGE_W,
        '<meta property="og:image:height" content="%d">' % SHARE_IMAGE_H,
        '<meta property="og:image:alt" content="%s">' % SHARE_IMAGE_ALT,
        '<meta name="twitter:card" content="summary_large_image">',
    ]
    block = "<!-- share -->\n" + "\n".join(tags) + "\n<!-- /share -->\n"
    at = html.find("</head>")
    return html[:at] + block + html[at:]
