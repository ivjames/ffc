// Chart primitives for Master Control.
//
// House style, already set by Overview.tsx's daily bars: thin marks, native
// <title> tooltips, slate chrome, and the data as the only loud thing. This
// file makes those primitives shared and adds the forms the arcade-bot page
// needs.
//
// SVG only where geometry is the point (the scatter). Everything with a text
// label beside it is HTML: a viewBox scales its text along with its geometry,
// so a three-row chart stretched to card width renders 5px labels at 20px —
// the first draft of this file did exactly that, and only looking at the
// rendered page caught it.
//
// COLOR IS ASSIGNED BY JOB, NOT BY TASTE.
//   - magnitude across many categories → ONE hue (sequential). The arcade has
//     19 games; a hue per game would be 19 colors, which is indistinguishable
//     under any kind of vision and would bury the point.
//   - two named parts of a whole (tickets paid vs clamped away) → two hues,
//     with a legend, because there identity IS the subject.
// The pair below was validated against the admin's real white card surface
// (dataviz validate_palette.js, --pairs all): worst CVD ΔE 21.3, worst
// normal-vision ΔE 31.9, both marks ≥3:1 on white — all checks pass. ACCENT is
// the sky already used by Overview, so the admin stays one system.
//
// Master Control is light-mode only (admin/index.css sets `color-scheme:
// light`), so this ships one validated light palette rather than a dark set
// nothing would ever render.
import type { ReactNode } from 'react';

export const VIZ = {
  accent: '#0284c7', // series 1 — magnitude, and "paid"
  second: '#eb6834', // series 2 — "clamped away"
  axis: '#e2e8f0', // slate-200: hairline, recessive
  muted: '#94a3b8', // slate-400: axis text
  ink: '#334155', // slate-700: values
} as const;

const nf = new Intl.NumberFormat('en-US');
export const fmt = (n: number) => nf.format(Math.round(n));

/** Section heading for a chart, with an optional right-aligned total/aside. */
export function ChartHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span>
      {aside != null && <span className="text-xs tabular-nums text-slate-500">{aside}</span>}
    </div>
  );
}

/** Legend — always present for two or more series, so identity is never
 *  carried by color alone. A swatch beside text, never colored text. */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
      {label}
    </div>
  );
}

/** A KPI number. The form for "a single value", where a one-bar chart would be
 *  worse than no chart. */
export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
      <div className="text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

/**
 * Pre-normalised: 0..1 where 1 is that game's BEST round, whichever direction
 * best points. The caller owns the direction, because only it knows which games
 * score a time (Go-Karts) — normalising raw values by max here would label the
 * slowest race "best".
 */
export type RangeRow = {
  key: string;
  label: string;
  relLo: number;
  relMid: number;
  relHi: number;
  /** Right-column figure (the median, as the game scores it). */
  midText: string;
  /** Native <title> tooltip — carries the raw percentiles and direction. */
  title: string;
};

// These row charts are HTML, not SVG, on purpose. A viewBox scales its text
// along with its geometry, so a chart with three rows stretched to card width
// renders 5px labels at 20px — the first draft did exactly that. Percentage
// widths in CSS give the same responsive geometry while text keeps real,
// consistent type sizes.

/**
 * Distribution per category, as a range bar (p10–p90) with a median tick — NOT
 * 19 histograms and not 19 colors.
 *
 * Scores are normalised to each row's own best, because a Skee-Ball 780 and a
 * Darts 370 share no scale; the axis is "share of this game's best round" and
 * the real numbers ride the label and the tooltip. That keeps one hue doing
 * magnitude and makes the SHAPE (tight vs wide spread) comparable across games,
 * which is the actual question — a plausible mix of players, or one robot
 * playing perfectly every time?
 */
export function RangeBars({ rows }: { rows: RangeRow[] }) {
  if (rows.length === 0) return <Empty label="No rounds recorded." />;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const pc = (v: number) => Math.min(100, Math.max(0, v * 100));
        const lo = pc(Math.min(r.relLo, r.relHi));
        const hi = pc(Math.max(r.relLo, r.relHi));
        return (
          <div key={r.key} className="flex items-center gap-2 text-xs" title={r.title}>
            <span className="w-28 shrink-0 truncate text-right text-slate-700">{r.label}</span>
            <span className="relative h-2.5 flex-1">
              {/* track: the full worst→best span, so a narrow spread reads as narrow */}
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: VIZ.axis }} />
              <span
                className="absolute inset-y-0 rounded-[4px]"
                style={{ left: `${lo}%`, width: `${Math.max(0.6, hi - lo)}%`, background: VIZ.accent, opacity: 0.28 }}
              />
              <span
                className="absolute -inset-y-0.5 w-[2px] rounded-full"
                style={{ left: `calc(${pc(r.relMid)}% - 1px)`, background: VIZ.accent }}
              />
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums text-slate-500">{r.midText}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Skill → outcome, one dot per captured round, one hue.
 *
 * Score is again normalised to its own game's best, which is what lets every
 * game share one plot: the question isn't "who scores highest" (Darts always
 * would) but "does playing better actually score better?" A rising cloud means
 * the skill knob reaches the game; a flat one means it doesn't.
 */
export function SkillScatter({ points }: { points: { skill: number; rel: number; title: string }[] }) {
  if (points.length === 0) return <Empty label="No rounds with a recorded skill." />;
  const W = 200;
  const H = 90;
  const pad = 10;
  const px = (s: number) => pad + s * (W - pad * 2);
  const py = (r: number) => H - pad - r * (H - pad * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Skill against score, per round">
      {[0, 0.5, 1].map((g) => (
        <line key={g} x1={pad} y1={py(g)} x2={W - pad} y2={py(g)} stroke={VIZ.axis} strokeWidth="0.5" />
      ))}
      {points.map((p, i) => (
        // 2px surface ring so overlapping rounds stay countable.
        <circle key={i} cx={px(p.skill)} cy={py(p.rel)} r={2} fill={VIZ.accent} fillOpacity={0.55} stroke="#fff" strokeWidth={0.6}>
          <title>{p.title}</title>
        </circle>
      ))}
      <text x={pad} y={H - 2} fontSize="5" fill={VIZ.muted}>beginner</text>
      <text x={W - pad} y={H - 2} textAnchor="end" fontSize="5" fill={VIZ.muted}>expert</text>
      <text x={pad} y={py(1) - 2} fontSize="5" fill={VIZ.muted}>best round</text>
    </svg>
  );
}

/** Time buckets, one series, one hue. Bars are capped at the 24px mark spec so
 *  a two-bucket window reads as two bars, not two slabs. */
export function TimeBars<T extends { at: string }>({
  buckets,
  value,
  label,
  fmtAt,
}: {
  buckets: T[];
  value: (b: T) => number;
  label: string;
  fmtAt: (iso: string) => string;
}) {
  if (buckets.length === 0) return <Empty label={`No ${label} in this window.`} />;
  const vals = buckets.map(value);
  const max = Math.max(...vals, 1);
  return (
    <div>
      <div className="flex h-[72px] items-end gap-[2px] border-b" style={{ borderColor: VIZ.axis }}>
        {buckets.map((b, i) => (
          <span
            key={b.at}
            className="max-w-[24px] flex-1 rounded-t-[4px]"
            style={{
              height: `${vals[i] === 0 ? 0 : Math.max(3, (vals[i] / max) * 100)}%`,
              background: VIZ.accent,
            }}
            title={`${fmtAt(b.at)} · ${fmt(vals[i])} ${label}`}
          />
        ))}
      </div>
      {/* Both ends labelled: one date under a left-packed row of bars reads as
          "the rest of the axis is missing" rather than "the window is short". */}
      <div className="mt-1 flex justify-between text-xs text-slate-400">
        <span>{fmtAt(buckets[0].at)}</span>
        {buckets.length > 1 && <span>{fmtAt(buckets[buckets.length - 1].at)}</span>}
      </div>
    </div>
  );
}

/**
 * Part-to-whole per category: what was PAID versus what the server clamped
 * away. Two series, so a legend is mandatory; a 2px surface gap does the
 * separating rather than a stroke around each fill.
 */
export function PaidVsClamped({
  rows,
}: {
  rows: { key: string; label: string; awarded: number; requested: number }[];
}) {
  if (rows.length === 0) return <Empty label="No awards in this window." />;
  const maxReq = Math.max(...rows.map((r) => r.requested), 1);
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const clamped = Math.max(0, r.requested - r.awarded);
        return (
          <div key={r.key} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 truncate text-right text-slate-700">{r.label}</span>
            <span className="flex h-2.5 flex-1 gap-[2px]">
              <span
                className="rounded-[4px]"
                style={{ width: `${(r.awarded / maxReq) * 100}%`, background: VIZ.accent }}
                title={`${r.label} — ${fmt(r.awarded)} tickets paid`}
              />
              {clamped > 0 && (
                <span
                  className="rounded-[4px]"
                  style={{ width: `${(clamped / maxReq) * 100}%`, background: VIZ.second }}
                  title={`${r.label} — ${fmt(clamped)} tickets clamped by the server`}
                />
              )}
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums text-slate-500">{fmt(r.awarded)}</span>
          </div>
        );
      })}
    </div>
  );
}
