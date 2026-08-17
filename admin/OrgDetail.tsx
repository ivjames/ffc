import { useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, type Branding, type BrandingAssetKind, type Org } from './api';
import { BackLink, Button, Card, Field, Input, Banner, PageHeader, Pill, Spinner, useAsync, useToast } from './ui';

// The platform defaults from MULTI-VENUE.md §2 — shown as placeholders so an
// empty field visibly means "use the platform default". The logo trio has NO
// platform default (undefined here): absent means the player app shows no
// logo anywhere until the org uploads one. The server holds the canonical
// copy (server/lib/branding.js); this list only feeds placeholders and the
// color-swatch fallback, so drift is cosmetic, not behavioral.
export const BRANDING_DEFAULTS = {
  appName: 'Mini Golf Scorecard',
  shortName: 'MiniGolf',
  themeColor: '#15803d',
  backgroundColor: '#052e16',
  accentColor: '#38bdf8',
  logoUrl: undefined,
  logoBadgeUrl: undefined,
  logoWordmarkUrl: undefined,
  icon192Url: '/icons/icon-192.png',
  icon512Url: '/icons/icon-512.png',
  shareFooter: 'Come beat this score',
} satisfies Record<keyof Branding, string | undefined>;

type BrandingKey = keyof Branding;
const BRANDING_KEYS = Object.keys(BRANDING_DEFAULTS) as BrandingKey[];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Editor state → the full-replace PATCH body: only non-empty fields ship.
 *  All-blank collapses to {} — valid, and means "all platform defaults". */
export function buildBrandingPayload(values: Record<BrandingKey, string>): Branding {
  const out: Branding = {};
  for (const key of BRANDING_KEYS) {
    const v = values[key].trim();
    if (v !== '') out[key] = v;
  }
  return out;
}

function ColorField({
  label,
  value,
  def,
  onChange,
}: {
  label: string;
  value: string;
  def: string;
  onChange: (v: string) => void;
}) {
  // The native swatch needs a valid #rrggbb at all times — while the text is
  // blank or mid-edit it previews the default instead.
  const swatch = HEX_RE.test(value.trim()) ? value.trim() : def;
  return (
    <Field label={label} hint={`Blank = platform default (${def}).`}>
      <div className="flex items-center gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={def} />
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white p-0.5"
        />
      </div>
    </Field>
  );
}

/** Tiny logo preview next to a URL field; disappears (rather than showing a
 *  broken-image glyph) if the URL doesn't load. Note "/…" paths resolve
 *  against the admin origin here, so a player-bundle path may not preview —
 *  that's fine, the field is still valid. */
function LogoPreview({ url }: { url: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === url) return null;
  return (
    <img
      src={url}
      alt=""
      onError={() => setFailedUrl(url)}
      className="h-8 w-8 shrink-0 rounded bg-slate-100 object-contain ring-1 ring-slate-200"
    />
  );
}

function UrlField({
  label,
  value,
  def,
  onChange,
  accept,
  onUpload,
}: {
  label: string;
  value: string;
  /** Platform default, or undefined for fields with none (the logo trio). */
  def: string | undefined;
  onChange: (v: string) => void;
  /** File-picker filter for the Upload button (icons are PNG-only). */
  accept: string;
  /** Uploads the picked file; the parent fills the field / reports errors. */
  onUpload: (file: File) => Promise<void>;
}) {
  // Per-field busy state: only THIS field's Upload button shows "Uploading…".
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const trimmed = value.trim();
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked after a fix
    if (!file) return;
    setBusy(true);
    try {
      await onUpload(file);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Field
      label={label}
      hint={`"/path" or "https://…", or upload a file. Blank = ${def ?? 'no logo (no platform default)'}.`}
    >
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def ?? 'No platform default — upload a file or paste a URL'}
          inputMode="url"
        />
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          className="hidden"
          aria-label={`${label} file`}
          onChange={(e) => void onFile(e)}
        />
        <Button variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Uploading…' : 'Upload'}
        </Button>
        {trimmed !== '' && <LogoPreview url={trimmed} />}
      </div>
    </Field>
  );
}

// Branding URL field → the asset kind its Upload button posts.
const ASSET_KIND_BY_FIELD = {
  logoUrl: 'logo',
  logoBadgeUrl: 'logoBadge',
  logoWordmarkUrl: 'logoWordmark',
  icon192Url: 'icon192',
  icon512Url: 'icon512',
} as const satisfies Partial<Record<BrandingKey, BrandingAssetKind>>;
type AssetField = keyof typeof ASSET_KIND_BY_FIELD;

// Client-side mirrors of the server caps (server/lib/brandAssets.js), so an
// obviously-bad pick fails fast without a round trip. The server re-checks.
const MAX_ASSET_BYTES = 1024 * 1024; // 1 MiB
const ICON_SIDE: Partial<Record<BrandingAssetKind, number>> = { icon192: 192, icon512: 512 };

function BrandingCard({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const [values, setValues] = useState<Record<BrandingKey, string>>(() => {
    const stored = org.branding ?? {};
    return Object.fromEntries(BRANDING_KEYS.map((k) => [k, stored[k] ?? ''])) as Record<
      BrandingKey,
      string
    >;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const set = (key: BrandingKey) => (v: string) => setValues((cur) => ({ ...cur, [key]: v }));

  // Upload handler for one URL field: pre-check (size; PNG-only for the icon
  // kinds), post the file, then fill the text field with the returned
  // /api/brand-assets/... URL. Saving is still the explicit Save button —
  // the upload endpoint never touches org.branding.
  const uploadFor = (key: AssetField) => async (file: File) => {
    setErr(null);
    const kind = ASSET_KIND_BY_FIELD[key];
    const iconSide = ICON_SIDE[kind];
    if (iconSide && !(file.type === 'image/png' || /\.png$/i.test(file.name))) {
      setErr(`The ${iconSide} icon must be a PNG (exactly ${iconSide}×${iconSide}).`);
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      setErr('That file is too large (max 1 MiB).');
      return;
    }
    try {
      const { url } = await api.uploadBrandingAsset(org.id, kind, file);
      set(key)(url);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api.updateOrgBranding(org.id, buildBrandingPayload(values));
      toast('Branding saved.');
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Branding</h2>
      <p className="mb-3 text-xs text-slate-500">
        White-label overrides for this org's player app (name, colors, logos). Every field is
        optional — blank means the platform default shown as the placeholder. The logo fields
        have no platform default: left blank, the player app shows no logo.
      </p>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="App name" hint="PWA install name and document title (1–80 chars).">
          <Input
            value={values.appName}
            onChange={(e) => set('appName')(e.target.value)}
            placeholder={BRANDING_DEFAULTS.appName}
          />
        </Field>
        <Field label="Short name" hint="Home-screen label (1–30 chars).">
          <Input
            value={values.shortName}
            onChange={(e) => set('shortName')(e.target.value)}
            placeholder={BRANDING_DEFAULTS.shortName}
          />
        </Field>
        <ColorField
          label="Theme color"
          value={values.themeColor}
          def={BRANDING_DEFAULTS.themeColor}
          onChange={set('themeColor')}
        />
        <ColorField
          label="Background color"
          value={values.backgroundColor}
          def={BRANDING_DEFAULTS.backgroundColor}
          onChange={set('backgroundColor')}
        />
        <ColorField
          label="Accent color"
          value={values.accentColor}
          def={BRANDING_DEFAULTS.accentColor}
          onChange={set('accentColor')}
        />
        <Field label="Share footer" hint="Tagline on shared score images (1–120 chars).">
          <Input
            value={values.shareFooter}
            onChange={(e) => set('shareFooter')(e.target.value)}
            placeholder={BRANDING_DEFAULTS.shareFooter}
          />
        </Field>
        <UrlField
          label="Logo URL"
          value={values.logoUrl}
          def={BRANDING_DEFAULTS.logoUrl}
          onChange={set('logoUrl')}
          accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
          onUpload={uploadFor('logoUrl')}
        />
        <UrlField
          label="Logo badge URL"
          value={values.logoBadgeUrl}
          def={BRANDING_DEFAULTS.logoBadgeUrl}
          onChange={set('logoBadgeUrl')}
          accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
          onUpload={uploadFor('logoBadgeUrl')}
        />
        <UrlField
          label="Logo wordmark URL"
          value={values.logoWordmarkUrl}
          def={BRANDING_DEFAULTS.logoWordmarkUrl}
          onChange={set('logoWordmarkUrl')}
          accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
          onUpload={uploadFor('logoWordmarkUrl')}
        />
        <UrlField
          label="Icon 192 URL"
          value={values.icon192Url}
          def={BRANDING_DEFAULTS.icon192Url}
          onChange={set('icon192Url')}
          accept=".png,image/png"
          onUpload={uploadFor('icon192Url')}
        />
        <UrlField
          label="Icon 512 URL"
          value={values.icon512Url}
          def={BRANDING_DEFAULTS.icon512Url}
          onChange={set('icon512Url')}
          accept=".png,image/png"
          onUpload={uploadFor('icon512Url')}
        />
      </div>
      <div className="mt-3">
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save branding'}
        </Button>
      </div>
    </Card>
  );
}

export default function OrgDetail({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  // Suspend/unsuspend failures (notably the server's refusal to suspend the
  // default org without ?force=1) need reading, so they land in an inline
  // banner — never silently retried with force.
  const [lifecycleErr, setLifecycleErr] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => api.getOrg(id), [id]);

  if (loading) return <Spinner />;
  if (error) return <Banner kind="error">{error.message}</Banner>;
  if (!data) return null;
  const { org, locations } = data;
  const suspended = org.status === 'suspended';

  async function toggleArchive() {
    await api.archiveOrg(id, !org.archivedAt);
    toast(org.archivedAt ? 'Org unarchived.' : 'Org archived.');
    reload();
  }

  async function toggleSuspend() {
    setLifecycleErr(null);
    if (
      !suspended &&
      !window.confirm(
        `Suspend ${org.name}? Its subdomain goes dark for players immediately (all data is kept).`
      )
    ) {
      return;
    }
    try {
      await (suspended ? api.unsuspendOrg(id) : api.suspendOrg(id));
      toast(suspended ? 'Org unsuspended.' : 'Org suspended.');
      reload();
    } catch (e) {
      setLifecycleErr((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <BackLink to="/orgs">Orgs</BackLink>
      <PageHeader
        title={org.name}
        titleExtra={
          <>
            <span className="text-xs text-slate-400">/{org.slug}</span>
            {org.archivedAt && <Pill tone="amber">Archived</Pill>}
            {suspended && <Pill tone="red">Suspended</Pill>}
          </>
        }
        actions={
          <>
            <Link to={`/locations/new?orgId=${org.id}`}>
              <Button>+ Location</Button>
            </Link>
            {isSuperAdmin && (
              <Button variant={suspended ? 'ghost' : 'danger'} onClick={toggleSuspend}>
                {suspended ? 'Unsuspend' : 'Suspend'}
              </Button>
            )}
            {isSuperAdmin && (
              <Button variant={org.archivedAt ? 'ghost' : 'danger'} onClick={toggleArchive}>
                {org.archivedAt ? 'Unarchive' : 'Archive'}
              </Button>
            )}
          </>
        }
      />

      {lifecycleErr && <Banner kind="error">{lifecycleErr}</Banner>}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Locations</h2>
        {locations.length === 0 && <p className="text-sm text-slate-400">No locations under this org yet.</p>}
        <div className="space-y-2">
          {locations.map((l) => (
            <div key={l.id} className="flex items-center gap-3 border-t border-slate-100 py-2 first:border-0">
              <button
                className="flex-1 text-left font-medium text-slate-900 hover:underline"
                onClick={() => nav(`/locations/${l.id}`)}
              >
                {l.name}
                <span className="ml-2 text-xs text-slate-400">/{l.slug}</span>
              </button>
              {l.tzLabel && <span className="text-xs text-slate-500">{l.tzLabel}</span>}
            </div>
          ))}
        </div>
      </Card>

      {/* Branding is cosmetic, so unlike archive it's open to the org's own
          org_admin too (the server enforces scope either way). */}
      <BrandingCard org={org} onSaved={reload} />
    </div>
  );
}
