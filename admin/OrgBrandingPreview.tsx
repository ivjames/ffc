// Live previews for the branding console.
//
// The branding form used to be twelve text inputs. Every one of them is a
// value you cannot evaluate by reading it: nobody can look at "#0f4c2a" and
// "#052e16" and say whether the result is legible, and nobody can tell from a
// URL whether the logo they uploaded is the wordmark or the badge. The whole
// point of this panel is that the operator sees the answer instead of
// deploying and squinting at a phone.
//
// These are FAITHFUL, not decorative: the surfaces mirror how the player app
// actually consumes each field (src/lib/branding.ts), including the platform
// defaults and — importantly — the explicitness rule for logos. The logo trio
// has no platform default, so an org without one gets NO logo anywhere; a
// preview that quietly substituted the default client's mark would tell the
// operator a comforting lie.

/** Mirrors BRANDING_DEFAULTS in server/lib/branding.js — what a blank field
 *  actually renders as. The logo trio is deliberately absent: no default. */
export const PREVIEW_DEFAULTS = {
  appName: 'Mini Golf Scorecard',
  shortName: 'MiniGolf',
  themeColor: '#15803d',
  backgroundColor: '#052e16',
  accentColor: '#38bdf8',
  shareFooter: 'Come beat this score',
} as const;

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** The value that will actually render: the typed one when it's usable, the
 *  platform default otherwise. Mid-edit garbage previews as the default rather
 *  than blanking the panel. */
// Both resolvers tolerate a MISSING key, not just an empty one. The console
// always passes a full object, but these components are also handed partial
// values (a freshly-created org, a test, a future caller), and a preview panel
// that throws takes the whole branding screen down with it.
function resolve(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? fallback : trimmed;
}

function resolveHex(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  return HEX_RE.test(trimmed) ? trimmed : fallback;
}

/** Relative luminance, for picking readable text over an arbitrary brand
 *  color. An operator will eventually set a pale accent, and white-on-pale is
 *  the classic way a branded button becomes unreadable. */
function readableOn(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? '#0b1f16' : '#ffffff';
}

/** Partial on purpose — see the resolvers below. */
export type BrandingValues = Record<string, string | undefined>;

/** Contrast ratio between two hexes (WCAG). */
function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    if (!m) return 0;
    const [r, g, bl] = [m[1], m[2], m[3]].map((h) => {
      const c = parseInt(h, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function Mark({ url, className, alt }: { url: string | undefined; className: string; alt: string }) {
  const src = (url ?? '').trim();
  if (!src) return null;
  return <img src={src} alt={alt} className={className} />;
}

/**
 * The player app as this branding renders it. Not a pixel-perfect clone — a
 * clone would rot the first time the app changed — but every element here is
 * driven by the field that drives it in the real app, so the question "is this
 * legible / is that the right mark" gets a true answer.
 */
export function AppPreview({ values }: { values: BrandingValues }) {
  const bg = resolveHex(values.backgroundColor, PREVIEW_DEFAULTS.backgroundColor);
  const theme = resolveHex(values.themeColor, PREVIEW_DEFAULTS.themeColor);
  const accent = resolveHex(values.accentColor, PREVIEW_DEFAULTS.accentColor);
  const appName = resolve(values.appName, PREVIEW_DEFAULTS.appName);
  const onAccent = readableOn(accent);
  const logo = values.logoWordmarkUrl?.trim() || values.logoUrl?.trim() || '';

  return (
    <div className="overflow-hidden rounded-[1.6rem] border-4 border-slate-800 shadow-lg">
      {/* Browser/OS chrome takes themeColor — the strip above the page on a
          phone, and the reason themeColor is a separate field at all. */}
      <div className="flex items-center justify-center py-1.5" style={{ background: theme }}>
        <span className="text-[0.6rem] font-medium" style={{ color: readableOn(theme) }}>
          {appName}
        </span>
      </div>

      <div className="px-3 py-4" style={{ background: bg }}>
        <div className="flex h-8 items-center justify-center">
          {logo ? (
            <Mark url={logo} alt="Logo" className="max-h-8 w-auto object-contain" />
          ) : (
            // What an org with no uploaded logo ACTUALLY sees — neutral
            // chrome, never the default client's mark.
            <span className="text-xs font-bold text-white/70">{appName}</span>
          )}
        </div>

        <div className="mt-3 rounded-xl bg-white/10 px-3 py-2.5">
          <div className="text-[0.65rem] font-semibold text-white/60">HOLE 07 · PAR 3</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className="rounded px-1.5 py-0.5 text-[0.6rem] font-black"
              style={{ background: accent, color: onAccent }}
            >
              ACE
            </span>
            <span className="text-[0.65rem] text-white/80">2 strokes · 1 under</span>
          </div>
        </div>

        <button
          type="button"
          className="mt-3 w-full rounded-full py-2 text-xs font-bold"
          style={{ background: accent, color: onAccent }}
        >
          Next hole →
        </button>

        <div className="mt-3 flex items-center gap-1.5">
          {values.logoBadgeUrl?.trim() ? (
            <Mark url={values.logoBadgeUrl} alt="Badge" className="h-5 w-5 object-contain" />
          ) : (
            <span className="h-5 w-5 rounded-full bg-white/15" />
          )}
          <span className="text-[0.6rem] text-white/50">
            {resolve(values.shareFooter, PREVIEW_DEFAULTS.shareFooter)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The home-screen install. The 192 icon and the SHORT name are what a player
 * sees forever after installing, and short names truncate — which is exactly
 * the mistake this preview is here to catch before it ships.
 */
export function InstallPreview({ values }: { values: BrandingValues }) {
  const shortName = resolve(values.shortName, PREVIEW_DEFAULTS.shortName);
  const icon = values.icon192Url?.trim() || '';
  const theme = resolveHex(values.themeColor, PREVIEW_DEFAULTS.themeColor);
  return (
    <div className="rounded-xl bg-slate-800 p-4">
      <div className="flex items-start gap-4">
        <div className="text-center">
          {icon ? (
            <img
              src={icon}
              alt="App icon"
              className="h-14 w-14 rounded-[0.9rem] object-cover shadow"
            />
          ) : (
            <div
              className="flex h-14 w-14 items-center justify-center rounded-[0.9rem] text-lg font-black text-white shadow"
              style={{ background: theme }}
            >
              {shortName.slice(0, 1).toUpperCase()}
            </div>
          )}
          {/* Home screens clip at roughly this width — showing the truncation
              here is the point. */}
          <div className="mt-1 w-14 truncate text-[0.6rem] text-white" title={shortName}>
            {shortName}
          </div>
        </div>
        <div className="min-w-0 flex-1 text-xs text-slate-300">
          <p className="font-semibold text-white">On the home screen</p>
          <p className="mt-0.5">
            Short name is clipped to about 12 characters on most phones.{' '}
            {shortName.length > 12 && (
              <span className="font-semibold text-amber-300">
                "{shortName}" is {shortName.length} — it will be cut off.
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Contrast warnings. The two pairings that actually break the app: accent-on-
 * background (every primary button) and the theme strip's own label. WCAG AA
 * for large text is 3:1, which is the right bar for buttons and chrome.
 */
export function ContrastNotes({ values }: { values: BrandingValues }) {
  const bg = resolveHex(values.backgroundColor, PREVIEW_DEFAULTS.backgroundColor);
  const accent = resolveHex(values.accentColor, PREVIEW_DEFAULTS.accentColor);
  const ratio = contrastRatio(accent, bg);
  if (ratio >= 3) return null;
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
      <strong>Low contrast.</strong> The accent color sits at {ratio.toFixed(1)}:1 against the
      background — buttons and highlights will be hard to read. 3:1 or better is the target.
    </p>
  );
}
