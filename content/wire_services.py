# -*- coding: utf-8 -*-
"""Point every card and footer stub at the three new service pages."""
import io, os, re, glob

SITE = r"C:/Users/Roni Massoud/Desktop/Dr. Rayhab/site"
here = os.path.dirname(os.path.abspath(__file__))

SERVICES = [("Sports Rehabilitation", "sports-rehabilitation"),
            ("FRC &amp; Joint Training", "frc-joint-training"),
            ("Physiotherapy", "physiotherapy")]


def rw(path, fn):
    p = os.path.join(SITE, path)
    s = io.open(p, encoding="utf-8").read()
    out = fn(s)
    if out != s:
        io.open(p, "w", encoding="utf-8", newline="\n").write(out)
        return True
    return False


# ---- 1. home: the three svc-cards become links ----
def home(s):
    for title, slug in SERVICES:
        old = ('<div class="svc-card">\n          <p class="h5" style="margin-bottom:6px;'
               'color:var(--forest-900)">%s</p>' % title)
        new = ('<a class="svc-card is-linked" href="services/%s.html">\n          '
               '<p class="h5" style="margin-bottom:6px;color:var(--forest-900)">%s</p>'
               % (slug, title))
        assert old in s, "home card not found: " + title
        s = s.replace(old, new, 1)
    # close the three converted divs: they are the only .svc-card blocks
    parts = s.split('<a class="svc-card is-linked"')
    rebuilt = [parts[0]]
    for chunk in parts[1:]:
        rebuilt.append(chunk.replace("</div>", "</a>", 1))
    return '<a class="svc-card is-linked"'.join(rebuilt)


print("index.html       ", rw("index.html", home))


# ---- 2. services index: supcards become links ----
def svcidx(s):
    for title, slug in SERVICES:
        # the whole card becomes the link, and its dead arrow becomes real
        old = ('<article class="supcard">\n        <span class="slot supcard-media">'
               '<span class="slot-txt">')
        if old in s:
            s = s.replace(old, '<a class="supcard is-linked" href="%s.html">\n        '
                               '<span class="slot supcard-media"><span class="slot-txt">' % slug, 1)
    s = s.replace('<span class="supcard-link">View service \u2192</span>',
                  '<span class="supcard-link">View service \u2192</span>')
    # close them
    parts = s.split('<a class="supcard is-linked"')
    rebuilt = [parts[0]]
    for chunk in parts[1:]:
        rebuilt.append(chunk.replace("</article>", "</a>", 1))
    return '<a class="supcard is-linked"'.join(rebuilt)


print("services/index   ", rw("services/index.html", svcidx))


# ---- 3. footers everywhere: the .soon stubs become links ----
FOOT_OLD_1 = '''      <span class="soon">Sports rehabilitation</span>
      <span class="soon">FRC &amp; joint training</span>'''

n = 0
for p in glob.glob(os.path.join(SITE, "*.html")) + glob.glob(os.path.join(SITE, "*", "*.html")):
    s = io.open(p, encoding="utf-8").read()
    if FOOT_OLD_1 not in s:
        continue
    # depth-correct prefix: pages inside a folder need ../ or a bare name
    rel = os.path.relpath(p, SITE).replace("\\", "/")
    if rel.startswith("services/"):
        pre = ""
    elif "/" in rel:
        pre = "../services/"
    else:
        pre = "services/"
    new = ('      <a href="%ssports-rehabilitation.html">Sports rehabilitation</a>\n'
           '      <a href="%sfrc-joint-training.html">FRC &amp; joint training</a>\n'
           '      <a href="%sphysiotherapy.html">Physiotherapy</a>' % (pre, pre, pre))
    s = s.replace(FOOT_OLD_1, new)
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)
    n += 1
print("footers updated  ", n)


# ---- 4. keep the article generator's footer in step ----
gen = os.path.join(here, "build_articles.py")
s = io.open(gen, encoding="utf-8").read()
if FOOT_OLD_1.replace("      ", "      ") in s:
    s = s.replace('''      <span class="soon">Sports rehabilitation</span>
      <span class="soon">FRC &amp; joint training</span>''',
'''      <a href="../services/sports-rehabilitation.html">Sports rehabilitation</a>
      <a href="../services/frc-joint-training.html">FRC &amp; joint training</a>
      <a href="../services/physiotherapy.html">Physiotherapy</a>''')
    io.open(gen, "w", encoding="utf-8", newline="\n").write(s)
    print("article generator footer updated")


# ---- 5. sitemap ----
sm = os.path.join(SITE, "sitemap.xml")
s = io.open(sm, encoding="utf-8").read()
add = "".join('  <url><loc>https://dr-rayhab.com/services/%s.html</loc></url>\n' % slug
              for _, slug in SERVICES
              if ("/services/%s.html" % slug) not in s)
s = s.replace("</urlset>", add + "</urlset>")
io.open(sm, "w", encoding="utf-8", newline="\n").write(s)
print("sitemap          ", add.count("<url>"), "added")
