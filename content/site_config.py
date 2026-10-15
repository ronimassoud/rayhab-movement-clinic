# -*- coding: utf-8 -*-
"""Site-wide settings shared by the generators and the head injector.

SITE_URL is the production origin. Canonical URLs, the sitemap, robots.txt
and social share links are all built from it, so moving the site means
changing this one line and rebuilding. The GitHub Pages staging copy is
published with a noindex tag added in CI (content/staging_noindex.py), so it
never competes with production in search results.

API_BASE is where the booking and contact scripts send requests. It is
written into every page as <meta name="rayhab-api">; see README.md for the
endpoints and their contracts.
"""

SITE_URL = "https://dr-rayhab.com"
SITE_NAME = "Rayhab Movement Clinic"
API_BASE = "/api"

SHARE_IMAGE = "/assets/img/og/rayhab-share.jpg"
SHARE_IMAGE_W = 1200
SHARE_IMAGE_H = 630
SHARE_IMAGE_ALT = ("Rayhab Movement Clinic: Scoliosis Specialist and Sports Rehab, "
                   "with Dr. Rayan Halimeh, physiotherapist and founder.")
