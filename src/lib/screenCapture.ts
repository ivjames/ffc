// One-tap screen grab for the reviewer feedback widget — on every device,
// phones included.
//
// The browser's own screen-capture API (getDisplayMedia) gives true pixels,
// but it does not exist on iOS Safari or Chrome on Android, and reviewers walk
// this venue with phones. A capture that only works on a laptop is not a
// capture. So this renders the live DOM instead, which works everywhere.
//
// `modern-screenshot` does that by cloning the DOM into an SVG <foreignObject>
// and letting the BROWSER paint it — it is not a reimplementation of CSS the
// way html2canvas is, so this app's gradients, color-mix(), custom properties
// and arcade skins come out as themselves. It is zero-dependency and actively
// maintained (the Safari/iOS foreignObject quirks are the ones it exists to
// handle, which is exactly the platform that matters here).
//
// Known gaps, since a screenshot that quietly lies is worse than none:
//   - `backdrop-filter` (the header's backdrop-blur) cannot be sampled inside a
//     foreignObject; those areas render unblurred. Layout and color are right.
//   - Only the page is captured — never the browser chrome, the notch, or
//     anything outside the document. For "the iOS share sheet covers the
//     button", a reviewer still attaches a real OS screenshot by hand.
//
// The library is loaded with a dynamic import so it lands in its own chunk
// (~27 KB, 10 KB gzipped) instead of the main bundle. The service worker still
// precaches that chunk along with everything else, so it IS downloaded — but
// it is never parsed or executed unless a reviewer presses the pill, and with
// DEV_MODE off there is no pill to press.

/** Marks dev-only chrome (the pill itself, build stamp, skin picker) so the
 *  capture leaves it out — the reviewer is commenting on the app, not on our
 *  overlay. Set as a data attribute in src/App.tsx. */
export const CAPTURE_IGNORE_ATTR = 'data-feedback-ignore';

// Cap the pixel ratio. Phones report 3x, which turns a tall page into a
// multi-megapixel PNG for no gain — the upload path downscales to a 1280px
// long edge anyway (src/lib/image.ts).
const MAX_SCALE = 2;

/** Every device can do this — it is a DOM render, not a platform API. */
export function isScreenCaptureSupported(): boolean {
  return typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined';
}

function isOpaque(color: string): boolean {
  return Boolean(color) && color !== 'transparent' && !/,\s*0\s*\)$/.test(color);
}

/**
 * The colour to paint behind the render, read from what the render ACTUALLY
 * painted: scan up the left edge for the lowest fully-opaque pixel.
 *
 * Reading it off the DOM instead would be wrong for half this app's skins.
 * Several of them (candy, chrome) paint the body entirely with
 * `background-image` gradients, which leaves the computed `background-color`
 * transparent — so a CSS lookup finds nothing and any hardcoded default puts
 * white bands under a dark themed page. Sampling costs one getImageData and
 * continues the gradient with the colour it had actually reached, since the
 * area needing fill always sits directly below the painted region.
 */
function sampleRenderedBackground(rendered: HTMLCanvasElement): string | null {
  try {
    const ctx = rendered.getContext('2d', { willReadFrequently: true });
    if (!ctx || rendered.height === 0) return null;
    const column = ctx.getImageData(0, 0, 1, rendered.height).data;
    for (let y = rendered.height - 1; y >= 0; y--) {
      if (column[y * 4 + 3] > 250) {
        return `rgb(${column[y * 4]}, ${column[y * 4 + 1]}, ${column[y * 4 + 2]})`;
      }
    }
    return null;
  } catch {
    // Tainted canvas (an image that wouldn't inline) — fall back to the DOM.
    return null;
  }
}

/** DOM-side fallback, for a render with nothing opaque to sample. */
function resolvePageBackground(): string {
  const html = getComputedStyle(document.documentElement).backgroundColor;
  if (isOpaque(html)) return html;
  const body = getComputedStyle(document.body).backgroundColor;
  if (isOpaque(body)) return body;
  // Every skin sets one or the other, so this is only reached if the page
  // hasn't painted at all. Match the mode so it can't flash white on a dark
  // theme — the failure Codex caught on the gradient skins.
  return getComputedStyle(document.documentElement).colorScheme === 'light'
    ? '#ffffff'
    : '#111111';
}

/**
 * Render what the reviewer is currently looking at into an image File.
 *
 * Resolves to null for any "no picture, carry on" outcome — the caller opens
 * the note sheet either way and never reports a failure, because a missing
 * screenshot is a smaller problem than a lost comment.
 */
export async function captureScreen(): Promise<File | null> {
  if (!isScreenCaptureSupported()) return null;
  try {
    const { domToCanvas } = await import('modern-screenshot');

    // Capture the viewport, not the full scrollable page: the note is about
    // what the reviewer can see right now, and a 6000px-tall render of a long
    // scroller buries it.
    const width = Math.min(window.innerWidth, document.documentElement.clientWidth || Infinity);
    const height = Math.min(window.innerHeight, document.documentElement.clientHeight || Infinity);

    // Capture <html>, not <body>. Cloning the body leaves an 8px unpainted
    // frame down the left and top of the render on any page tall enough to
    // scroll (verified in Chromium under mobile emulation) — the whole clone
    // sits offset inside the canvas and the far edges get clipped. Rooting at
    // the document element renders flush.
    //
    // Rendered WITHOUT a background so the transparent areas stay transparent,
    // then composited over one below. The library paints its background only
    // where the captured element's box lands, which on a scrolled page leaves
    // the rest of the frame empty — and "empty" becomes black the moment it is
    // encoded as JPEG.
    const rendered = await domToCanvas(document.documentElement, {
      width,
      height,
      scale: Math.min(window.devicePixelRatio || 1, MAX_SCALE),
      // Offset the clone by the scroll position so the capture starts at the
      // top of the VIEWPORT rather than the top of the document.
      style: {
        transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
        transformOrigin: 'top left',
      },
      filter: (node) =>
        !(node instanceof Element && node.hasAttribute(CAPTURE_IGNORE_ATTR)),
      // Don't hang the widget on a font or image that won't load; a slightly
      // imperfect grab beats a spinner that never resolves.
      timeout: 8000,
    });

    const out = document.createElement('canvas');
    out.width = rendered.width;
    out.height = rendered.height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = sampleRenderedBackground(rendered) ?? resolvePageBackground();
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(rendered, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, 'image/jpeg', 0.9)
    );
    if (!blob || blob.size === 0) return null;
    return new File([blob], `screen-${Date.now()}.jpg`, { type: 'image/jpeg' });
  } catch {
    // Any failure at all — unsupported CSS, a tainted canvas, a timeout — is
    // just "no screenshot this time".
    return null;
  }
}
