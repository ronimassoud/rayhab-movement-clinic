# -*- coding: utf-8 -*-
"""Build the four supporting service pages on the same template as
services/scoliosis-rehabilitation.html."""
import io, re, json, os

from motion_tags import inject
from navcards import inject_navcards
from stamp import stamp

# Relative to this file, so the generator writes into whichever checkout
# it is run from. It used to be an absolute path to one folder.
SITE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site"))
OUT = os.path.join(SITE, "services")
here = os.path.dirname(os.path.abspath(__file__))

ICON = {
 "parent": '<circle cx="12" cy="7" r="3.2"></circle><path d="M5.5 20c.6-4 3.2-6 6.5-6s5.9 2 6.5 6"></path>',
 "adult": '<path d="M4 15c3.5-1.5 5-6 8-6s4.5 3 8 1.5"></path><circle cx="7" cy="6.5" r="2.2"></circle>',
 "athlete": '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"></path>',
}

NAV = '''<nav class="site-nav" aria-label="Primary">
  <a href="../" aria-label="Rayhab Movement Clinic, home"><span class="wordmark"></span></a>
  <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="navgroup"><i></i><span class="vh">Menu</span></button>
  <div class="navgroup" id="navgroup">
    <a href="../">Home</a>
    <a href="../education.html">Education</a>
    <a class="nav-sub" href="../scoliosis/">Scoliosis</a>
    <a href="./" aria-current="page">Services</a>
    <a href="../about.html">About</a>
    <a href="../results.html">Results</a>
    <a href="../contact.html">Contact</a>
  </div>
  <div class="nav-right">
    <span class="nav-meta">Beirut \u00b7 Online</span>
    <a class="btn btn-spring btn-sm" href="../book.html">Book an assessment</a>
  </div>
</nav>'''

FOOTER = '''<footer class="site-footer">
  <div>
    <span class="wordmark"></span>
    <p class="foot-tag">MOVEMENT CLINIC</p>
    <div class="socials">
      <a href="https://instagram.com/" aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B4C7B8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="5"></rect><circle cx="12" cy="12" r="3.9"></circle><circle cx="17.1" cy="6.9" r="1" fill="#B4C7B8" stroke="none"></circle></svg></a>
      <a href="https://tiktok.com/" aria-label="TikTok"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B4C7B8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.4 3.5v10.9a3.4 3.4 0 11-3.4-3.4"></path><path d="M13.4 3.5c.3 2.4 2 4.1 4.4 4.3"></path></svg></a>
      <a href="https://facebook.com/" aria-label="Facebook"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B4C7B8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.8 7.4h2.1"></path><path d="M14.8 20.5V8.9a2.4 2.4 0 012.4-2.4h.6"></path><path d="M11.6 12.3h4.9"></path></svg></a>
    </div>
  </div>
  <div class="footcols">
    <div class="footcol">
      <h2>Scoliosis</h2>
      <a href="../scoliosis/">Understanding scoliosis</a>
      <a href="../education.html">Education hub</a>
      <a href="../results.html">Case studies</a>
    </div>
    <div class="footcol">
      <h2>Services</h2>
      <a href="scoliosis-rehabilitation.html">Scoliosis rehabilitation</a>
      <a href="sports-rehabilitation.html">Sports rehabilitation</a>
      <a href="frc-joint-training.html">FRC &amp; joint training</a>
      <a href="physiotherapy.html">Physiotherapy</a>
      <a href="pain-management.html">Pain management</a>
    </div>
    <div class="footcol">
      <h2>Clinic</h2>
      <a href="../about.html">About Rayan</a>
      <a href="../contact.html">Contact</a>
      <a href="../book.html">Online consultations</a>
    </div>
  </div>
</footer>

<div class="m-bookbar">
  <p class="m-bookbar-1">Your plan starts with an assessment.</p>
  <a class="btn btn-spring" href="../book.html">Book</a>
</div>'''


# The booking option each page opens on. Without it the page's general
# "Book" buttons (nav, hero, closing band, phone bar) opened the flow on its
# first option, the scoliosis assessment, whichever service you were reading.
BOOK_TYPE = {'sports-rehabilitation': 'sports', 'frc-joint-training': 'sports',
             'physiotherapy': 'sports', 'pain-management': 'pain'}
SPRING_BOOK = re.compile(r'(<a class="btn btn-spring[^"]*" href="\.\./book\.html)(")')


def own_booking(html, slug):
    """Point the page's primary booking buttons at its own option. Only the
    spring buttons: the footer's "Online consultations" link and the online
    card keep the plain flow, which is the right start for those."""
    t = BOOK_TYPE.get(slug)
    return SPRING_BOOK.sub(lambda m: m.group(1) + '?type=' + t + m.group(2), html) if t else html


def wrap_arrows(html):
    """Wrap trailing navigational arrows so they can animate on hover.
    The leading space is what separates a navigational arrow from a data
    one such as "29 -> 20", so data arrows are left alone."""
    return html.replace(u" →</", u' <span class="arw" aria-hidden="true">→</span></')


# Every service page shows the one clinic photograph, cropped to the part of
# the room the service happens in: the treatment rooms for physiotherapy, the
# training floor for sports rehabilitation and joint training.
CLINIC_POS = {'sports-rehabilitation': '88% 50%', 'frc-joint-training': '72% 50%', 'physiotherapy': '14% 50%', 'pain-management': '30% 50%'}
CLINIC_ALT = 'Inside Rayhab Movement Clinic: treatment rooms on the left, the reception desk ahead and a training floor with free weights on the right.'


def clinic_img(slug):
    return ('<img src="../assets/img/clinic/clinic-1600.webp" '
            'srcset="../assets/img/clinic/clinic-960.webp 960w, ../assets/img/clinic/clinic-1600.webp 1600w" '
            'sizes="(max-width:900px) 100vw, 46vw" width="1600" height="900" fetchpriority="high" '
            'decoding="async" style="--pos:%s" alt="%s">' % (CLINIC_POS.get(slug, '50% 50%'), CLINIC_ALT))


def build(s, n):
    stats = "".join('<div><p class="stat-k">%s</p><p class="stat-v">%s</p></div>' % (k, v)
                    for k, v in s["stats"])
    mspec = "".join('<div><p class="k">%s</p><p class="v">%s</p></div>' % (k, v)
                    for k, v in s["mspec"])
    minis = "".join('<div class="mini-card"><p class="mini-k">%s</p><p class="mini-v">%s</p></div>'
                    % (k, v) for k, v in s["minis"])
    stages = ""
    for i, (t, d) in enumerate(s["stages"], 1):
        stages += ('<li class="stage%s stage-%d"><span class="stage-rail" aria-hidden="true">'
                   '<span class="stage-num">%02d</span><span class="stage-line"></span></span>'
                   '<div class="stage-body"><p class="stage-n">%02d</p><p class="stage-t">%s</p>'
                   '<p class="stage-d">%s</p></div></li>'
                   % (" stage-lead" if i == 1 else "", i, i, i, t, d))
    who = "".join('<div class="whocard"><span class="whoicon"><svg width="24" height="24" '
                  'viewBox="0 0 24 24" fill="none" stroke="#174924" stroke-width="1.5" '
                  'stroke-linecap="round" stroke-linejoin="round">%s</svg></span>'
                  '<div><p class="who-k">%s</p><p class="who-v">%s</p></div></div>'
                  % (ICON[i], k, v) for i, k, v in s["who"])
    inc = "".join("<li>%s</li>" % i for i in s["includes"])

    consults = ""
    for i, (t, d, dur, loc, tag, bk) in enumerate(s["consults"]):
        # A named option should arrive at the flow already chosen.
        href = "../book.html" + ("?type=" + bk if bk else "")
        if i == 0:
            consults += ('<div class="consult consult-lead"><div class="consult-head">'
                         '<p class="consult-t max-w-[200px]">%s</p>'
                         '<span class="tag-start">%s</span></div>'
                         '<p class="body-s mb-5">%s</p>'
                         '<dl class="consult-spec"><div><dt>Duration</dt><dd>%s</dd></div>'
                         '<div><dt>Location</dt><dd>%s</dd></div></dl>'
                         '<a class="btn btn-spring text-[15px] py-4 px-6" '
                         'href="%s">Book this</a></div>' % (t, tag, d, dur, loc, href))
        else:
            consults += ('<div class="consult consult-alt on-dark">'
                         '<p class="consult-t mb-4">%s</p>'
                         '<p class="body-s mb-5 text-on-dark">%s</p>'
                         '<dl class="consult-spec consult-spec-dark">'
                         '<div><dt>Duration</dt><dd>%s</dd></div>'
                         '<div><dt>Location</dt><dd>%s</dd></div></dl>'
                         '<a class="btn text-[15px] py-4 px-6 text-bone" style="'
                         'border-color:#ffffff33" href="%s">Book this</a>'
                         '</div>' % (t, d, dur, loc, href))

    faq = ""
    for i, (q, a) in enumerate(s["faq"], 1):
        fid = "%s%d" % (s["slug"][:2], i)
        faq += ('<div class="acc-item faq-item"><h3><button class="acc-btn faq-btn" type="button" '
                'aria-expanded="%s" aria-controls="%s">%s<span class="acc-mark faq-mark" '
                'aria-hidden="true">%s</span></button></h3>'
                '<div class="acc-panel faq-panel" id="%s"%s>%s</div></div>'
                % ("true" if i == 1 else "false", fid, q, "\u2212" if i == 1 else "+",
                   fid, "" if i == 1 else " hidden", a))

    return '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s</title>
<meta name="description" content="%(desc)s">
<link rel="canonical" href="https://ronimassoud.github.io/rayhab-movement-clinic/services/%(slug)s.html">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700&family=Public+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/css/rayhab.css">
<link rel="icon" href="../assets/img/favicon.png" sizes="32x32">
<link rel="apple-touch-icon" href="../assets/img/apple-touch-icon.png">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="frame">

%(nav)s

<main id="main">

  <section class="svc-hero on-dark">
    <div class="svc-hero-copy">
      <p class="crumbs crumbs-dark mb-7"><a href="../">Home</a> <span aria-hidden="true">/</span> <a href="./">Services</a> <span aria-hidden="true">/</span> %(name)s</p>
      <p class="hero-pill mb-6"><span class="dot" aria-hidden="true"></span>Supporting service</p>
      <h1 class="h1">%(h1)s</h1>
      <p class="body-l d-only mt-6 max-w-[560px] text-on-dark text-[19px] leading-[1.65]">%(lede)s</p>
      <p class="body-l m-only text-on-dark">%(lede_m)s</p>
      <div class="hero-btns mt-8">
        <a class="btn btn-spring py-4 px-7" href="../book.html">Book an assessment</a>
        <a class="btn btn-ghost-dark py-4 px-7" href="./">See all services</a>
      </div>
      <div class="svc-stats">%(stats)s</div>
      <div class="m-spec svc-mspec m-only">%(mspec)s</div>
    </div>
    <div class="svc-hero-media">
      <div class="photo photo-cover svc-hero-slot">
        %(clinic)s
      </div>
      <div class="measure-card tilt">
        <svg viewBox="0 0 70 70" aria-hidden="true">
          <circle cx="35" cy="35" r="26" fill="none" stroke="#174924" stroke-width="1.6"></circle>
          <path d="M35 9 A 26 26 0 0 1 61 35" fill="none" stroke="#62E36B" stroke-width="2.4" stroke-linecap="round"></path>
          <circle cx="35" cy="35" r="4" fill="#174924"></circle>
        </svg>
        <div>
          <p class="measure-k">%(measure_k)s</p>
          <p class="measure-v">%(measure_v)s</p>
        </div>
      </div>
    </div>
  </section>

  <section class="svc-approach">
    <div>
      <p class="eyebrow mb-4">The approach</p>
      <h2 class="h3 sec-h mw400">%(approach_h)s</h2>
    </div>
    <div>
      <p class="body-l mb-7 max-w-[660px] text-fg-2">%(approach_p)s</p>
      <div class="approach-grid">%(minis)s</div>
    </div>
  </section>

  <section class="svc-process">
    <div class="sechead mb-9">
      <div>
        <p class="eyebrow mb-4">The rehabilitation process</p>
        <h2 class="h3 sec-h">%(process_h)s</h2>
      </div>
      <p class="body-s max-w-[360px]">%(process_p)s</p>
    </div>
    <ol class="stages" data-reveal="children" data-reveal-stagger="70">%(stages)s</ol>
  </section>

  <section class="svc-who">
    <div>
      <p class="eyebrow mb-4">Who this is for</p>
      <div class="wholist">%(who)s</div>
    </div>
    <div>
      <p class="eyebrow mb-4">What the programme includes</p>
      <ul class="inclist">%(inc)s</ul>
      <p class="disclaimer mt-4">Rehabilitation outcomes vary between individuals. Rayhab does not promise a specific result or timeline.</p>
    </div>
  </section>

  <section class="svc-consult">
    <div class="sechead mb-8">
      <div>
        <p class="eyebrow text-spring-500 mb-4">Consultation types</p>
        <h2 class="h3 on-dark sec-h sec-h-dark">Start with an assessment</h2>
      </div>
    </div>
    <div class="consult-grid">%(consults)s</div>
  </section>

  <section class="svc-proof">
    <div>
      <p class="eyebrow mb-4">Experience behind the work</p>
      <div class="stat-tiles">
        <div><p class="tile-k">5+ yrs</p><p class="tile-v">Clinical and movement-based experience</p></div>
        <div><p class="tile-k">Amman</p><p class="tile-v">Sports rehabilitation with basketball and football athletes</p></div>
      </div>
      <div class="card mt-3">
        <p class="h6 mb-2 text-forest-900">No case studies published yet</p>
        <p class="body-s">Consented patient journeys are published for scoliosis rehabilitation, where the clinic has permission to do so. Nothing is written up for this service yet, and an empty section is more honest than a borrowed quote.</p>
        <p class="mt-5"><a class="btn btn-ghost-light" href="../results.html">See the scoliosis journeys</a></p>
      </div>
    </div>
    <div>
      <p class="eyebrow mb-4">Common questions</p>
      <div class="faq-card" data-reveal="children" data-reveal-stagger="50">%(faq)s</div>
    </div>
  </section>

  <section class="cta-band" data-reveal="children" data-reveal-stagger="90">
    <div>
      <h2 class="h2-sm cta-h2">%(cta_h)s</h2>
      <p class="body-m cta-lede">%(cta_p)s</p>
    </div>
    <div class="btns">
      <a class="btn btn-spring" href="../book.html">Book an assessment</a>
      <a class="btn btn-ghost-dark" href="./">See all services</a>
    </div>
  </section>

</main>

%(footer)s

</div>
<script src="../assets/js/ui.js"></script>
<script src="../assets/js/booking.js"></script>
<script src="../assets/js/modal.js"></script>
</body>
</html>
''' % dict(s, nav=NAV, footer=FOOTER, stats=stats, mspec=mspec, minis=minis,
           stages=stages, who=who, inc=inc, consults=consults, faq=faq,
           clinic=clinic_img(s['slug']))


data = json.load(io.open(os.path.join(here, "services.json"), encoding="utf-8"))
for n, s in enumerate(data["services"]):
    io.open(os.path.join(OUT, s["slug"] + ".html"), "w",
            encoding="utf-8", newline="\n").write(stamp(inject_navcards(inject(own_booking(wrap_arrows(build(s, n)), s["slug"]))), OUT))
    print("wrote services/%s.html" % s["slug"])
