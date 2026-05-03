# Doc updates — 2026-05-03 session

Paste-ready blocks for each KB doc affected by today's ship. All sections are self-contained — drop them in verbatim under the matching heading or append to the changelog section of the doc.

Session shipped: hero topographic background image with optimized delivery, gallery commission banner + bottom CTA, per-card "Request similar →" deep-link with cross- and same-page form hydration, hero stats expanded to four columns, new Fluffytail Fox portfolio project, and a reproducible image-optimization workflow. Most-impactful change: hero LCP went from 12.9 MB to 41–67 KB depending on browser/format, a ~193× reduction.

---

## For `01-OVERVIEW.md`

### Hero section

Hero now wears a layered background composition:

1. **Bottom layer:** an inline 716-byte LQIP (40-pixel blurred JPEG, base64 in `.hero-bg`'s `background-image`) — paints with the first byte of HTML so visitors see colour and shape immediately.
2. **Image layer:** a `<picture>` element with three `<source>` tiers (AVIF / WebP / JPG fallback `<img>`), each with a 3-step responsive `srcset` at 1280 / 1920 / 2880 widths. Browser auto-picks the smallest acceptable file.
3. **Scrim layer:** a centred radial spotlight at 95% inner opacity fading to transparent at the corners, plus a softer top/bottom band — keeps the headline + CTAs readable on the busy artwork while letting the topographic detail breathe at the edges.
4. **Particle layer:** a canvas of 28–90 drifting particles (~30% warm orange embers with glow, the rest tiny white dust) layered with `mix-blend-mode: screen` so they read as sparks over the surface, with thin connection lines between any pair within 110 px. Pauses when the tab is hidden, when the hero scrolls out via IntersectionObserver, and respects `prefers-reduced-motion`.
5. **Content layer:** the hero badge, title, sub-copy, CTAs, and scroll indicator at the highest z-index, vertically centred (banner-visible body now uses `justify-content: center` instead of `flex-start`).

The scroll indicator at the bottom of the hero has its own local `::before` radial backplate (220×130 px ellipse, blurred 14 px, centre 92% black) so the "Scroll" label and pulsing line read against any image content underneath without the rest of the hero darkening.

### Stats strip — four columns

The post-hero stats strip now shows four cells: **Prints Completed (300+)**, **Min Layer Height (0.05 mm)**, **Materials Available (12+)**, **Print Technologies (FDM · Resin / FDM · Żywica)**. Desktop CSS uses `grid-template-columns: repeat(4, 1fr)`; mobile collapses to a 2×2 grid via existing breakpoint rules. New i18n keys: `stats.materials`, `stats.tech`, `stats.tech_value`.

### Gallery page (gallery.html)

Two new components:

- **Top commission banner** (mirrors the home page's `.commission-banner`): same thumb stack, "Commissions Open / Want something printed?" headline, "Request a Print →" CTA, IG follow chip. Links route to `index.html#contact` (cross-page). The banner CSS is duplicated into gallery.html — same component, no shared stylesheet yet.
- **Bottom CTA section** (`.gallery-cta`): a 760 px max-width "Have an idea? Let's print it." block with a "Start a Project →" button linking to `index.html#contact`. Sits inside `.gallery-page`, separated by a top border. New i18n keys: `gallery.cta_title`, `gallery.cta_title_accent`, `gallery.cta_desc`, `gallery.cta_btn`.

### "Request similar" deep-link on every gallery / portfolio card

A small orange pill ("Request similar →") is injected at runtime into each `.card-body` on both gallery.html and the home page portfolio grid. It does not exist in the static HTML — a single IIFE in each file's main `<script>` decorates every `.gallery-card` after the DOM parses.

- **On gallery.html (cross-page):** the pill is an anchor pointing to `index.html?type=<form.opt-key>&inspired=<projectName>#contact`. The browser navigates to the home page, the URL params survive the navigation, and the contact form's hydrator pre-selects the Project Type dropdown and prefills Project Details with `Inspired by: <name>`.
- **On index.html (same-page):** the pill's click handler calls `e.preventDefault()`, fills the form directly via DOM, and `scrollIntoView({behavior:'smooth'})` to `#contact`. No reload, no URL pollution.

The category mapping that drives the deep link:

```js
{ miniatures: 'mini', artistic: 'art', functional: 'custom', prototypes: 'proto', educational: 'workshop' }
```

The script uses `getElementById('contact')` to detect which page it's on (`null` → cross-page, present → same-page). Single source of truth, two files.

New i18n keys (both pages): `gallery.request_similar`, `contact.inspired_prefix`.

### Portfolio addition — Fluffytail Fox

Added to gallery.html (Artistic · Miniatures). 7 photos, designer credit links to `https://makerworld.com/en/@fluffytails37`. Lightbox uses Thumbnail.png as cover and 1.png–6.png as the gallery sequence. Filter category set to `miniatures` so it appears under that filter chip.

---

## For `04-DEPLOY.md`

### Image asset optimization workflow (NEW — adopt for every new portfolio project AND for the hero)

**Why.** Photos coming straight from a phone or DSLR are 8–25 MB each at native dimensions (3000–6000 px). Shipped raw, they tank LCP, blow up the git repo, and burn visitors' mobile data. The old hero PNG was 12.9 MB — a single visit pulled more bytes than the rest of the site combined. Browsers don't even reliably *render* PNGs above ~10 MB without stalling.

**Workflow.** All originals get archived locally, never committed. The git-tracked versions are web-optimized variants at the same filenames the HTML already references (so no markup changes when re-running the workflow on existing assets).

```
Images/<Folder>/
├── Thumbnail.png       <- web-optimized (1.5–3 MB)
├── 1.png – N.png       <- web-optimized
└── _originals/         <- gitignored, never committed
    └── (raw camera files)
```

**Steps for portfolio photos** (per project):

1. Drop raw files into `Images/Portfolio/<Project_Name>/`.
2. Run the Pillow resize: thumbnail capped to **1600 px longest side**, lightbox images to **2400 px**, all PNG with `optimize=True, compress_level=9`. Originals get moved to `_originals/` first.
3. Confirm folder weight is under ~25 MB total (was 124 MB for Fluffytail Fox before optimization, dropped to 24 MB).
4. Commit only the web-optimized files. `_originals/` stays untracked.

**Steps for the hero image** (one-time, but reproducible):

The hero needs more aggressive treatment because it's above-the-fold and blocks LCP. Three sizes × three formats:

| Width | AVIF | WebP | JPG |
|---|---|---|---|
| 1280 px (mobile) | ~41 KB | ~71 KB | ~134 KB |
| 1920 px (desktop) | ~67 KB | ~121 KB | ~255 KB |
| 2880 px (retina/4K) | ~99 KB | ~194 KB | ~463 KB |

Generated via Pillow with `pillow-avif-plugin` registered. AVIF quality 55, WebP quality 80 method 6, JPG quality 85 progressive optimize. Convert to RGB first (drops alpha — saves ~25%).

The HTML wraps the asset in a `<picture>` element with `<source type="image/avif">`, `<source type="image/webp">`, and a JPG `<img>` fallback. Browser picks the first format it supports. Add two `<link rel="preload" as="image" type="image/avif|webp">` lines in `<head>` with matching `imagesrcset` so the browser starts fetching the hero before it parses the body. Inline a 40-pixel LQIP as a base64 `background-image` on `.hero-bg` for instant first paint.

**Reproducibility.** The Python recipe is `/tmp/optimize_hero.py` and `/tmp/apply_gallery_edits.py` — keep these in `_scripts/` if you want a permanent home, or just regenerate them next time.

### Two-part ship rule (reinforced)

The 04-21 doc-updates rule (stage binary assets in the same commit as the HTML referencing them) hit again twice this session in different forms:

1. **Hero image:** the optimized variants and the `<picture>` HTML have to ship together. Half-shipping = either 404s for missing variants or unused HTML pointing at deleted PNG.
2. **Fluffytail Fox:** Thumbnail.png pushed but 1–6.png didn't get staged by the user, leading to "thumbnail loads but lightbox 404s" symptom on the live site. A single explicit `git add` of every file in the folder (or `git add Images/Portfolio/Fluffytail_Fox/`) prevents this.

Always run `git status` and check the "Untracked files" + "Changes not staged" sections before pushing. Treat `git status` as the deploy-readiness check.

### Don't `git add .`

Reinforced because the temptation is high when there are many new files. Always explicit paths. The two backup files this session (`05-03-2026-gallery-backup-original.html`, `05-03-2026-index-pre-hero-bg-backup.html`) and the `_originals/` subfolders should never end up in git — explicit `git add` of the actual changed files keeps them out.

### `git rm --cached` for the old hero PNG

After replacing `Images/Hero/hero-bg.png` with the picture-element variants, the old single-file PNG was moved to `_originals/` on disk but its tracked-in-git entry pointed at the now-empty path. Use `git rm --cached "Images/Hero/hero-bg.png"` to drop it from the index without deleting the archive copy.

---

## For `07-SECURITY.md`

### CSP — `img-src` already covers the new hero LQIP

The hero LQIP is a base64 JPEG embedded as a `data:image/jpeg;base64,...` URL in the `.hero-bg` `background-image`. The current CSP already allows `data:` in `img-src`, so the LQIP works without any header change. No CSP edit needed for this session.

If you ever want to inline a different format (e.g. AVIF LQIP for even smaller bytes), `data:` covers all formats — still no change.

### `image-src` allowlist still minimal — keep it that way

This session did not add any external image hosts. Every new asset (hero variants, Fluffytail Fox) is self-hosted under `/Images/`. The directive remains:

```
img-src 'self' data: blob: https://res.cloudinary.com
```

If a future project wants to migrate to Cloudinary delivery for the hero (would replace the local 9-file picture set with `https://res.cloudinary.com/dbq6puxi5/image/upload/f_auto,q_auto,w_1920/...` URLs), the existing allowlist already covers it.

---

## For `11-TROUBLESHOOTING.md`

### Chrome 404s for newly-deployed assets after a deploy that fixed the missing files

**Symptom.** A file was 404 on the live site, you committed and pushed, Netlify deployed, the file is now reachable (verified with `fetch('/path?cb=' + Date.now())` returning 200), but Chrome's `<img>` tags continue to 404. Other browsers work. Hard reload, browser restart, "Empty Cache and Hard Reload" — none fix it.

**Root cause.** Chrome's HTTP disk cache holds the previous 404 response keyed on the URL *without* the cache-buster query string. The cached entry's `Cache-Control` header (or absence thereof) led Chrome to keep the negative response across hard reloads. Static-asset cache invalidation is partial in DevTools' "Empty Cache and Hard Reload" — it clears the page's HTML and a few resources, not necessarily the 404 entries for sub-resources.

**Fix (current).** Clear cookies + cached site data for the domain via `chrome://settings/cookies/detail?site=<domain>`. The cache-buster fetch with `?cb=Date.now()` hits 200 because the URL is different. Other browsers (Firefox, Safari) didn't cache the 404 the same way. Incognito always works because there's no disk cache to consult.

**Detection.** In DevTools Console on the affected page:

```js
fetch('/path/to/asset?cb=' + Date.now()).then(r => console.log(r.status));
```

`200` while `<img>` tags 404 = Chrome's disk cache holding the old negative. The query-string version is treated as a different URL.

**Permanent prevention.** Add a deploy-version query string to asset URLs that get replaced (e.g. `1.png?v=20260503`). Chrome's cache key includes the query string, so a version bump invalidates instantly worldwide. Worth adopting if you anticipate replacing assets in place often.

### Edit tool buffer truncation on large HTML files

**Symptom.** After editing a small section of `index.html` (now ~225 KB), the file ends mid-script — `</script>`, `</body>`, `</html>` are missing. JavaScript console shows `SyntaxError` near the truncation point. Validation script reports `Ends with </html>: False`.

**Root cause.** The Edit tool's output buffer truncates on files with very long single-line content (the EN/PL i18n maps are ~7000 chars per line, total file >220 KB). Editing anywhere in the file can cause the tail to drop.

**Fix (workflow).** For any file modification touching `index.html` or `gallery.html`, prefer Python-via-bash for the edit instead of the Edit tool:

```python
with open('index.html', 'r', encoding='utf-8') as f:
    h = f.read()
old = "exact substring"
new = "replacement"
assert old in h
h = h.replace(old, new, 1)
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(h)
```

Always validate after any edit:

```python
assert h.rstrip().endswith('</html>')
```

If the Edit tool *was* used and the file truncated, the tail can be patched manually because the exact missing piece is always the same closing-tag sequence (the IIFE close + `</script></body></html>`).

### "Image loads on gallery card but not in lightbox" on live site

**Symptom.** Gallery thumbnail shows correctly. Click the card, the lightbox opens, but the main image is blank or shows a broken-image icon. Network tab shows 404 for `1.png` – `6.png`.

**Root cause.** The gallery `<img src>` for the thumbnail and the lightbox `projects[key].images[]` array reference different files. The user pushed `Thumbnail.png` but missed staging `1.png` – `6.png` in the `git add` step.

**Detection.**

```bash
git ls-files "Images/Portfolio/<Project>/"
```

Should list every file the lightbox references. Anything missing is unpushed.

**Fix.** Explicit `git add` per file (or `git add Images/Portfolio/<Project>/` to stage the whole folder), then commit and push. Confirm with `git ls-files` again that all 7 expected files are tracked.

### Hero image takes 5+ seconds to load

**Symptom.** The hero topographic background is referenced as a multi-megabyte PNG. Visitors see a black hero for several seconds on slow connections; LCP > 4 s.

**Root cause.** The original `Images/Hero/hero-bg.png` was 12.9 MB at 6000 × 2877. Single PNG, one size, one format, no preload, no placeholder. Every visitor on every device pulled the same 12.9 MB.

**Fix.** Multi-stage optimization:

1. Replace the single `<img>` with a `<picture>` element, three `<source>` tiers (AVIF, WebP, JPG), three responsive widths each (1280 / 1920 / 2880).
2. Add two `<link rel="preload" as="image" type="image/avif|webp">` lines in `<head>` with matching `imagesrcset` for the format, so the browser starts fetching the hero in parallel with HTML parsing.
3. Inline a 40-pixel LQIP as base64 `background-image` on `.hero-bg` for instant first paint.
4. Move the original 12.9 MB PNG to `_originals/` (untracked).
5. `git rm --cached` the now-unreferenced original.

Result: a 1920-px desktop with AVIF support pulls **67 KB** instead of 12.9 MB. Same image quality at the actual rendered size. Other formats and sizes available via the picture element's automatic negotiation.

---

## For `04-25-2026-design-system-portable.md` (or its next revision)

Two new patterns worth promoting into the portable design system, since both are project-agnostic and reusable.

### §11. Hero composition (NEW)

When a hero needs to combine an artwork-quality image with readable copy and ambient motion, layer four things:

1. **LQIP placeholder** — 40-pixel-wide blurred preview, base64-encoded as `data:image/jpeg;base64,...`, applied as `background-image` on the image container. Paints with the first byte of HTML.
2. **Image layer** — `<picture>` element with AVIF / WebP / JPG sources, three responsive widths (1280 / 1920 / 2880). Browser auto-picks. `<link rel="preload" as="image" type="..." imagesrcset="...">` in `<head>` for each modern format.
3. **Scrim** — a radial darkening centred on where the headline sits. Inner stop ~95 % black at the centre, fading to ~0 % at the corners. Add a subtle linear gradient overlay (top 25 %, bottom 35 %) for top-and-bottom safety.
4. **Particle layer** — optional canvas of drifting particles using `mix-blend-mode: screen` (warm sparks integrate with image; on a cool background, switch to `mix-blend-mode: lighten`). Density: `Math.floor(width * height / 22000)`, capped 90. Pause on `visibilitychange`, on IntersectionObserver miss, and on `prefers-reduced-motion: reduce`.

The headline z-stack: image (0) → particles (1) → existing pseudo-glows (2) → text content (3). Use `isolation: isolate` on the hero so the particle canvas's `mix-blend-mode` doesn't escape the section.

### §12. Responsive image delivery (NEW)

For any image larger than ~200 KB at native size, use the picture/srcset/preload trio:

```html
<picture>
  <source type="image/avif" srcset="img-1280.avif 1280w, img-1920.avif 1920w, img-2880.avif 2880w" sizes="100vw">
  <source type="image/webp" srcset="img-1280.webp 1280w, img-1920.webp 1920w, img-2880.webp 2880w" sizes="100vw">
  <img src="img-1920.jpg"
       srcset="img-1280.jpg 1280w, img-1920.jpg 1920w, img-2880.jpg 2880w"
       sizes="100vw"
       alt="" decoding="async" fetchpriority="high" loading="eager">
</picture>
```

Add to `<head>`:

```html
<link rel="preload" as="image" type="image/avif"
      imagesrcset="img-1280.avif 1280w, img-1920.avif 1920w, img-2880.avif 2880w" imagesizes="100vw">
<link rel="preload" as="image" type="image/webp"
      imagesrcset="img-1280.webp 1280w, img-1920.webp 1920w, img-2880.webp 2880w" imagesizes="100vw">
```

Quality recommendations: AVIF 55, WebP 80 method 6, JPG 85 progressive optimize. Always convert to RGB before encoding (drops alpha unless explicitly needed — saves ~25 % weight). Use `Image.LANCZOS` for resampling.

### §13. Image asset organization (NEW)

```
Images/<Folder>/
├── <web-optimized files at the filenames the HTML references>
└── _originals/         <- never committed
    └── <raw source files>
```

The HTML always references the parent-folder filenames. Re-running optimization replaces the parent-folder versions in place. Originals are recoverable from `_originals/` without ever bloating the repo.

### §14. Cross-/same-page deep-link form hydration (NEW)

Pattern for "click a thing, scroll to a form, pre-fill it" without route reloads when possible:

1. The trigger element is a regular `<a href>` with URL params encoding the form state: `?type=...&inspired=...#contact`.
2. A click listener on the same-page version calls `e.preventDefault()`, manipulates the form via DOM, and calls `scrollIntoView({behavior:'smooth'})`.
3. Cross-page: the link navigates normally. The destination page runs a hydrator IIFE on `DOMContentLoaded` that reads `URLSearchParams`, finds the right `<select>` option, prefills the `<textarea>`, and scroll-anchors to the form section.
4. Detection of "am I on the same page?" uses `getElementById(form_id)` — present means same-page, null means link-and-go.

The key benefit: a single inject script works on both pages. No duplication of form-prefill logic.

---

## Housekeeping flagged this session

- **Backup files** in `D:\Claude_Development\PROJECTS\Layer Lama Website\files\`:
  - `05-03-2026-gallery-backup-original.html` — pre-banner state of gallery.html (revert target)
  - `05-03-2026-index-pre-hero-bg-backup.html` — pre-topographic-bg state of index.html (revert target)
  - `05-03-2026-index-backup-corrupted.html` — corrupted intermediate state, no value, safe to delete
  Prune all three when satisfied with current state — deletion needs explicit confirmation per project rule.

- **`_originals/` subfolders** introduced this session in two places: `Images/Hero/_originals/` (12.9 MB hero PNG) and `Images/Portfolio/Fluffytail_Fox/_originals/` (124 MB raw photos). Both are untracked. Add `**/_originals/` to `.gitignore` to make this permanent for future projects.

- **`git rm --cached` candidates** — the original `Images/Hero/hero-bg.png` is no longer referenced by index.html but still tracked in git (file moved to `_originals/`, parent path now empty). Run `git rm --cached "Images/Hero/hero-bg.png"` to clean up the index, then commit. The disk file in `_originals/` is preserved.

- **Pillow + pillow-avif-plugin** are required to regenerate the hero variants. If you ever wipe and rebuild the venv, run `pip install pillow pillow-avif-plugin --break-system-packages` (or in your project's venv).

- **Edit tool truncation issue** observed twice this session on `index.html` (size ~225 KB with 7000-char i18n lines). Workflow now defaults to Python-via-bash for any file modification on `index.html` / `gallery.html`. Document this in `11-TROUBLESHOOTING.md` (block above) so future sessions don't re-discover the trap.
