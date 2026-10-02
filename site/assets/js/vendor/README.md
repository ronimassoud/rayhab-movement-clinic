# Vendored

GSAP 3.13.0 and its ScrollTrigger plugin, used by `../motion.js` on
`index.html` and `results.html` only.

There is no package.json in this repo, so provenance is recorded here.
Downloaded 2026-10-02 from:

    https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js
    https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollTrigger.min.js

| file | raw | gzip | sha256 |
|---|---|---|---|
| `gsap.min.js` | 72435 B | 28280 B | `96c01b81f44a3290e2b4532f55e2c9534b2adc43273a19f3756b2cb41f0fd0b6` |
| `ScrollTrigger.min.js` | 44157 B | 17888 B | `308219390e5e3b84cda0c481e70caa9820883ae10bda44e6e9a149a81aac4b3f` |

Verify after any change:

    cd site/assets/js/vendor && sha256sum gsap.min.js ScrollTrigger.min.js

## Why these are committed rather than loaded from a CDN

- A second origin costs a fresh DNS, TCP and TLS handshake before the first
  byte arrives. Self-hosted, they ride the connection already open for the
  stylesheets.
- Cross-origin cache sharing no longer exists under cache partitioning, so
  the "someone already has GSAP cached" argument does not hold.
- `.github/scripts/check_links.py` cannot verify a CDN URL, its pattern
  excludes `:`, but it does verify these paths. A deleted vendor file fails
  the deploy instead of breaking the live site silently.
- This is a scoliosis clinic. A CDN request from a page such as
  `just-diagnosed.html` would hand a third party the visitor's IP and a
  Referer naming the condition they are reading about.

The one real cost: GitHub Pages serves `Cache-Control: max-age=600` and
that cannot be changed, so a returning visitor revalidates every ten
minutes. A cheap 304, and worth the four reasons above.

## Licence

GSAP's standard licence covers this use. Committing the minified dist file
is what `npm i gsap` does; no modification has been made to either file.
