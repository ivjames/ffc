import { useState } from 'react';
import { api, type Location, type ModuleStatus } from './api';
import { Banner, Card, Pill, useToast } from './ui';

// The venue's à la carte modules — what this client actually bought, as its own
// panel rather than a checkbox buried under a vendor dropdown.
//
// Two facts about each module, deliberately shown separately because they have
// completely different fixes:
//
//   ENABLED — the commercial switch. Flipped whenever a plan changes.
//   WIRED   — is there a POS vendor configured for it? Set once, during
//             integration, in the POS section below this one.
//
// Before this panel the only way to switch the rewards surface off was to
// delete the venue's POS credentials and put them back later. Now the two are
// independent: a venue can keep its CenterEdge loyalty wiring intact with the
// rewards module switched off, and switch it back on without an integrator.
//
// "Inherited" marks a module nobody has made a decision about yet — it's
// showing the value derived from the venue's existing config, exactly what the
// app did before modules existed. Flipping the switch makes it explicit.

const BLOCKED_COPY: Record<string, string> = {
  'not-enabled': 'Switched off for this venue.',
  'not-wired': 'No POS vendor configured — set one in the POS section below.',
  requires: 'Needs its parent module to be live first.',
};

export default function LocationModules({
  location,
  modules,
  onSaved,
}: {
  location: Location;
  modules: ModuleStatus[];
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  async function setModule(key: string, enabled: boolean) {
    setErr(null);
    setBusy(true);
    try {
      // The location save is replace-not-merge across the whole record, so the
      // write has to carry every field the form owns — sending only `modules`
      // would blank the venue's POS config, hours, and hunt settings.
      await api.saveLocation({
        ...location,
        modules: { ...(location.modules ?? {}), [key]: enabled },
      });
      toast(`${modules.find((m) => m.key === key)?.label ?? key} ${enabled ? 'enabled' : 'disabled'}.`);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Modules</h2>
      <p className="mb-3 text-xs text-slate-500">
        What this venue's plan includes. Each module is sold separately and switches
        independently of the POS wiring below — turning one off leaves the integration in place.
      </p>
      {err && <Banner kind="error">{err}</Banner>}

      <div className="divide-y divide-slate-200">
        {modules.map((m) => (
          <div key={m.key} className="flex items-start gap-3 py-2.5">
            <label className="flex shrink-0 pt-0.5">
              <input
                type="checkbox"
                checked={m.entitled}
                disabled={busy}
                onChange={(e) => setModule(m.key, e.target.checked)}
                aria-label={m.label}
              />
            </label>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold text-slate-700">{m.label}</span>
                {m.live ? (
                  <Pill tone="green">Live</Pill>
                ) : (
                  <Pill tone="slate">Off</Pill>
                )}
                {m.entitled && !m.wired && <Pill tone="amber">Needs wiring</Pill>}
                {m.inherited && <Pill tone="slate">Inherited</Pill>}
              </div>
              <p className="text-xs text-slate-500">{m.blurb}</p>
              {!m.live && m.blockedBy && (
                <p className="mt-0.5 text-xs text-amber-700">{BLOCKED_COPY[m.blockedBy]}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Changes reach players' phones on their next content refresh — no redeploy.
      </p>
    </Card>
  );
}
