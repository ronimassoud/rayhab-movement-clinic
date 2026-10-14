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

The pages are static and the compiled stylesheet is committed, so viewing the
site needs nothing but that. Changing the styles needs Node:

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` rebuilds `site/assets/css/rayhab.css` on every save; `npm run build`
does one minified build. The deploy workflow runs the build again before it
publishes, so the live stylesheet cannot lag the source.

`python -m http.server` sends no cache headers, so browsers hold on to stale CSS
and JS between edits. Hard-refresh when something looks unchanged.

## Layout

```
site/                        the website, 72 pages
  index.html                 home
  about.html  contact.html  results.html  education.html  book.html
  scoliosis/                 hub, library + 7 views of it, 24 articles
  exercise/  sport/  posture/  mobility/  injury/
                             5 education hubs, 24 articles between them
  services/                  index + 4 service pages
  assets/css/rayhab.css      the one stylesheet, compiled. Do not edit it by hand
  assets/js/                 ui.js, booking.js, modal.js, contact.js, motion.js
  assets/js/vendor/          GSAP, ScrollTrigger, SplitText (pinned, self-hosted)
  assets/img/cases/          consented patient progress photographs
  assets/img/favicon.png     32px R monogram, cut from the wordmark
  assets/img/rayhab-logo.png the full-resolution master, not served
src/css/                     stylesheet source (see Design system)
content/                     generators and source content (see below)
package.json                 Tailwind and the pinned GSAP version, build only
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
```

`wire.py` and `wire_services.py` are **one-off patchers that have already
run**. They are kept for the record, not for the build. Do not run them:
`wire.py` would reintroduce the `.slot-txt` placeholder notes that were
deliberately moved into comments, and append sitemap URLs on `dr-rayhab.com`,
which is not the domain this site is served from. The three pages it
produced, the audience routes under `scoliosis/`, are maintained by hand.

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

## The scoliosis library

Twenty-four articles, one list, eight ways in. `library.html` is the whole
set; the four topic views and the three situation views are the same list
filtered, and every one of them renders from `render_index()` in
`build_articles.py` with a different subset.

They were separate pages over overlapping subsets before, which is why the
hub felt like it offered four competing routes into one shelf: a parent who
opened "Parents of adolescents" and then "Pillar 01" met the same layout
twice with nothing saying the two were one library. Seventeen of the
twenty-four appeared on more than one page with no way to tell.

Every view now carries the same bar of chips, so the relationship is
visible and switching is one click. The bar is plain links, so it works
without JavaScript; `ui.js` only nudges the horizontal track on a phone
so the active chip is not off-screen.

Adding a view means adding an entry to `routes` in `articles.json` and a
label in `VIEW_LABEL`. Nothing else changes.

## Motion

GSAP 3.13 with ScrollTrigger drives all movement, from one file,
`site/assets/js/motion.js`, on every page except `book.html`. SplitText is
loaded on the home page only, where a headline is split.

| Scene | What it does |
|---|---|
| reveals | sections rise as they enter, driven by `data-reveal` in the markup |
| hero | the floating cards and the photo fan settle into place |
| headline | the home headline rises line by line |
| tilt | the three quotes close from a wider fan as they scroll in |
| nav | the floating pill steps aside going down and returns going up |
| line art | the Cobb-angle drawing in the closing band draws with the scroll |
| process | the rule above each of the six stages fills in turn |
| count | the measured angles count to their result |
| reading | progress across an article's body |
| cases | where you are in the five case studies |

The markup API for reveals, so the Python generators can emit them without the
script carrying a list of selectors:

```
data-reveal                 fade and rise this element
data-reveal="children"      stagger its direct children instead
data-reveal-stagger="60"    ms between children (default 70)
data-reveal-delay="120"     ms before the group starts
data-reveal-y="8"           px of travel (default 14)
```

Three rules hold for every scene.

- **Nothing is required.** An inline script in the head adds `.js-motion` to
  `<html>`, which is the only thing that hides a reveal target, and arms a
  2600 ms failsafe that removes it again. `motion.js` disarms it when it takes
  over. If GSAP is blocked or never arrives, `ui.js` drops the class as soon as
  the page has loaded. Either way the page is simply visible.
- **Reduced motion is checked in the script.** The stylesheet's global
  `prefers-reduced-motion` switch stops CSS transitions but cannot reach the
  inline styles GSAP writes each frame. Every scene is therefore registered
  inside `gsap.matchMedia()` on that query, and the head script never adds the
  class when the preference is set.
- **No scroll hijacking.** `normalizeScroll` and ScrollSmoother are never used.
  Either would break the fixed nav, the fixed booking bar and scrolling inside
  the booking dialog.

`content/motion_tags.py` injects the head script and the script tags into all
63 generated pages and the 8 hand-written ones, and `.github/scripts/check_links.py`
fails the deploy if any page but `book.html` is missing them.

## GSAP

Self-hosted in `site/assets/js/vendor/`, pinned to 3.13.0 in `package.json`, with
hashes in `vendor/README.md`. It is not loaded from a CDN: that would add a
second origin to every first visit, and on a health site it would hand a third
party the visitor's address together with the page they were reading.

Cost: about 46 KB gzipped for the core and ScrollTrigger on every page, plus
3.5 KB for SplitText on the home page. All three load with `defer`.

Things to keep when adding a scene:

- Use `gsap.matchMedia()` and the site's own breakpoints (700, 1060).
- Scrubbed and pinned work is desktop only.
- `document.fonts.ready` already triggers a refresh. Bricolage loads with
  `display=swap`, and the swap moves every heading.
- Triggers are disabled while the booking dialog is open, because
  `html.modal-open` changes the scroller's height.
- Animate `--tilt`, not `rotation`, on a tilted card. The lean is the CSS
  `rotate` property, which leaves `transform` free.

## Design system

Rayhab's own palette and typefaces, arranged on the structure of the Tomorro
reference system: a 1200px column on full-bleed bands, a floating pill
navigation, editorial display type, flat cards, and elevation held back for the
few things that float.

**Source.** `src/css/` compiles through Tailwind v4 into one file.

| File | Holds |
|---|---|
| `theme.css` | the tokens, in Tailwind's `@theme`. Colour, type scale, radius, breakpoints, shadow |
| `base.css` | document defaults, focus, runtime variables, the reduced-motion switch |
| `components.css` | surfaces, type classes, navigation, buttons, cards, media, tilt, closing band, footer |
| `site.css` | page composition and interaction |
| `mobile.css` | the phone compositions, which are separate layouts rather than reflowed desktop |
| `booking.css` | the booking flow and its dialog |

Tailwind's default palette, fonts, radii and shadows are cleared in `theme.css`,
so only brand values exist as utilities. Utilities in the markup handle one-off
spacing, width and colour; anything repeated is a named component, because 63
pages are generated and there is no component framework to hold fifteen
utilities in one place.

**Tokens.**

| | |
|---|---|
| Surfaces | `forest-900` dark, `paper` page, `bone` elevated and tinted, `ink-950` nav and footer |
| Action | `spring-500`, hover `spring-400`, pressed `spring-600`. The only filled action colour |
| Text | `fg`, `fg-2`, `body` on light; `bone`, `on-dark`, `on-dark-2` on dark. `muted` and `fg-3` are for non-text only: they do not reach 4.5:1 |
| Type | Bricolage Grotesque 700 for display, Public Sans 400 to 600 for everything read |
| Scale | `display-2xl` 80, `display-xl` 56, `display` 40, `heading-lg` 32, `heading` 24, `heading-sm` 20, `sub` 18, `body` 16, `body-sm` 14, `caption` 12. The top four are fluid |
| Radius | `xs` 8, `sm` 12, `md` 16, `lg` 24, `xl` 28, `2xl` 40, `pill` |
| Spacing | 4px steps below 24, 8px steps from 24. Sections use `--section-y` |
| Shadow | `nav` and `float`. Nothing else has one |

**Surfaces.** A section is `.s-light`, `.s-tint` or `.s-dark`. Each sets
`--card-bg` and `--card-line`, and cards read those, so a card never needs to
know which band it sits in.

**Buttons.** A pill (`.btn`, with `.btn-md` and `.btn-sm`) moves the visitor on.
The compact 8px `.btn-compact` is a control inside an interface.

**Cards** are flat: a surface and a hairline. A card that is a link answers the
cursor with its edge and its arrow. One that is not does nothing, so a response
always means there is somewhere to go.

**Tilted cards.** `.tilt` leans a card by `--tilt` (default 5 degrees, `.tilt-l`
for the other way) and gives it the floating shadow. A leaning card straightens
on hover and on keyboard focus. Text cards flatten below 700px; the photo fan on
the results page keeps its lean. Under reduced motion the lean stays, as a pose,
and stops animating.

**Empty photo wells.** Photography for the services and the articles has not
been shot. A small well inside a card collapses until it has an image, and a
large one becomes a forest panel with the clinic's Cobb-angle line drawing. The
art direction for each shot is still in the markup as a comment.

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
