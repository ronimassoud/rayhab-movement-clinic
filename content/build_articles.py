# -*- coding: utf-8 -*-
"""Generate the scoliosis article library and its pillar index pages.

Content lives in articles.json so the prose can be edited without touching
the template. Every page shares the site chrome exactly as the hub uses it.
"""
import io, json, os, re

from motion_tags import inject

SITE = r"C:/Users/Roni Massoud/Desktop/Dr. Rayhab/site"
OUT = os.path.join(SITE, "scoliosis")

NAV = '''<nav class="site-nav" aria-label="Primary">
  <a href="../" aria-label="Rayhab Movement Clinic, home"><span class="wordmark"></span></a>
  <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="navgroup"><i></i><span class="vh">Menu</span></button>
  <div class="navgroup" id="navgroup">
    <a href="../">Home</a>
    <a href="./" aria-current="page">Scoliosis</a>
    <a href="../services/">Services</a>
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
      <a href="./">Understanding scoliosis</a>
      <a href="../education.html">Education hub</a>
      <a href="../results.html">Case studies</a>
    </div>
    <div class="footcol">
      <h2>Services</h2>
      <a href="../services/scoliosis-rehabilitation.html">Scoliosis rehabilitation</a>
      <a href="../services/sports-rehabilitation.html">Sports rehabilitation</a>
      <a href="../services/frc-joint-training.html">FRC &amp; joint training</a>
      <a href="../services/physiotherapy.html">Physiotherapy</a>
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
  <p class="m-bookbar-1">Ready to turn this into your plan?</p>
  <a class="btn btn-spring" href="../book.html">Book</a>
</div>'''

HEAD = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://ronimassoud.github.io/rayhab-movement-clinic/scoliosis/{slug}.html">
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

'''

TAIL = '''
</div>
<script src="../assets/js/ui.js"></script>
<script src="../assets/js/booking.js"></script>
<script src="../assets/js/modal.js"></script>
</body>
</html>
'''

CTA = '''  <section class="cta-band" style="padding:56px var(--pad-x)" data-reveal="children" data-reveal-stagger="90">
    <div>
      <h2 class="h2-sm cta-h2">{h}</h2>
      <p class="body-m cta-lede">{p}</p>
    </div>
    <div class="btns">
      <a class="btn btn-forest" href="../book.html">Book an assessment</a>
      <a class="btn btn-ghost-ink" href="./">Back to the hub</a>
    </div>
  </section>
'''


# Where each pillar reaches out of the scoliosis library. One destination
# per pillar rather than per article: the pillar is the subject, so the
# target is subject-appropriate without needing a separate editorial call on
# all 24 pieces, which is where per-article picks drift.
CROSS = {
    "p1": ("../posture/does-posture-cause-pain.html", "Posture",
           "Does posture cause pain?"),
    "p2": ("../mobility/end-range-strength.html", "Mobility and joint health",
           "End-range strength and why stretching alone stalls"),
    "p3": ("../exercise/progressive-overload-without-flare-ups.html", "Exercise and loading",
           "Progressive overload without flare-ups"),
    "p4": ("../injury/how-long-does-rehab-take.html", "Injury rehabilitation",
           "How long does rehabilitation actually take?"),
}


# Closing lines rotate by position so two articles read in a row never
# share one. The first entry keeps the original wording.
CTA_ROTATE = [
    ("Still not sure what applies to you?",
     "A 60-minute assessment answers it for your curve, in Beirut or online."),
    ("Does this match what you were told?",
     "Bring the report and the questions. Sixty minutes, in Beirut or online."),
    ("Where does your own curve sit in this?",
     "An assessment measures it rather than estimating, in Beirut or online."),
]


def wrap_arrows(html):
    """Wrap trailing navigational arrows so they can animate on hover.
    The leading space is what separates a navigational arrow from a data
    one such as "29 -> 20", so data arrows are left alone."""
    return html.replace(u" →</", u' <span class="arw" aria-hidden="true">→</span></')


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def inline(t):
    """Allow **bold** in the source prose."""
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", esc(t))


def render_blocks(blocks):
    out = []
    for b in blocks:
        k = b["k"]
        if k == "h":
            out.append('<h2 id="%s">%s</h2>' % (b["id"], esc(b["t"])))
        elif k == "h3":
            out.append("<h3>%s</h3>" % esc(b["t"]))
        elif k == "p":
            out.append("<p>%s</p>" % inline(b["t"]))
        elif k in ("ul", "ol"):
            items = "".join("<li>%s</li>" % inline(i) for i in b["items"])
            out.append("<%s>%s</%s>" % (k, items, k))
        elif k == "uncertain":
            out.append('<div class="uncertain" data-reveal><h2>What is not settled</h2><p>%s</p></div>'
                       % inline(b["t"]))
    return "\n      ".join(out)


def reading_time(a):
    """Derive the reading time from the text itself. Hand-written estimates
    drifted to roughly double the real length."""
    import math
    words = []
    for k in a["key"]:
        words += k.split()
    for b in a["blocks"]:
        if "t" in b:
            words += b["t"].split()
        for i in b.get("items", []):
            words += i.split()
    return "%d min read" % max(2, math.ceil(len(words) / 200.0))


def render_article(a, lookup, pillars):
    heads = [b for b in a["blocks"] if b["k"] == "h"]
    toc = "".join('<li><a href="#%s">%s</a></li>' % (h["id"], esc(h["t"])) for h in heads)
    keys = "".join("<li>%s</li>" % inline(k) for k in a["key"])
    pil = pillars[a["pillar"]]

    related = ""
    for s in a.get("related", [])[:3]:
        r = lookup[s]
        related += ('<a class="morecard" href="%s.html">'
                    '<p class="art-kicker">%s</p>'
                    '<h3 class="art-t">%s</h3>'
                    '<p class="art-d">%s</p></a>' % (s, esc(pillars[r["pillar"]]["short"]),
                                                     esc(r["title"]), esc(r["blurb"])))

    review = ('<span class="review-pending">Awaiting clinical review</span>'
              if not a.get("reviewed") else
              '<p class="review-v">Last reviewed %s</p>' % esc(a.get("reviewed_on", "")))

    body = HEAD.format(title=esc(a["title"]) + ", Rayhab Movement Clinic",
                       desc=esc(a["desc"]), slug=a["slug"])
    body += NAV + "\n\n<main id=\"main\">\n\n"
    body += '''  <article>
  <header class="art-hero">
    <p class="crumbs crumbs-dark"><a href="../">Home</a> <span aria-hidden="true">/</span> <a href="../education.html">Education</a> <span aria-hidden="true">/</span> <a href="./">Scoliosis</a> <span aria-hidden="true">/</span> <a href="%s.html">%s</a></p>
    <p class="art-eyebrow" style="margin-top:18px">%s</p>
    <h1 class="art-h1">%s</h1>
    <p class="art-stand">%s</p>
    <div class="art-metarow">
      <div><span class="art-metak">Reading time</span><span class="art-metav">%s</span></div>
      <div><span class="art-metak">Written by</span><span class="art-metav">Rayan Halimeh, Certified Schroth Practitioner</span></div>
      <div><span class="art-metak">Status</span><span class="art-metav">%s</span></div>
    </div>
  </header>

  <div class="artwrap">
    <div class="prose">
      <div class="keybox" data-reveal>
        <h2>In short</h2>
        <ul>%s</ul>
      </div>
      %s
    </div>

    <aside class="art-side">
      <nav class="toc" aria-label="On this page">
        <h2>On this page</h2>
        <ol>%s</ol>
      </nav>
      <div class="reviewbox">
        <p class="review-k">Clinical reviewer</p>
        <p class="review-n">Rayan Halimeh</p>
        <p class="review-v">Physiotherapist, Certified Schroth Practitioner, Certified Mobility Specialist (FRCms), ACE Medical Exercise Specialist.</p>
        %s
      </div>
      <div class="reviewbox" style="background:var(--bone)">
        <p class="review-k">General information</p>
        <p class="review-v">This page explains scoliosis in general terms. It cannot tell you what your own curve is doing, and it does not replace an assessment.</p>
      </div>
    </aside>
  </div>
''' % (pil["slug"], esc(pil["name"]), esc(pil["short"]), esc(a["title"]), esc(a["stand"]),
       esc(reading_time(a)), "Awaiting clinical review" if not a.get("reviewed") else "Reviewed",
       keys, render_blocks(a["blocks"]), toc, review)

    if related:
        body += ('\n  <section class="art-more">\n    <div class="sechead">\n      <div>'
                 '<p class="eyebrow" style="margin-bottom:14px">Keep reading</p>'
                 '<h2 class="h2-sm" style="color:var(--forest-900)">Related in this pillar</h2>'
                 '</div>\n      <a class="textlink" href="%s.html">All %s \u2192</a>\n    </div>'
                 '\n    <div class="morelist" data-reveal="children" data-reveal-stagger="60">%s</div>'
                 '\n    <p class="cross-note"><span class="cross-kicker">%s</span>'
                 '<a class="textlink" href="%s">%s →</a></p>\n  </section>\n'
                 % (pil["slug"], esc(pil["name"].lower()), related,
                    esc(CROSS[a["pillar"]][1]), CROSS[a["pillar"]][0],
                    esc(CROSS[a["pillar"]][2])))

    rot = CTA_ROTATE[a.get("_i", 0) % len(CTA_ROTATE)]
    body += "\n" + CTA.format(h=esc(a.get("cta_h", rot[0])),
                              p=esc(a.get("cta_p", rot[1])))
    body += "\n</article>\n\n</main>\n\n" + FOOTER + TAIL
    return body


def render_pillar(p, arts):
    rows = ""
    for i, a in enumerate(arts, 1):
        rows += ('<a class="pidx" href="%s.html">'
                 '<span class="pidx-n">%02d</span>'
                 '<span><span class="pidx-t" style="display:block">%s</span>'
                 '<span class="pidx-d" style="display:block">%s</span></span>'
                 '<span class="pidx-go">Read \u2192</span></a>'
                 % (a["slug"], i, esc(a["title"]), esc(a["blurb"])))

    body = HEAD.format(title=esc(p["name"]) + ", Rayhab Movement Clinic",
                       desc=esc(p["desc"]), slug=p["slug"])
    body += NAV + "\n\n<main id=\"main\">\n\n"
    body += '''  <section class="art-hero">
    <p class="crumbs crumbs-dark"><a href="../">Home</a> <span aria-hidden="true">/</span> <a href="../education.html">Education</a> <span aria-hidden="true">/</span> <a href="./">Scoliosis</a></p>
    <p class="art-eyebrow" style="margin-top:18px">%s</p>
    <h1 class="art-h1">%s</h1>
    <p class="art-stand">%s</p>
  </section>

  <section class="band" style="background:var(--paper)">
    <div class="sechead">
      <div>
        <p class="eyebrow" style="margin-bottom:14px">%d articles</p>
        <h2 class="h2-sm" style="color:var(--forest-900)">Read in order, or jump in</h2>
      </div>
      <a class="textlink" href="./">Back to the hub \u2192</a>
    </div>
    <div class="pidx-list" data-reveal="children" data-reveal-stagger="55">%s</div>
    <p class="disclaimer" style="margin-top:26px">Every article on this page is written for patients and families, not clinicians, and carries a named clinical reviewer. General information cannot tell you what your own curve is doing.</p>
  </section>
''' % (esc(p["short"]), esc(p["name"]), esc(p["stand"]), len(arts), rows)

    body += "\n" + CTA.format(h="Read enough. What's next?",
                              p="A 60-minute assessment turns general information into a plan for your curve.")
    body += "\n</main>\n\n" + FOOTER + TAIL
    return body


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    data = json.load(io.open(os.path.join(here, "articles.json"), encoding="utf-8"))
    extra = json.load(io.open(os.path.join(here, "articles2.json"), encoding="utf-8"))
    pillars = {p["id"]: p for p in data["pillars"]}
    arts = data["articles"] + extra["articles"]
    lookup = {a["slug"]: a for a in arts}

    # Position within the pillar, used to rotate the closing line.
    seen = {}
    for a in arts:
        seen[a["pillar"]] = seen.get(a["pillar"], 0) + 1
        a["_i"] = seen[a["pillar"]] - 1

    n = 0
    for a in arts:
        html = render_article(a, lookup, pillars)
        io.open(os.path.join(OUT, a["slug"] + ".html"), "w",
                encoding="utf-8", newline="\n").write(inject(wrap_arrows(html)))
        n += 1

    for pid, p in pillars.items():
        group = [a for a in arts if a["pillar"] == pid]
        html = render_pillar(p, group)
        io.open(os.path.join(OUT, p["slug"] + ".html"), "w",
                encoding="utf-8", newline="\n").write(inject(wrap_arrows(html)))

    print("wrote %d articles and %d pillar pages" % (n, len(pillars)))
    for pid, p in pillars.items():
        print("  %-26s %d articles (claims %d)" %
              (p["slug"], len([a for a in arts if a["pillar"] == pid]), p["claim"]))


if __name__ == "__main__":
    main()
