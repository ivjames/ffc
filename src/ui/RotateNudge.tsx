import { useEffect, useState } from 'react';

// The app is designed portrait-first (§5.1 — touch-first, one-handed play on a
// phone). When someone rotates their phone to landscape the fixed 420px column
// (max-w-md) leaves the layout stranded in the middle of a short, wide viewport.
// Rather than reflow every screen for landscape, we gently nudge the phone back
// to vertical with a full-screen overlay.
//
// Detection is a media query, not the screen.orientation API, so it works the
// same across browsers and stays in CSS's hands:
//   (orientation: landscape) and (max-height: 540px)
// The max-height clause keeps this to phones held sideways — a short, wide
// viewport — and leaves laptops/desktops/tablets (tall enough even in
// landscape) untouched. The full-screen /tv leaderboard is *meant* for wide
// screens, so App.tsx skips mounting this on that route.
const LANDSCAPE_PHONE = '(orientation: landscape) and (max-height: 540px)';

export default function RotateNudge() {
  const [landscape, setLandscape] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(LANDSCAPE_PHONE);
    const update = () => setLandscape(mq.matches);
    update();
    // addEventListener('change') is the modern API; older Safari only has
    // addListener. Support both so the nudge appears/dismisses live on rotate.
    if (mq.addEventListener) mq.addEventListener('change', update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update);
      else mq.removeListener(update);
    };
  }, []);

  if (!landscape) return null;

  return (
    <div
      role="alertdialog"
      aria-label="Please rotate your device to portrait"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-fairway-950/95 px-8 text-center backdrop-blur"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* A phone glyph that tips from landscape back to portrait, on a loop, so
          the direction to rotate is obvious without reading. */}
      <svg
        width="72"
        height="72"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="rotate-nudge-phone text-fairway-100"
      >
        <rect x="7" y="2" width="10" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="12" cy="18.5" r="1" fill="currentColor" />
      </svg>
      <p className="text-xl font-black tracking-tight text-fairway-50">Rotate your phone</p>
      <p className="max-w-xs text-sm font-medium text-fairway-300">
        Mini Golf Scorecard works best held upright. Turn your phone vertical to keep playing.
      </p>
    </div>
  );
}
