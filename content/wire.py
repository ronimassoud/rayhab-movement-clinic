# -*- coding: utf-8 -*-
"""Build the three audience routes and point every existing card at the
articles that now exist."""
import io, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_articles as B

SITE = B.SITE
OUT = B.OUT
here = os.path.dirname(os.path.abspath(__file__))

data = json.load(io.open(os.path.join(here, "articles.json"), encoding="utf-8"))
extra = json.load(io.open(os.path.join(here, "articles2.json"), encoding="utf-8"))
arts = data["articles"] + extra["articles"]
lookup = {a["slug"]: a for a in arts}
pillars = {p["id"]: p for p in data["pillars"]}

# The hub's route cards claim 7, 6 and 4 articles. These are audience routes
# through the same library, so the same article can appear in more than one.
ROUTES = [
 {"id":"r1","slug":"for-parents","name":"For parents of adolescents","short":"Route \u00b7 Parents of adolescents","claim":7,
  "desc":"The scoliosis articles that matter most to parents: what a diagnosis means, what predicts progression, how bracing works, and how to support a teenager doing daily exercises.",
  "stand":"Seven articles, in the order most parents need them, from the week of diagnosis onwards.",
  "items":["just-diagnosed","what-scoliosis-actually-is","cobb-angle","will-it-get-worse",
           "growth-and-skeletal-maturity","working-alongside-a-brace","teenager-exercises"]},
 {"id":"r2","slug":"for-adults","name":"For adults with a curve","short":"Route \u00b7 Adults with a curve","claim":6,
  "desc":"Scoliosis articles for adults: how adult curves differ, what the link with pain really is, how to train for decades, and what an assessment covers.",
  "stand":"Six articles for a curve that has stopped growing, where the questions are about pain, capacity and the next thirty years.",
  "items":["adult-scoliosis","scoliosis-and-pain","what-scoliosis-actually-is",
           "lifting-with-scoliosis","programme-you-run-yourself","inside-the-assessment"]},
 {"id":"r3","slug":"for-athletes","name":"For athletes and lifters","short":"Route \u00b7 Athletes and lifters","claim":4,
  "desc":"Scoliosis articles for athletes and lifters: loading a curved spine, asymmetric sports, returning to play on criteria, and why stopping is rarely the answer.",
  "stand":"Four articles on loading a curved spine well, rather than avoiding load and hoping.",
  "items":["lifting-with-scoliosis","return-to-sport","curve-specific-exercise","scoliosis-and-pain"]},
]

for r in ROUTES:
    group = [lookup[s] for s in r["items"]]
    assert len(group) == r["claim"], "%s: %d vs claim %d" % (r["slug"], len(group), r["claim"])
    html = B.render_pillar(r, group)
    io.open(os.path.join(OUT, r["slug"] + ".html"), "w", encoding="utf-8", newline="\n").write(html)
print("wrote %d audience routes" % len(ROUTES))


def edit(path, pairs, must=True):
    p = os.path.join(SITE, path)
    s = io.open(p, encoding="utf-8").read()
    n = 0
    for old, new in pairs:
        if old in s:
            s = s.replace(old, new, 1); n += 1
        elif must:
            raise AssertionError("NOT FOUND in %s:\n%s" % (path, old[:110]))
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)
    print("  %-28s %d edits" % (path, n))


# ---------------- scoliosis hub ----------------
pairs = []

# pillar titles become links to their index pages
for pid, slug, title, tag in [
        ("p1", "what-scoliosis-is", "What scoliosis is", "pillar-t-lg"),
        ("p2", "the-schroth-method", "The Schroth Method", "pillar-t"),
        ("p3", "rayhabs-approach", "Rayhab's approach", "pillar-t"),
        ("p4", "the-assessment", "The assessment", "pillar-t")]:
    pairs.append(('<h3 class="%s">%s</h3>' % (tag, title),
                  '<h3 class="%s"><a href="%s.html">%s</a></h3>' % (tag, slug, title)))
    pairs.append(('<article class="pillar%s">' % (" pillar-wide" if tag == "pillar-t-lg" else ""),
                  '<article class="pillar%s is-linked">' % (" pillar-wide" if tag == "pillar-t-lg" else "")))

# route cards: real titles, real links, and the whole card becomes the link
route_titles = [
 ("Your child was just diagnosed. What now?", "just-diagnosed"),
 ("Growth spurts and progression risk", "will-it-get-worse"),
 ("Does scoliosis get worse in adulthood?", "adult-scoliosis"),
 ("Why your back hurts on one side", "scoliosis-and-pain"),
 ("Can you lift weights with scoliosis?", "lifting-with-scoliosis"),
 ("Asymmetric sports and rotation", "return-to-sport"),
]
for title, slug in route_titles:
    for pre in ('<span style="color:var(--spring-50)">', '<span>'):
        old = pre + title + '</span>'
        new = '<a href="%s.html"%s>%s</a>' % (
            slug, ' style="color:var(--spring-50);text-decoration:underline;text-underline-offset:3px"'
            if 'spring-50' in pre else ' style="text-decoration:underline;text-underline-offset:3px"',
            lookup[slug]["title"])
        pairs.append((old, new))

pairs += [
 ('<span class="route-more">7 articles \u2192</span>',
  '<a class="route-more" href="for-parents.html">7 articles \u2192</a>'),
 ('<span class="route-more route-more-light">6 articles \u2192</span>',
  '<a class="route-more route-more-light" href="for-adults.html">6 articles \u2192</a>'),
 ('<span class="route-more route-more-light">4 articles \u2192</span>',
  '<a class="route-more route-more-light" href="for-athletes.html">4 articles \u2192</a>'),
]
edit("scoliosis/index.html", pairs, must=False)

# ---------------- latest-article cards, hub + education ----------------
LATEST = [
 ("Reading your Cobb angle: what the number does and doesn't tell you", "cobb-angle"),
 ("What rotational breathing actually is", "rotational-breathing"),
 ("Getting a teenager to actually do their exercises", "teenager-exercises"),
]
for page, prefix in [("scoliosis/index.html", ""), ("education.html", "scoliosis/")]:
    pr = []
    for title, slug in LATEST:
        pr.append(('<h3 class="art-t">%s</h3>' % title,
                   '<h3 class="art-t"><a href="%s%s.html">%s</a></h3>' % (prefix, slug, title)))
    edit(page, pr, must=False)

# ---------------- home education cards ----------------
HOME = [
 ("What the Schroth Method actually involves", "what-schroth-involves"),
 ("Can you lift weights with scoliosis?", "lifting-with-scoliosis"),
 ("Your child was just diagnosed. What now?", "just-diagnosed"),
]
pr = []
for title, slug in HOME:
    pr.append(('<a class="edu-card" href="scoliosis/">\n        <span class="slot edu-media"><span class="slot-txt">Article image</span></span>\n        <span class="edu-body">\n          <span class="edu-kicker">',
               '<a class="edu-card" href="scoliosis/%s.html">\n        <span class="slot edu-media"><span class="slot-txt">Article image</span></span>\n        <span class="edu-body">\n          <span class="edu-kicker">' % slug))
edit("index.html", pr, must=False)

# ---------------- sitemap ----------------
new_urls = ([p["slug"] for p in data["pillars"]] + [r["slug"] for r in ROUTES]
            + [a["slug"] for a in arts])
sm = os.path.join(SITE, "sitemap.xml")
s = io.open(sm, encoding="utf-8").read()
add = "".join("  <url><loc>https://dr-rayhab.com/scoliosis/%s.html</loc></url>\n" % u
              for u in new_urls if ("/scoliosis/%s.html" % u) not in s)
s = s.replace("</urlset>", add + "</urlset>")
io.open(sm, "w", encoding="utf-8", newline="\n").write(s)
print("  sitemap: +%d urls" % len(new_urls))
