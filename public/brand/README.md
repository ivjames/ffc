# Brand assets

White-on-transparent PNGs, stored grayscale+alpha. Every consumer recolors at
render time — the canvas games tint via `src/features/fun/logo.ts` (`drawLogo`'s
`tint` option), the DOM screens via `BrandMark` in `src/ui/components.tsx`
(a mask over `bg-current`, so it follows the theme's text color). Never add
per-color variant files; recoloring is the system.

| File | Cut | Aspect | Status |
| --- | --- | --- | --- |
| `logo.png` | Full lockup (badge over both lines of type) | 1.93:1 | Official master, trimmed + downscaled from source art |
| `logo-badge.png` | Moose roundel alone | 1.27:1 | Derived: the master fuses the roundel's bottom arc into the wordmark's letters, so this cut has that arc reconstructed (center (582.5, 205.5), centerline r=201, stroke 13 in master coordinates). The two breaks where the antlers cross the circle are original art, not damage. |
| `logo-wordmark.png` | BULLWINKLE'S / & FAMILY FUN CENTER stack | 5.52:1 | **INTERIM — replace with official art.** Cropped from the master, so a chunk of the roundel's arc rides fused across the tops of W-I-N-K. Not cleanly fixable in-place: arc and letterforms share pixels, and separating them means redrawing the type. |

## Replacing the wordmark

Spec for the official standalone wordmark:

- The two-line stack exactly as in the lockup, with clean letter tops (no arc).
- White (#fff) on transparent, PNG. ~640px wide is plenty — the largest
  in-app draw is ~150px on a 340px canvas at up to 3× DPR.
- Trimmed to the alpha bounds (no padding); consumers position by the mark's
  own edges.

Drop the file in as `logo-wordmark.png` — same name, nothing else to change.
`drawLogo` reads the aspect from the file, and `BrandMark` scales via
`mask-size: contain`. If the official cut's aspect differs much from ~5.5:1,
re-screenshot the game placements (widths at the call sites are tuned to it).

Master source (1175×608 RGBA) lives with the venue's brand files, not in the
repo.
