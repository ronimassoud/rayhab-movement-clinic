# Rayhab Movement Clinic

Website for Rayhab Movement Clinic, Beirut. Specialised scoliosis rehabilitation,
Schroth-based, plus sports rehabilitation, FRC and joint training, and general
physiotherapy.

Static site: plain HTML, CSS custom properties and vanilla JavaScript. No build
step and no framework. Open `site/index.html` or serve the `site/` directory.

> **This repository is private, and should stay that way until the points under
> [Before launch](#before-launch) are resolved.** It contains clinical
> photographs of identifiable patients and 24 patient-facing clinical articles
> that have not yet been reviewed by a clinician.

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
site/                        the website, 43 pages
  index.html                 home
  about.html  contact.html  results.html  education.html  book.html
  scoliosis/                 hub, 4 pillar indexes, 3 audience routes, 24 articles
  services/                  index + 4 service pages
  assets/css/                rayhab.css (design system), mobile.css, booking.css
  assets/js/                 ui.js, booking.js, modal.js, contact.js
  assets/img/cases/          consented patient progress photographs
content/                     generators and source content (see below)
Rayhab UI.dc.html            the original Claude Design canvas, byte-exact
brief.txt                    the original written brief
```

## Regenerating content

The 24 scoliosis articles and the 3 supporting service pages are generated, not
hand-written as HTML. Prose lives in JSON so it can be edited without touching
43 files.

```bash
cd content
python build_articles.py     # 24 articles + 4 pillar index pages
python build_services.py     # 3 supporting service pages
python wire.py               # audience routes + cross-links + sitemap
python wire_services.py      # service cards, footers, sitemap
```

`build_articles.py` derives each article's reading time from its own word count,
so the label cannot drift from the text. Both builders wrap trailing
navigational arrows for the hover animation; data arrows such as `29° → 20°`
are deliberately left alone.

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

- [ ] **Clinical review.** All 24 articles display "Awaiting clinical review".
      Rayan reads them, then one flag per article in `content/articles*.json`
      flips the status to a real reviewed date. This is blocking.
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
- No em dashes anywhere in the site copy or the source.
