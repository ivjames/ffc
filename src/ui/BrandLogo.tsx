import { useState, type ReactNode } from 'react';
import { getExplicitLogoUrl, getOrg, useBrandingRevision } from '../lib/branding';

// The tenant's uploaded logo as an <img>, for app-chrome placements (Home
// hero, nav drawer header). Renders `fallback` instead whenever the org has no
// EXPLICIT logo in its raw branding — the merged BRANDING_DEFAULTS paths are
// the default tenant's assets, and they must never appear on another tenant
// just because defaults merge (same explicitness rule as
// hasExplicitThemeColor) — and when the URL fails to load (offline cache miss,
// deleted upload). The failure is latched per URL, not forever, so a hydrate
// that swaps in a new logo retries instead of staying stuck on the fallback
// (mirrors the per-URL failure latch in features/fun/logo.ts).
//
// Layout stability is the caller's contract: pass a className that caps the
// height (e.g. `h-14 w-auto object-contain`) so a slow decode or an oversized
// upload can't shove the screen around.

export default function BrandLogo({
  prefer = 'full',
  className = '',
  fallback = null,
}: {
  /** Which cut suits the placement's shape; the other cut is the fallback. */
  prefer?: 'full' | 'badge';
  className?: string;
  /** Rendered when there's no explicit logo or the image failed to load. */
  fallback?: ReactNode;
}) {
  useBrandingRevision(); // re-render when /api/content hydration swaps the org
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = getExplicitLogoUrl(prefer);

  if (!url || url === failedUrl) return <>{fallback}</>;
  return (
    <img
      src={url}
      // The org name, so the mark reads as the brand it is; adjacent text is
      // the VENUE name (location), so a screen reader hears no duplicate.
      alt={getOrg()?.name ?? ''}
      className={className}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailedUrl(url)}
    />
  );
}
