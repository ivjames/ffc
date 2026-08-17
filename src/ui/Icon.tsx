import { ICON_ART, type DrawnIcon } from './icons/registry';

// The one way the app draws an icon.
//
// `<Icon name="game.skee-ball" />` — named for what it MEANS, never for what it
// looks like, because the drawing is expected to change per skin and per venue.
// src/ui/icons/manifest.ts holds the names and the drawing briefs; registry.tsx
// holds the art.
//
// ── Sized in `em`, on purpose ───────────────────────────────────────────────
//
// The svg is 1em square, so it takes its size from the font-size it inherits —
// exactly like the emoji it replaces. Every existing call site keeps working
// unchanged: `<span className="text-6xl">🎳</span>` becomes
// `<Icon name="game.bowling" className="text-6xl" />` and lands the same size.
// A fixed px size would have meant re-tuning ~200 call sites by hand.
//
// ── currentColor, on purpose ────────────────────────────────────────────────
//
// Every path strokes `currentColor` and fills nothing, so an icon is the colour
// of its surrounding text and needs no per-skin variant. src/lib/skin.ts swaps
// skins by setting `data-template` on <html> and letting CSS do the rest with
// ZERO re-render; icons drawn this way join that mechanism for free. Skins can
// restyle the whole set from index.css via the `.ffc-icon` hook — stroke weight,
// a UV glow, a chrome gradient — without a second set of drawings existing.
// That is what keeps this a 97-icon library instead of a 582-icon one.
//
// ── Accessibility ──────────────────────────────────────────────────────────
//
// `label` is required whenever the icon is the only content of a control. The
// emoji this replaces were announced by their Unicode names, so a screen reader
// read the arcade's Skee-Ball tile as "bowling". Passing no label marks the icon
// aria-hidden, which is correct ONLY when adjacent text already names the thing.

export default function Icon({
  name,
  label,
  className,
}: {
  /**
   * Semantic icon name — see src/ui/icons/manifest.ts for the full set and the
   * drawing briefs. Restricted to names that have art, so an undrawn icon is a
   * typecheck failure rather than an empty box on a screen.
   */
  name: DrawnIcon;
  /**
   * Accessible name. Required when the icon stands alone in a control; omit
   * only when visible text beside it already says the same thing, in which case
   * the icon is hidden from assistive tech rather than read out twice.
   */
  label?: string;
  className?: string;
}) {
  const art = ICON_ART[name];

  return (
    <svg
      // 1em square: inherits its size from font-size, like the emoji before it.
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // The per-skin restyling hook. Skins target `.ffc-icon` in index.css.
      className={`ffc-icon inline-block flex-none${className ? ` ${className}` : ''}`}
      // A labelled icon is an image with a name; an unlabelled one is decoration.
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false })}
    >
      {art}
    </svg>
  );
}
