# Bullwinkle's Family Fun Center — website clone

A modernized, self-contained clone of [bullwinkles.com](https://bullwinkles.com)
matching the live site's structure and branding (Francois One + Roboto,
brand orange `#EF5113` on deep navy), rebuilt as clean, dependency-free
static HTML/CSS/JS.

## Pages

| Path | Page |
|------|------|
| `index.html` | Landing — hero, **Choose Location** cards, *Eat. Play. Repeat.* carousel, location-picker modal |
| `wilsonville/` | Wilsonville, OR location page |
| `tukwila/` | Tukwila, WA location page |
| `upland/` | Upland, CA location page |

Each location page is a single scrolling page whose sticky nav
(Hours · Bowl · Play · Eat · Party · Events · Specials · Moose Perks · About)
anchors to on-page sections: hero, attractions grid, events & specials,
birthday, group events, Moose Perks, park map, FAQ accordion, guest reviews,
other locations, and a full footer.

## What's modernized vs. the original

- One shared design system (`assets/css/site.css`) instead of per-page CSS.
- Location micro-sites collapsed into single anchored pages (fewer round-trips).
- Accessibility: skip links, focus-visible rings, focus-trapped modal,
  keyboard-operable FAQ/carousel, and full `prefers-reduced-motion` support
  (the carousel never auto-advances, the hero video is suppressed).
- Verified layout — no horizontal overflow at 1440px and 390px across all
  four pages (see notes below).

## Assets

`assets/img/` holds **branded SVG placeholder art** (logo, hero panorama,
location scenes, attraction thumbnails, park map). Swap these for real
photography/video to finish the production site. Fonts load from Google Fonts
with a `system-ui` fallback stack.

## Run locally

Any static file server from this directory, e.g.:

```bash
cd site
python3 -m http.server 8080   # then open http://localhost:8080
```

No build step, framework, or dependencies.
