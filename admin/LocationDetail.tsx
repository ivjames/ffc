import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  api,
  HOURS_DAY_KEYS,
  type Course,
  type DayHours,
  type GameRewardsMeta,
  type HoursDayKey,
  type Location,
  type VenueHours,
} from './api';
import { BackLink, Button, Card, Field, Input, Banner, PageHeader, Pill, Select, Spinner, useAsync, useToast, fmtDateTime } from './ui';
import LocationModules from './LocationModules';

const HOURS_DAY_LABELS: Record<HoursDayKey, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

// Editor-local state for one weekday: `closed` toggles the row; `open`/`close`
// only matter (and are only sent) when it isn't. Blank strings for a fresh,
// never-set day.
type DayState = { closed: boolean; open: string; close: string };
type HoursState = Record<HoursDayKey, DayState>;

// A day missing from a non-null hours object is server-treated as closed
// (see venueHours.js), so it's fine to fold that case in with an explicit
// "closed" here — both render as a checked "Closed" row.
function hoursToState(hours: VenueHours | null): HoursState {
  const state = {} as HoursState;
  for (const key of HOURS_DAY_KEYS) {
    const d = hours?.[key];
    state[key] = d && d !== 'closed' ? { closed: false, open: d.open, close: d.close } : { closed: true, open: '', close: '' };
  }
  return state;
}

// Serializes the editor into the `hours` payload the server expects. Disabled
// (the "Set business hours" checkbox off) always sends `null` — that's how an
// operator clears hours back to unset. Enabled sends all 7 days explicitly,
// each either "closed" or {open,close}.
export function buildHoursPayload(enabled: boolean, state: HoursState): VenueHours | null {
  if (!enabled) return null;
  const out: VenueHours = {};
  for (const key of HOURS_DAY_KEYS) {
    const d = state[key];
    out[key] = d.closed ? 'closed' : ({ open: d.open, close: d.close } as DayHours);
  }
  return out;
}

// Light client-side check only — the server is the source of truth on time
// formats (see normalizeHours) and its 400 message surfaces via the form's
// existing error banner either way.
export function hoursValidationError(enabled: boolean, state: HoursState): string | null {
  if (!enabled) return null;
  for (const key of HOURS_DAY_KEYS) {
    const d = state[key];
    if (!d.closed && (!d.open.trim() || !d.close.trim())) {
      return `Set both open and close time for ${HOURS_DAY_LABELS[key]}, or mark it closed.`;
    }
  }
  return null;
}

function HoursEditor({
  enabled,
  onEnabledChange,
  state,
  onDayChange,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  state: HoursState;
  onDayChange: (day: HoursDayKey, next: DayState) => void;
}) {
  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <label className="flex items-center gap-1.5 text-sm text-slate-700">
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
        Set business hours
      </label>
      {!enabled ? (
        <p className="mt-1 text-xs text-slate-500">
          No hours set — the app treats this venue as having unknown hours.
        </p>
      ) : (
        <div className="mt-2 space-y-1">
          {HOURS_DAY_KEYS.map((key) => {
            const d = state[key];
            return (
              <div key={key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-9 shrink-0 font-medium text-slate-600">{HOURS_DAY_LABELS[key]}</span>
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={d.closed}
                    onChange={(e) => onDayChange(key, { ...d, closed: e.target.checked })}
                  />
                  Closed
                </label>
                {!d.closed && (
                  <>
                    <input
                      value={d.open}
                      onChange={(e) => onDayChange(key, { ...d, open: e.target.value })}
                      placeholder="09:00"
                      inputMode="numeric"
                      className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                    />
                    <span className="text-slate-400">–</span>
                    <input
                      value={d.close}
                      onChange={(e) => onDayChange(key, { ...d, close: e.target.value })}
                      placeholder="21:00 (or 24:00)"
                      inputMode="numeric"
                      className="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Hunt config --------------------------------------------------------------
// Serializes the hunt fields into the save payload's `hunt` field (mirrors
// server normalizeHunt).
//
// dailyScanCap: blank = unlimited → {} (what the column stores by default), a
// number → { dailyScanCap: n }. 0 is meaningful and distinct from blank: it
// turns the hunt OFF at this venue (the per-client kill switch).
//
// venueMode: the course-free hunt's on/off switch. Only the `true` case is
// written, matching the server's normalization — `false` is the default, so
// storing it would just be noise. The payload REPLACES the stored object
// (replace-not-merge, like pos/hours), so both fields must be sent together
// every save or the omitted one silently clears.
export function buildHuntPayload(
  dailyScanCap: string,
  venueMode: boolean
): { dailyScanCap?: number; venueMode?: boolean } {
  const t = dailyScanCap.trim();
  return {
    ...(t === '' ? {} : { dailyScanCap: Number(t) }),
    ...(venueMode ? { venueMode: true } : {}),
  };
}

// Light client-side check only — the server (normalizeHunt) is the source of
// truth and its 400 surfaces via the form's error banner either way.
export function huntCapValidationError(dailyScanCap: string): string | null {
  const t = dailyScanCap.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) {
    return 'Daily scan cap must be a whole number ≥ 0 (0 turns the hunt off, blank = unlimited).';
  }
  return null;
}

function ParsGrid({ pars, onChange }: { pars: number[]; onChange: (p: number[]) => void }) {
  return (
    <div className="grid grid-cols-9 gap-1">
      {pars.map((p, i) => (
        <div key={i} className="text-center">
          <div className="text-[10px] text-slate-400">{i + 1}</div>
          <input
            value={p}
            onChange={(e) => {
              const next = pars.slice();
              next[i] = Number(e.target.value) || 0;
              onChange(next);
            }}
            inputMode="numeric"
            className="w-full rounded border border-slate-300 py-1 text-center text-sm"
          />
        </div>
      ))}
    </div>
  );
}

function CourseCard({ course, onChanged }: { course: Course; onChanged: () => void }) {
  const [name, setName] = useState(course.name);
  const [theme, setTheme] = useState(course.theme);
  const [pars, setPars] = useState<number[]>(course.pars);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const total = pars.reduce((a, b) => a + b, 0);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api.patchCourse(course.id, { name: name.trim(), theme: theme.trim(), pars });
      toast('Course saved.');
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    await api.archiveCourse(course.id, true);
    toast('Course archived.');
    onChanged();
  }

  return (
    <Card>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <Field label="Course name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Theme">
          <Input value={theme} onChange={(e) => setTheme(e.target.value)} />
        </Field>
      </div>
      <div className="mb-2">
        <div className="mb-1 flex items-center justify-between text-sm font-medium text-slate-700">
          <span>Pars</span>
          <span className="text-xs text-slate-500">total {total}</span>
        </div>
        <ParsGrid pars={pars} onChange={setPars} />
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save course'}
        </Button>
        <Button variant="danger" onClick={archive}>
          Archive
        </Button>
      </div>
    </Card>
  );
}

function AddCourse({ locationId, onAdded }: { locationId: string; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [theme, setTheme] = useState('blue');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.saveCourse({
        locationId,
        name: name.trim(),
        theme: theme.trim(),
        pars: Array(18).fill(3),
      });
      setName('');
      toast('Course added.');
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Add a course</h3>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        {err && <Banner kind="error">{err}</Banner>}
        <div className="flex-1">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Blue Course" />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Theme">
            <Input value={theme} onChange={(e) => setTheme(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" disabled={busy || !name.trim()}>
          Add (pars default 3)
        </Button>
      </form>
    </Card>
  );
}

// Per-game per-round ceilings + the per-card daily cap — the venue's ticket
// economy guardrails. Values are edited as strings ('' = platform default);
// only explicit overrides are saved, and the server clamps/validates against
// the platform hard limits either way.
function GameCapsEditor({
  meta,
  dailyCap,
  onDailyCap,
  perGame,
  onPerGame,
}: {
  meta: GameRewardsMeta;
  dailyCap: string;
  onDailyCap: (v: string) => void;
  perGame: Record<string, string>;
  onPerGame: (v: Record<string, string>) => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="mb-1 text-xs font-semibold text-slate-600">Ticket economy caps</div>
      <p className="mb-2 text-xs text-slate-500">
        App-earned tickets are free to players, so these caps are what keeps them a perk instead
        of an economy leak. Blank = platform default. Caps can only tighten the platform limits
        (max {meta.hardMaxPerRound} tickets per round, daily default{' '}
        {meta.defaultDailyPerCard.toLocaleString()}).
      </p>
      <div className="mb-2 w-56">
        <Field
          label="Daily cap per card"
          hint={`Total app tickets one card can earn per day (1..${meta.maxDailyPerCard.toLocaleString()}).`}
        >
          <Input
            value={dailyCap}
            onChange={(e) => onDailyCap(e.target.value)}
            placeholder={String(meta.defaultDailyPerCard)}
            inputMode="numeric"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
        {meta.games.map((g) => (
          <label key={g.key} className="flex items-center justify-between gap-2 text-xs text-slate-600">
            <span>{g.label}</span>
            <input
              value={perGame[g.key] ?? ''}
              onChange={(e) => onPerGame({ ...perGame, [g.key]: e.target.value })}
              placeholder={String(meta.hardMaxPerRound)}
              inputMode="numeric"
              className="w-14 rounded border border-slate-300 px-1 py-0.5 text-right text-xs"
            />
          </label>
        ))}
      </div>
      <div className="mt-1 text-right text-[10px] text-slate-400">max tickets per round, per game</div>
    </div>
  );
}

function LocationForm({
  location,
  gameRewardsMeta,
  onSaved,
}: {
  location: Location;
  gameRewardsMeta: GameRewardsMeta | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState(location.name);
  const [slug, setSlug] = useState(location.slug);
  const [lat, setLat] = useState(location.lat?.toString() ?? '');
  const [lng, setLng] = useState(location.lng?.toString() ?? '');
  const [geofence, setGeofence] = useState(location.geofenceKm?.toString() ?? '');
  const [menuUrl, setMenuUrl] = useState(location.menuUrl ?? '');
  const [orderingUrl, setOrderingUrl] = useState(location.orderingUrl ?? '');
  // POS integration add-on — capabilities decoupled, each with its own
  // vendor. Vendor '' = that capability off; both off saves pos as null.
  const [ordVendor, setOrdVendor] = useState(location.pos?.ordering?.vendor ?? '');
  const [ordApiBase, setOrdApiBase] = useState(location.pos?.ordering?.apiBase ?? '');
  const [loyVendor, setLoyVendor] = useState(location.pos?.loyalty?.vendor ?? '');
  const [loyApiBase, setLoyApiBase] = useState(location.pos?.loyalty?.apiBase ?? '');
  const [gameRewards, setGameRewards] = useState(location.pos?.loyalty?.gameRewards ?? false);
  // Economy caps, edited as strings ('' = platform default / no override).
  const storedCaps = location.pos?.loyalty?.gameRewardCaps ?? null;
  const [dailyCap, setDailyCap] = useState(storedCaps?.dailyPerCard?.toString() ?? '');
  const [perGameCaps, setPerGameCaps] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(storedCaps?.perGame ?? {}).map(([k, v]) => [k, String(v)]))
  );
  // Hunt vision-spend cap, edited as a string ('' = unlimited, '0' = hunt off).
  const [huntScanCap, setHuntScanCap] = useState(location.hunt?.dailyScanCap?.toString() ?? '');
  // The course-free venue hunt's on/off switch.
  const [huntVenueMode, setHuntVenueMode] = useState(location.hunt?.venueMode === true);
  const [hoursEnabled, setHoursEnabled] = useState(location.hours != null);
  const [hoursState, setHoursState] = useState<HoursState>(() => hoursToState(location.hours));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  // Only explicit overrides ship; all-blank collapses to "no caps object".
  function buildCaps() {
    if (!gameRewards) return undefined;
    const daily = dailyCap.trim() === '' ? null : Number(dailyCap);
    const perGame: Record<string, number> = {};
    for (const [key, raw] of Object.entries(perGameCaps)) {
      if (raw.trim() !== '') perGame[key] = Number(raw);
    }
    if (daily === null && Object.keys(perGame).length === 0) return undefined;
    return { dailyPerCard: daily, perGame };
  }

  async function save() {
    setErr(null);
    const hasLat = lat.trim() !== '';
    const hasLng = lng.trim() !== '';
    if (hasLat !== hasLng) {
      setErr('Latitude and longitude must be provided together.');
      return;
    }
    const hoursErr = hoursValidationError(hoursEnabled, hoursState);
    if (hoursErr) {
      setErr(hoursErr);
      return;
    }
    const huntErr = huntCapValidationError(huntScanCap);
    if (huntErr) {
      setErr(huntErr);
      return;
    }
    setBusy(true);
    try {
      await api.saveLocation({
        id: location.id,
        name: name.trim(),
        slug: slug.trim(),
        orgId: location.orgId,
        lat: hasLat ? Number(lat) : null,
        lng: hasLng ? Number(lng) : null,
        geofenceKm: geofence.trim() ? Number(geofence) : null,
        menuUrl: menuUrl.trim() || null,
        orderingUrl: orderingUrl.trim() || null,
        hours: buildHoursPayload(hoursEnabled, hoursState),
        hunt: buildHuntPayload(huntScanCap, huntVenueMode),
        // This form is replace-not-merge across the whole record, and modules
        // are edited in their OWN panel — so they have to be carried through
        // verbatim here, or saving an unrelated field (a menu URL, a phone
        // number) would silently reset the venue's entitlements.
        modules: location.modules ?? null,
        pos:
          ordVendor === '' && loyVendor === ''
            ? null
            : {
                ordering:
                  ordVendor === ''
                    ? null
                    : { vendor: ordVendor, apiBase: ordApiBase.trim() || null },
                loyalty:
                  loyVendor === ''
                    ? null
                    : {
                        vendor: loyVendor,
                        apiBase: loyApiBase.trim() || null,
                        gameRewards,
                        gameRewardCaps: buildCaps(),
                      },
              },
      });
      toast('Location saved.');
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Slug">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="Latitude">
          <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Longitude">
          <Input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Geofence (km)">
          <Input value={geofence} onChange={(e) => setGeofence(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Timezone (derived)">
          <div className="px-1 py-1.5 text-sm text-slate-600">{location.tzLabel ?? '—'}</div>
        </Field>
        <Field label="Menu URL" hint="Shown on the app's Food & Drink card. Blank hides it.">
          <Input value={menuUrl} onChange={(e) => setMenuUrl(e.target.value)} placeholder="https://…/menu" inputMode="url" />
        </Field>
        <Field label="Online ordering URL" hint="Deep link to the venue's ordering system.">
          <Input value={orderingUrl} onChange={(e) => setOrderingUrl(e.target.value)} placeholder="https://order.…" inputMode="url" />
        </Field>
      </div>

      <HoursEditor
        enabled={hoursEnabled}
        onEnabledChange={setHoursEnabled}
        state={hoursState}
        onDayChange={(day, next) => setHoursState({ ...hoursState, [day]: next })}
      />

      {/* POS integration add-ons — per-venue paid capabilities, each with its
          own vendor (a venue can mix, e.g. CenterEdge loyalty next to another
          ordering system). "None" keeps that surface off; ordering falls back
          to the deep links above. */}
      <div className="mt-3 border-t border-slate-200 pt-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Food ordering POS" hint="Native in-app ordering. None = deep links only.">
            <Select value={ordVendor} onChange={(e) => setOrdVendor(e.target.value)} className="w-full">
              <option value="">None</option>
              <option value="centeredge">CenterEdge</option>
            </Select>
          </Field>
          {ordVendor !== '' && (
            <Field label="Ordering API base URL" hint="Optional per-venue endpoint override.">
              <Input
                value={ordApiBase}
                onChange={(e) => setOrdApiBase(e.target.value)}
                placeholder="https://pos.example.com"
                inputMode="url"
              />
            </Field>
          )}
          <Field label="Loyalty / rewards POS" hint="Player card balances in the app. None = no rewards surface.">
            <Select
              value={loyVendor}
              onChange={(e) => {
                setLoyVendor(e.target.value);
                if (e.target.value === '') setGameRewards(false); // rides on loyalty
              }}
              className="w-full"
            >
              <option value="">None</option>
              <option value="centeredge">CenterEdge</option>
            </Select>
          </Field>
          {loyVendor !== '' && (
            <Field label="Loyalty API base URL" hint="Optional per-venue endpoint override.">
              <Input
                value={loyApiBase}
                onChange={(e) => setLoyApiBase(e.target.value)}
                placeholder="https://pos.example.com"
                inputMode="url"
              />
            </Field>
          )}
        </div>
        <div className="mt-2">
          <label className={`flex items-center gap-1.5 text-sm text-slate-700 ${loyVendor !== '' ? '' : 'opacity-40'}`}>
            <input
              type="checkbox"
              checked={gameRewards}
              disabled={loyVendor === ''}
              onChange={(e) => setGameRewards(e.target.checked)}
            />
            Game ticket rewards (app mini-games credit tickets to the loyalty card)
          </label>
          {gameRewards && loyVendor !== '' && gameRewardsMeta && (
            <GameCapsEditor
              meta={gameRewardsMeta}
              dailyCap={dailyCap}
              onDailyCap={setDailyCap}
              perGame={perGameCaps}
              onPerGame={setPerGameCaps}
            />
          )}
        </div>
      </div>

      {/* Hunt spend guardrail — the vision-cap sibling of the ticket economy
          caps above: hunt verifications are billed API calls, so each venue
          gets its own daily ceiling (CLAUDE.md cost visibility). */}
      <div className="mt-3 border-t border-slate-200 pt-3">
        <div className="mb-1 text-xs font-semibold text-slate-600">Scavenger hunt</div>
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Daily scan cap"
            hint="Billed hunt photo scans per rolling 24h at this venue. Blank = unlimited; 0 = hunt disabled at this venue."
          >
            <Input
              value={huntScanCap}
              onChange={(e) => setHuntScanCap(e.target.value)}
              placeholder="Unlimited"
              inputMode="numeric"
            />
          </Field>
        </div>
        {/* The course-free hunt. Off everywhere until a venue opts in; the
            player-facing tile additionally needs at least one active item on
            the venue's list, so switching this on with an empty list shows
            players nothing (curate it under Hunt → "<venue> · venue-wide"). */}
        <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={huntVenueMode}
            onChange={(e) => setHuntVenueMode(e.target.checked)}
          />
          <span>
            Venue-wide hunt
            <span className="block text-xs text-slate-500">
              Lets players run a park-wide hunt without a mini-golf round — for venues
              with no course. Needs at least one active item on the venue's list. The
              daily scan cap above still applies.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-2">
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save location'}
        </Button>
      </div>
    </Card>
  );
}

export default function LocationDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(async () => {
    const [detail, allCourses, gameRewardsMeta] = await Promise.all([
      api.getLocation(id),
      api.listLocationCourses(id, true),
      // The caps editor's registry — non-fatal if unavailable (editor hides).
      api.gameRewardsMeta().catch(() => null),
    ]);
    return {
      location: detail.location,
      modules: detail.modules,
      courses: detail.courses,
      archivedCourses: allCourses.filter((c) => c.archivedAt),
      gameRewardsMeta,
    };
  }, [id]);

  if (loading) return <Spinner />;
  if (error) return <Banner kind="error">{error.message}</Banner>;
  if (!data) return null;
  const { location, modules, courses, archivedCourses, gameRewardsMeta } = data;

  async function toggleArchive() {
    await api.archiveLocation(id, !location.archivedAt);
    toast(location.archivedAt ? 'Location unarchived.' : 'Location archived.');
    reload();
  }

  return (
    <div className="space-y-4">
      {/* Back to the org's Venues tab, i.e. the list this venue came from —
          not the org's overview, which is one more click from where you were. */}
      <BackLink to={location.orgId ? `/orgs/${location.orgId}/venues` : '/orgs'}>
        {location.orgId ? 'Org venues' : 'Orgs'}
      </BackLink>
      <PageHeader
        title={location.name}
        titleExtra={
          <>
            <span className="text-xs text-slate-400">/{location.slug}</span>
            {location.archivedAt && <Pill tone="amber">Archived</Pill>}
          </>
        }
        actions={
          <Button variant={location.archivedAt ? 'ghost' : 'danger'} onClick={toggleArchive}>
            {location.archivedAt ? 'Unarchive location' : 'Archive location'}
          </Button>
        }
      />

      {/* Modules first: what the venue bought frames everything below it —
          the POS wiring inside LocationForm exists to serve these. */}
      <LocationModules location={location} modules={modules} onSaved={reload} />

      <LocationForm location={location} gameRewardsMeta={gameRewardsMeta} onSaved={reload} />

      <h2 className="pt-2 text-sm font-semibold text-slate-700">Courses ({courses.length})</h2>
      <div className="space-y-3">
        {courses.map((c) => (
          <CourseCard key={c.id} course={c} onChanged={reload} />
        ))}
      </div>

      <AddCourse locationId={location.id} onAdded={reload} />

      {archivedCourses.length > 0 && (
        <div className="space-y-2">
          <h2 className="pt-2 text-sm font-semibold text-slate-700">
            Archived courses ({archivedCourses.length})
          </h2>
          {archivedCourses.map((c) => (
            <Card key={c.id} className="flex items-center gap-3">
              <span className="flex-1 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-xs text-slate-400">{c.theme}</span>
                {c.archivedAt && (
                  <span className="ml-2 text-xs text-slate-400">archived {fmtDateTime(c.archivedAt)}</span>
                )}
              </span>
              <Button
                variant="ghost"
                onClick={async () => {
                  await api.archiveCourse(c.id, false);
                  toast('Course unarchived.');
                  reload();
                }}
              >
                Unarchive
              </Button>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Course data (names, pars, themes) drives the leaderboard and hunt immediately in the DB, and reaches players on
        the next site rebuild. Per-course map art &amp; themed rules ship in the app bundle.
      </p>
    </div>
  );
}
