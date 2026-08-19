// Where a tenant actually lives, derived from the admin SPA's own hostname.
//
// An org's slug IS its subdomain label (MULTI-VENUE.md §1) — that's the single
// most operational fact about an org, and until now it was only ever rendered
// as a bare "/slug" that reads like a URL path and isn't one. These helpers
// turn the slug into the address an operator can actually open, hand to a
// client, or point a venue QR code at.
//
// Master Control is served from admin.<platform domain>, so the platform
// domain is derivable from our own hostname — no build-time config, and it
// stays correct across dev/staging/whatever domain the platform lands on.
// Null in dev (localhost has no admin. prefix): callers show the slug alone
// rather than inventing a bogus hostname.

export function platformDomain(): string | null {
  const host = window.location.hostname;
  return host.startsWith('admin.') ? host.slice(6) : null;
}

/** The org's player-facing origin, or null when the domain isn't derivable. */
export function orgPlayerUrl(slug: string): string | null {
  const domain = platformDomain();
  return domain ? `https://${slug}.${domain}` : null;
}

/** Display form of the above: the real host when we know it, else something
 *  honest about what's missing rather than a half-made-up URL. */
export function orgPlayerHost(slug: string): string {
  const domain = platformDomain();
  return domain ? `${slug}.${domain}` : `${slug}.<platform domain>`;
}
