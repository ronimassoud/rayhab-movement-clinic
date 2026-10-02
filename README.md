# Rayhab Movement Clinic

Website for Rayhab Movement Clinic, Beirut. Specialised scoliosis rehabilitation,
Schroth-based, plus sports rehabilitation, FRC and joint training, and general
physiotherapy.

Static site: plain HTML, CSS custom properties and vanilla JavaScript. No build
step and no framework. Open `site/index.html` or serve the `site/` directory.

- **Live site:** <https://ronimassoud.github.io/rayhab-movement-clinic/>
- **Repository:** <https://github.com/ronimassoud/rayhab-movement-clinic>
- **Design canvas:** [Rayhab UI on Claude Design](https://claude.ai/design/p/c0ba2874-187e-4463-b422-73d41cc99cb9?file=Rayhab+UI.dc.html)
  (the source the site was built from, kept byte-exact at `Rayhab UI.dc.html`)

> **This site is live and publicly indexed while the items under
> [Before launch](#before-launch) are still open.** That was a deliberate
> decision, not an oversight. It means clinical photographs of identifiable
> patients and 48 articles still marked "Awaiting clinical review" are
> publicly reachable. Close those items, or take the deploy down, before
> treating this as finished.

## Deployment

Pushing to `main` publishes `site/` to GitHub Pages via
`.github/workflows/pages.yml`. The workflow runs `.github/scripts/check_links.py`
first and fails the deploy if any internal link is broken.

Canonical URLs, `sitemap.xml` and `robots.txt` point at the Pages address. When
the real domain is ready, set it as a custom domain in the repository's Pages
settings and replace that base URL across `site/` and in the two builders in
`content/`, which hold it so a rebuild does not revert it.

## Running it

```bash
python -m http.server 4488 --directory site
```

Then open <http://localhost:4488>. A `.claude/launch.json` config is included for
the editor's preview pane.

`python -m http.server` sends no cache headers, so browsers hold on to stale CSS
and JS between edits. Hard-refresh when something looks unchanged.

## Layout

```
site/                        the website, 72 pages
  index.html                 home
  about.html  contact.html  results.html  education.html  book.html
  scoliosis/                 hub, 4 pillar indexes, 3 audience routes, 24 articles
  exercise/  sport/  posture/  mobility/  injury/
                             5 education hubs, 24 articles between them
  services/                  index + 4 service pages
  assets/css/                rayhab.css (design system), mobile.css, booking.css
  assets/js/                 ui.js, booking.js, modal.js, contact.js
  assets/img/cases/          consented patient progress photographs
  assets/img/favicon.png     32px R monogram, cut from the wordmark
  assets/img/rayhab-logo.png the full-resolution master, not served
content/                     generators and source content (see below)
Rayhab UI.dc.html            the original Claude Design canvas, byte-exact
brief.txt                    the original written brief
```

## Regenerating content

The 48 articles, the 5 non-scoliosis education hubs and the 3 supporting service
pages are generated, not hand-written as HTML. Prose lives in JSON so it can be
edited without touching 72 files.

```bash
cd content
python build_articles.py     # 24 scoliosis articles + 4 pillar index pages
python build_topics.py       # 5 education hubs + 24 articles
python build_services.py     # 3 supporting service pages
python wire.py               # audience routes + cross-links + sitemap
python wire_services.py      # service cards, footers, sitemap
```

`build_articles.py` and `build_topics.py` derive each article's reading time from
its own word count, so the label cannot drift from the text. The scoliosis library
carries the Schroth byline; the five general hubs carry the credential that
actually applies to them, which is set per topic. All three builders wrap trailing
navigational arrows for the hover animation; data arrows such as `29° → 20°`
are deliberately left alone.

## Brand assets

`rayhab-logo.png` is the 2172x724 master and is not referenced by any page.
The two assets that ship are derived from it:

- `favicon.png` (32px) and `apple-touch-icon.png` (180px) carry the R
  monogram alone. The full wordmark is 3:1, so at 16px it renders as an
  illegible smear; one letterform is the only thing that reads at that size.
- `rayhab-wordmark.png` is the CSS mask behind `.wordmark`. It is 448px wide
  for a 112px render, which covers 4x device pixel ratio, and its colour
  planes are flattened because `mask-image` reads only the alpha channel.

Regenerate both from the master rather than editing them in place.

## Motion

Reveals are CSS transitions driven by an IntersectionObserver in
`site/assets/js/reveal.js`. They are deliberately not done in JavaScript:
the global `prefers-reduced-motion` kill-switch in `rayhab.css` neutralises
CSS transitions and has no effect on inline styles written per frame, so a
JS-driven reveal would need a second copy of that policy, and the two would
eventually disagree.

Markup API, so the generators emit reveals without the script holding a
list of selectors:

```
data-reveal                 fade and rise this element
data-reveal="children"      stagger its direct children instead
data-reveal-stagger="60"    ms between children (default 70)
data-reveal-delay="120"     ms before the group starts
data-reveal-y="8"           px of travel (default 14; 0 fades only)
```

Three rules this system lives by:

- **Nothing hides without `html.js-motion`.** An inline script in the head
  adds it, and arms a 2600 ms failsafe that removes it again. If `reveal.js`
  is blocked, 404s or fails to parse, the class comes off and the page is
  simply visible. Tested by pointing the script at a missing file.
- **A revealed element loses its `data-reveal` attribute.** The reveal rules
  tie with the card hover-lift rules on specificity and win on source order,
  so leaving them matching would silently kill the lift on every linked
  card. Removing the attribute is what prevents that.
- **Heroes are never revealed.** They are the LCP element, and hiding one to
  fade it in is how a fast page is made to feel slow.

`content/motion_tags.py` injects the gate and the script tag, after
formatting, the same way `wrap_arrows()` already works. The same function
serves the hand-written pages, so there is one definition. `book.html` is
excluded by construction: it has no `modal.js`, which is the anchor.
`check_links.py` fails the deploy if any other page is missing either.

## Design system

Tokens are defined once at the top of `assets/css/rayhab.css` and transcribed
from the design canvas rather than from a summary table. Forest and spring
greens, warm neutrals, Bricolage Grotesque for display and Public Sans for text.

Motion follows one rule: colour transitions at `0.15s`, movement at `0.24s` on
`cubic-bezier(.2,.8,.2,1)`, imagery at `0.55s`. Anything that moves sits behind
`@media (hover:hover) and (pointer:fine)` so touch devices do not get stuck
hover states, and `prefers-reduced-motion` strips transforms throughout.

Cards that lift and cast a shadow on hover are cards you can click. Placeholder
cards warm slightly but never lift, so a hover never promises a link that is not
there.

## Before launch

Known gaps, all deliberate rather than overlooked:

- [ ] **Clinical review.** All 48 articles display "Awaiting clinical review".
      Rayan reads them, then one flag per article in `content/articles*.json`
      and `content/topics/*.json` flips the status to a real reviewed date.
      This is blocking, and it now covers 24 general musculoskeletal articles
      on back, knee, hip, shoulder and neck pain as well as the scoliosis set.
- [ ] **Patient consent.** Confirm written consent covers website use for all
      five case studies, in particular the Instagram comment used for Case 04.
- [ ] **Photography.** Every page carries art-directed photo slots with
      direction text, waiting on real images.
- [ ] **Contact details.** Phone, address and email are placeholders.
- [ ] **Contact form.** Validates, but has no mail endpoint. The branch to
      replace is marked in `assets/js/contact.js`.
- [ ] **Booking.** The four-step flow works end to end in the browser but has no
      backend; nothing is sent or stored.
- [ ] **Case studies.** The three case-study cards on the results page are
      written as "In preparation" pending consented write-ups.

## Editorial conventions

These are load-bearing, not stylistic preferences:

- Where evidence is genuinely uncertain, articles say so in a dedicated
  "What is not settled" block rather than smoothing it over.
- No outcome is promised. Individual results vary, and the pages say so.
- Only measurements that exist are shown. One case study carries Cobb angles
  because an X-ray exists; the rest are labelled photographic.
- Unwritten content reads "In preparation" and does not link anywhere.
- No em dashes in anything written here: site copy, generator content and code
  comments all use a comma or a semicolon instead. The imported canvas and its
  runtime JavaScript still contain them, and are left byte-exact on purpose.
