// Master Control → Provision site (super_admin only): stand up a complete new
// site — org + branding + first venue + courses (+ optionally its org admin) —
// in one POST. The server creates everything atomically, so a slug/email
// conflict fails the whole thing and nothing half-exists.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, HOURS_DAY_KEYS, type ProvisionPayload, type ProvisionResult } from './api';
import { Button, Card, Field, Input, Banner, PageHeader, Segmented, Select, useToast } from './ui';

const autoSlug = (v: string) =>
  v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The admin SPA lives on admin.<platform domain>, so the player subdomain a
// new org will get is derivable from our own hostname. Null in dev (localhost)
// — the previews then show a placeholder instead of a bogus URL.
function platformDomain(): string | null {
  const host = window.location.hostname;
  return host.startsWith('admin.') ? host.slice(6) : null;
}

// --- Branding palettes ------------------------------------------------------

type PaletteKey = 'coral' | 'cyan' | 'lime' | 'violet' | 'custom';
const PALETTES: Record<Exclude<PaletteKey, 'custom'>, { themeColor: string; accentColor: string; backgroundColor: string }> = {
  coral: { themeColor: '#d61b5e', accentColor: '#ff2e73', backgroundColor: '#2b0a18' },
  cyan: { themeColor: '#0089ab', accentColor: '#00c4ea', backgroundColor: '#0a2a33' },
  lime: { themeColor: '#7aa300', accentColor: '#b6f000', backgroundColor: '#1a2400' },
  violet: { themeColor: '#6d35ff', accentColor: '#8b5cff', backgroundColor: '#140a2e' },
};

// --- Courses ----------------------------------------------------------------

const COURSE_THEMES = ['classic', 'california', 'dragon', 'western', 'blue', 'green', 'red'] as const;
const MAX_COURSES = 12;

// A sensible default 18-hole par sheet (total 49).
const STANDARD_PARS = [3, 2, 3, 3, 2, 4, 2, 3, 3, 2, 3, 4, 2, 3, 3, 2, 3, 2];

/** A fresh random par sheet: 6 twos / 8 threes / 4 fours, shuffled. */
function shufflePars(): number[] {
  const pars = [...Array(6).fill(2), ...Array(8).fill(3), ...Array(4).fill(4)];
  for (let i = pars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pars[i], pars[j]] = [pars[j], pars[i]];
  }
  return pars;
}

type CourseRow = { name: string; nameTouched: boolean; theme: string; pars: number[] };

// --- Hours presets ----------------------------------------------------------

type HoursPreset = 'open7' | 'closedMon' | 'skip';

function buildHours(preset: HoursPreset): ProvisionPayload['location']['hours'] | undefined {
  if (preset === 'skip') return undefined;
  const out: NonNullable<ProvisionPayload['location']['hours']> = {};
  for (const day of HOURS_DAY_KEYS) {
    out[day] =
      preset === 'closedMon'
        ? day === 'mon'
          ? 'closed'
          : { open: '11:00', close: '21:00' }
        : { open: '10:00', close: '21:00' };
  }
  return out;
}

// --- Offering ---------------------------------------------------------------

type Offering = 'none' | 'loyalty' | 'full';

function buildPos(offering: Offering, gameRewards: boolean): unknown {
  if (offering === 'none') return undefined;
  const loyalty = { vendor: 'centeredge', gameRewards };
  return offering === 'loyalty'
    ? { loyalty }
    : { ordering: { vendor: 'centeredge' }, loyalty };
}

// --- The form ---------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold text-slate-700">{children}</h2>;
}

function ProvisionForm({ onDone }: { onDone: (site: ProvisionResult['site']) => void }) {
  const domain = platformDomain();
  const toast = useToast();

  // Site identity. Derived fields (slug, branding text, venue name/slug,
  // first-course name) track the org name until manually edited — an edit
  // breaks the auto-link for that field, same idea as Orgs' OrgForm.
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [orgSlugTouched, setOrgSlugTouched] = useState(false);

  // Branding.
  const [palette, setPalette] = useState<PaletteKey>('coral');
  const [themeColor, setThemeColor] = useState(PALETTES.coral.themeColor);
  const [accentColor, setAccentColor] = useState(PALETTES.coral.accentColor);
  const [backgroundColor, setBackgroundColor] = useState(PALETTES.coral.backgroundColor);
  const [appName, setAppName] = useState('');
  const [appNameTouched, setAppNameTouched] = useState(false);
  const [shortName, setShortName] = useState('');
  const [shortNameTouched, setShortNameTouched] = useState(false);
  const [shareFooter, setShareFooter] = useState('');
  const [shareFooterTouched, setShareFooterTouched] = useState(false);

  // First venue.
  const [venueName, setVenueName] = useState('');
  const [venueNameTouched, setVenueNameTouched] = useState(false);
  const [venueSlug, setVenueSlug] = useState('');
  const [venueSlugTouched, setVenueSlugTouched] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [geofence, setGeofence] = useState('2');
  const [hoursPreset, setHoursPreset] = useState<HoursPreset>('open7');

  // Courses.
  const [courses, setCourses] = useState<CourseRow[]>([
    { name: '', nameTouched: false, theme: 'classic', pars: STANDARD_PARS.slice() },
  ]);

  // Offering.
  const [offering, setOffering] = useState<Offering>('none');
  const [gameRewards, setGameRewards] = useState(true);

  // Org admin (optional).
  const [adminEmail, setAdminEmail] = useState('');

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function applyVenueName(v: string) {
    setVenueName(v);
    if (!venueSlugTouched) setVenueSlug(autoSlug(v));
    setCourses((rows) =>
      rows.map((r) => (r.nameTouched ? r : { ...r, name: v ? `${v} Course` : '' }))
    );
  }

  function onOrgNameChange(v: string) {
    setOrgName(v);
    if (!orgSlugTouched) setOrgSlug(autoSlug(v));
    if (!appNameTouched) setAppName(v);
    if (!shortNameTouched) setShortName(v.trim().split(/\s+/)[0]?.slice(0, 30) ?? '');
    if (!shareFooterTouched) setShareFooter(v ? `${v} · come beat this score` : '');
    if (!venueNameTouched) applyVenueName(v);
  }

  function onPaletteChange(p: PaletteKey) {
    setPalette(p);
    if (p !== 'custom') {
      setThemeColor(PALETTES[p].themeColor);
      setAccentColor(PALETTES[p].accentColor);
      setBackgroundColor(PALETTES[p].backgroundColor);
    }
  }

  function setCourse(i: number, next: CourseRow) {
    setCourses((rows) => rows.map((r, j) => (j === i ? next : r)));
  }

  function validate(): string | null {
    if (!orgName.trim() || !orgSlug.trim()) return 'Give the org a name and a slug.';
    if (!venueName.trim() || !venueSlug.trim()) return 'Give the venue a name and a slug.';
    const hasLat = lat.trim() !== '';
    const hasLng = lng.trim() !== '';
    if (hasLat !== hasLng) return 'Latitude and longitude must be provided together.';
    if (courses.length === 0) return 'Add at least one course.';
    if (courses.some((c) => !c.name.trim())) return 'Every course needs a name.';
    if (courses.some((c) => c.pars.length !== 18)) return 'Every course needs 18 pars.';
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setErr(problem);
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const hours = buildHours(hoursPreset);
      const pos = buildPos(offering, gameRewards);
      const payload: ProvisionPayload = {
        org: { name: orgName.trim(), slug: orgSlug.trim() },
        branding: {
          appName: appName.trim(),
          shortName: shortName.trim(),
          themeColor,
          accentColor,
          backgroundColor,
          shareFooter: shareFooter.trim(),
        },
        location: {
          name: venueName.trim(),
          slug: venueSlug.trim(),
          ...(lat.trim() !== '' && lng.trim() !== '' ? { lat: Number(lat), lng: Number(lng) } : {}),
          ...(geofence.trim() !== '' ? { geofenceKm: Number(geofence) } : {}),
          ...(hours ? { hours } : {}),
          ...(pos !== undefined ? { pos } : {}),
        },
        courses: courses.map((c) => ({ name: c.name.trim(), theme: c.theme, pars: c.pars })),
        ...(adminEmail.trim() !== '' ? { adminUser: { email: adminEmail.trim() } } : {}),
      };
      const res = await api.provisionSite(payload);
      toast('Site provisioned.');
      onDone(res.site);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {err && <Banner kind="error">{err}</Banner>}

      {/* --- Site identity --- */}
      <Card>
        <SectionHeading>Site identity</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Org name">
            <Input
              value={orgName}
              onChange={(e) => onOrgNameChange(e.target.value)}
              placeholder="Bullwinkle's"
            />
          </Field>
          <div>
            <Field label="Slug" hint="Lowercase, hyphenated. Auto-filled from the name.">
              <Input
                value={orgSlug}
                onChange={(e) => {
                  setOrgSlug(e.target.value);
                  setOrgSlugTouched(true);
                }}
                placeholder={autoSlug(orgName) || 'bullwinkles'}
              />
            </Field>
            <p className="mt-1 text-xs text-slate-500">
              {domain
                ? `https://${orgSlug || '…'}.${domain}`
                : `${orgSlug || '…'}.<your platform domain>`}
            </p>
          </div>
        </div>
      </Card>

      {/* --- Branding --- */}
      <Card>
        <SectionHeading>Branding</SectionHeading>
        <div className="space-y-3">
          <Field label="Palette">
            <Segmented<PaletteKey>
              options={[
                { value: 'coral', label: 'Coral' },
                { value: 'cyan', label: 'Cyan' },
                { value: 'lime', label: 'Lime' },
                { value: 'violet', label: 'Violet' },
                { value: 'custom', label: 'Custom' },
              ]}
              value={palette}
              onChange={onPaletteChange}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Theme color">
              <Input
                value={themeColor}
                disabled={palette !== 'custom'}
                onChange={(e) => setThemeColor(e.target.value)}
                placeholder="#d61b5e"
              />
            </Field>
            <Field label="Accent color">
              <Input
                value={accentColor}
                disabled={palette !== 'custom'}
                onChange={(e) => setAccentColor(e.target.value)}
                placeholder="#ff2e73"
              />
            </Field>
            <Field label="Background color">
              <Input
                value={backgroundColor}
                disabled={palette !== 'custom'}
                onChange={(e) => setBackgroundColor(e.target.value)}
                placeholder="#2b0a18"
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="App name" hint="Shown in the player app's header and install prompt.">
              <Input
                value={appName}
                onChange={(e) => {
                  setAppName(e.target.value);
                  setAppNameTouched(true);
                }}
              />
            </Field>
            <Field label="Short name" hint="Home-screen icon label (30 chars max).">
              <Input
                value={shortName}
                maxLength={30}
                onChange={(e) => {
                  setShortName(e.target.value);
                  setShortNameTouched(true);
                }}
              />
            </Field>
          </div>
          <Field label="Share footer" hint="Tag line on shared scorecards.">
            <Input
              value={shareFooter}
              onChange={(e) => {
                setShareFooter(e.target.value);
                setShareFooterTouched(true);
              }}
            />
          </Field>
        </div>
      </Card>

      {/* --- First venue --- */}
      <Card>
        <SectionHeading>First venue</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Venue name">
            <Input
              value={venueName}
              onChange={(e) => {
                setVenueNameTouched(true);
                applyVenueName(e.target.value);
              }}
              placeholder="Riverside"
            />
          </Field>
          <Field label="Venue slug" hint="Auto-filled from the venue name.">
            <Input
              value={venueSlug}
              onChange={(e) => {
                setVenueSlug(e.target.value);
                setVenueSlugTouched(true);
              }}
              placeholder={autoSlug(venueName) || 'riverside'}
            />
          </Field>
          <Field label="Latitude" hint="WGS84, −90..90">
            <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="34.08867" inputMode="decimal" />
          </Field>
          <Field label="Longitude" hint="−180..180">
            <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-117.67946" inputMode="decimal" />
          </Field>
          <Field label="Geofence (km)" hint='"You are here" radius.'>
            <Input value={geofence} onChange={(e) => setGeofence(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Hours">
            <Segmented<HoursPreset>
              options={[
                { value: 'open7', label: 'Open 7 days' },
                { value: 'closedMon', label: 'Closed Mondays' },
                { value: 'skip', label: 'Skip' },
              ]}
              value={hoursPreset}
              onChange={setHoursPreset}
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">Timezone is derived from the coordinates.</p>
      </Card>

      {/* --- Courses --- */}
      <Card>
        <SectionHeading>Courses</SectionHeading>
        <div className="space-y-3">
          {courses.map((c, i) => (
            <div key={i} className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Course name">
                  <Input
                    value={c.name}
                    onChange={(e) => setCourse(i, { ...c, name: e.target.value, nameTouched: true })}
                    placeholder="Blue Course"
                  />
                </Field>
                <Field label="Theme">
                  <Select
                    className="w-full"
                    value={c.theme}
                    onChange={(e) => setCourse(i, { ...c, theme: e.target.value })}
                  >
                    {COURSE_THEMES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  par total {c.pars.reduce((a, b) => a + b, 0)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setCourse(i, { ...c, pars: shufflePars() })}
                >
                  Shuffle pars
                </Button>
                {courses.length > 1 && (
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => setCourses((rows) => rows.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
          {courses.length < MAX_COURSES && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setCourses((rows) => [
                  ...rows,
                  { name: '', nameTouched: true, theme: 'classic', pars: STANDARD_PARS.slice() },
                ])
              }
            >
              Add course
            </Button>
          )}
        </div>
      </Card>

      {/* --- Offering --- */}
      <Card>
        <SectionHeading>Offering</SectionHeading>
        <div className="space-y-2">
          <Segmented<Offering>
            options={[
              { value: 'none', label: 'No POS' },
              { value: 'loyalty', label: 'Loyalty' },
              { value: 'full', label: 'Ordering + loyalty' },
            ]}
            value={offering}
            onChange={setOffering}
          />
          {offering !== 'none' && (
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={gameRewards}
                onChange={(e) => setGameRewards(e.target.checked)}
              />
              Game ticket rewards (app mini-games credit tickets to the loyalty card)
            </label>
          )}
          <p className="text-xs text-slate-500">
            Ticket caps and adoption bonuses are configured on the venue page afterwards.
          </p>
        </div>
      </Card>

      {/* --- Org admin --- */}
      <Card>
        <SectionHeading>Org admin (optional)</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email">
            <Input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="owner@example.com"
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Optional. They'll receive an email with a link to set their own password (link valid 7
          days).
        </p>
      </Card>

      <Button type="submit" disabled={busy}>
        {busy ? 'Provisioning…' : 'Provision site'}
      </Button>
    </form>
  );
}

// --- Success panel ----------------------------------------------------------

function SuccessPanel({ site, onReset }: { site: ProvisionResult['site']; onReset: () => void }) {
  const domain = platformDomain();
  return (
    <Card>
      <h2 className="text-base font-semibold text-slate-900">Site is live</h2>
      <p className="mt-1 text-sm text-slate-600">
        {site.playerUrl ? (
          <a href={site.playerUrl} target="_blank" rel="noreferrer" className="underline">
            {site.playerUrl}
          </a>
        ) : domain ? (
          `https://${site.org.slug}.${domain}`
        ) : (
          `${site.org.slug}.<your platform domain>`
        )}
      </p>
      {site.adminUser && (
        <p className="mt-1 text-sm text-slate-600">
          {site.adminUser.inviteSent ? (
            <>
              Org admin <strong>{site.adminUser.email}</strong> created — invite email sent.
            </>
          ) : (
            <>
              Org admin <strong>{site.adminUser.email}</strong> created, but the invite email could
              not be sent. They can use 'Forgot password?' on the admin sign-in page.
            </>
          )}
        </p>
      )}
      <h3 className="mt-4 text-sm font-semibold text-slate-700">What's next</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
        <li>
          <Link to={`/orgs/${site.org.id}`} className="underline">
            Upload logos and icons
          </Link>
        </li>
        <li>
          <Link to={`/locations/${site.location.id}`} className="underline">
            Ticket caps, hours, food links
          </Link>
        </li>
        <li>
          <Link to="/hunt" className="underline">
            Add scavenger-hunt items
          </Link>
        </li>
      </ul>
      <div className="mt-4">
        <Button variant="ghost" onClick={onReset}>
          Provision another site
        </Button>
      </div>
    </Card>
  );
}

// --- Page -------------------------------------------------------------------

export default function ProvisionSite() {
  const [site, setSite] = useState<ProvisionResult['site'] | null>(null);
  // Bumped on "Provision another site" so the form remounts blank.
  const [formNonce, setFormNonce] = useState(0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provision site"
        description="Create a complete new site — org, branding, first venue, courses, and offering — live on its subdomain in one shot. No SSH, no deploy."
      />
      {site ? (
        <SuccessPanel
          site={site}
          onReset={() => {
            setSite(null);
            setFormNonce((n) => n + 1);
          }}
        />
      ) : (
        <ProvisionForm key={formNonce} onDone={setSite} />
      )}
    </div>
  );
}
