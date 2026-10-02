# -*- coding: utf-8 -*-
"""Build the three supporting service pages on the same template as
services/scoliosis-rehabilitation.html."""
import io, json, os

from motion_tags import inject

SITE = r"C:/Users/Roni Massoud/Desktop/Dr. Rayhab/site"
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
    <a href="../scoliosis/">Scoliosis</a>
    <a href="./" aria-current="page">Services</a>
    <a href="../about.html">About</a>
    <a href="../results.html">Results</a>
    <a href="../education.html">Education</a>
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


def wrap_arrows(html):
    """Wrap trailing navigational arrows so they can animate on hover.
    The leading space is what separates a navigational arrow from a data
    one such as "29 -> 20", so data arrows are left alone."""
    return html.replace(u" →</", u' <span class="arw" aria-hidden="true">→</span></')


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
    for i, (t, d, dur, loc, tag) in enumerate(s["consults"]):
        if i == 0:
            consults += ('<div class="consult consult-lead"><div class="consult-head">'
                         '<p class="consult-t" style="max-width:200px">%s</p>'
                         '<span class="tag-start">%s</span></div>'
                         '<p class="body-s" style="margin-bottom:20px">%s</p>'
                         '<dl class="consult-spec"><div><dt>Duration</dt><dd>%s</dd></div>'
                         '<div><dt>Location</dt><dd>%s</dd></div></dl>'
                         '<a class="btn btn-spring" style="font-size:15px;padding:15px 24px" '
                         'href="../book.html">Book this</a></div>' % (t, tag, d, dur, loc))
        else:
            consults += ('<div class="consult consult-alt on-dark">'
                         '<p class="consult-t" style="margin-bottom:16px">%s</p>'
                         '<p class="body-s" style="margin-bottom:20px;color:var(--on-dark)">%s</p>'
                         '<dl class="consult-spec consult-spec-dark">'
                         '<div><dt>Duration</dt><dd>%s</dd></div>'
                         '<div><dt>Location</dt><dd>%s</dd></div></dl>'
                         '<a class="btn" style="font-size:15px;padding:14px 24px;'
                         'border-color:#ffffff33;color:var(--bone)" href="../book.html">Book this</a>'
                         '</div>' % (t, d, dur, loc))

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
<link rel="stylesheet" href="../assets/css/mobile.css">
<link rel="stylesheet" href="../assets/css/booking.css">
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
      <p class="crumbs crumbs-dark" style="margin-bottom:26px"><a href="./">Services</a> <span aria-hidden="true">/</span> %(name)s</p>
      <p class="hero-pill" style="margin-bottom:22px"><span class="dot" aria-hidden="true"></span>Supporting service</p>
      <h1 class="h1">%(h1)s</h1>
      <p class="body-l d-only" style="margin-top:24px;max-width:560px;color:var(--on-dark);font-size:19px;line-height:1.65">%(lede)s</p>
      <p class="body-l m-only" style="color:var(--on-dark)">%(lede_m)s</p>
      <div class="hero-btns" style="margin-top:32px">
        <a class="btn btn-spring" style="padding:17px 28px" href="../book.html">Book an assessment</a>
        <a class="btn btn-ghost-dark" style="padding:16px 27px" href="./">See all services</a>
      </div>
      <div class="svc-stats">%(stats)s</div>
      <div class="m-spec svc-mspec m-only">%(mspec)s</div>
    </div>
    <div class="svc-hero-media">
      <div class="slot slot-dark svc-hero-slot">
        <p class="slot-txt">%(slot)s</p>
      </div>
      <div class="measure-card">
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
      <p class="eyebrow" style="margin-bottom:14px">The approach</p>
      <h2 class="h3 sec-h mw400">%(approach_h)s</h2>
    </div>
    <div>
      <p class="body-l" style="margin-bottom:28px;max-width:660px;color:var(--text-2)">%(approach_p)s</p>
      <div class="approach-grid">%(minis)s</div>
    </div>
  </section>

  <section class="svc-process">
    <div class="sechead" style="margin-bottom:36px">
      <div>
        <p class="eyebrow" style="margin-bottom:14px">The rehabilitation process</p>
        <h2 class="h3 sec-h">%(process_h)s</h2>
      </div>
      <p class="body-s" style="max-width:360px">%(process_p)s</p>
    </div>
    <ol class="stages" data-reveal="children" data-reveal-stagger="70">%(stages)s</ol>
  </section>

  <section class="svc-who">
    <div>
      <p class="eyebrow" style="margin-bottom:14px">Who this is for</p>
      <div class="wholist">%(who)s</div>
    </div>
    <div>
      <p class="eyebrow" style="margin-bottom:14px">What the programme includes</p>
      <ul class="inclist">%(inc)s</ul>
      <p class="disclaimer" style="margin-top:16px">Rehabilitation outcomes vary between individuals. Rayhab does not promise a specific result or timeline.</p>
    </div>
  </section>

  <section class="svc-consult">
    <div class="sechead" style="margin-bottom:32px">
      <div>
        <p class="eyebrow" style="color:var(--spring-500);margin-bottom:14px">Consultation types</p>
        <h2 class="h3 on-dark sec-h sec-h-dark">Start with an assessment</h2>
      </div>
    </div>
    <div class="consult-grid">%(consults)s</div>
  </section>

  <section class="svc-proof">
    <div>
      <p class="eyebrow" style="margin-bottom:14px">Experience behind the work</p>
      <div class="stat-tiles">
        <div><p class="tile-k">5+ yrs</p><p class="tile-v">Clinical and movement-based experience</p></div>
        <div><p class="tile-k">Amman</p><p class="tile-v">Sports rehabilitation with basketball and football athletes</p></div>
      </div>
      <div class="card" style="margin-top:12px">
        <p class="h6" style="margin-bottom:8px;color:var(--forest-900)">No case studies published yet</p>
        <p class="body-s">Consented patient journeys are published for scoliosis rehabilitation, where the clinic has permission to do so. Nothing is written up for this service yet, and an empty section is more honest than a borrowed quote.</p>
        <p style="margin-top:20px"><a class="btn btn-ghost-light" href="../results.html">See the scoliosis journeys</a></p>
      </div>
    </div>
    <div>
      <p class="eyebrow" style="margin-bottom:14px">Common questions</p>
      <div class="faq-card" data-reveal="children" data-reveal-stagger="50">%(faq)s</div>
    </div>
  </section>

  <section class="cta-band" style="padding:56px var(--pad-x)" data-reveal="children" data-reveal-stagger="90">
    <div>
      <h2 class="h2-sm cta-h2">%(cta_h)s</h2>
      <p class="body-m cta-lede">%(cta_p)s</p>
    </div>
    <div class="btns">
      <a class="btn btn-forest" href="../book.html">Book an assessment</a>
      <a class="btn btn-ghost-ink" href="./">See all services</a>
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
           stages=stages, who=who, inc=inc, consults=consults, faq=faq)


data = json.load(io.open(os.path.join(here, "services.json"), encoding="utf-8"))
for n, s in enumerate(data["services"]):
    io.open(os.path.join(OUT, s["slug"] + ".html"), "w",
            encoding="utf-8", newline="\n").write(inject(wrap_arrows(build(s, n))))
    print("wrote services/%s.html" % s["slug"])
