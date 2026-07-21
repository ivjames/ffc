import { useState, type CSSProperties, type ReactNode } from 'react';
import { Screen, TopBar, Content, Button, TagChip } from '../../ui/components';
import { BuildStamp } from '../../ui/BuildStamp';
import ThemeToggle from '../../ui/ThemeToggle';
import SoundToggle from '../../ui/SoundToggle';
import SkinPicker from '../../ui/SkinPicker';
import Confetti from '../../ui/Confetti';
import { themeEmoji, accentInk } from '../../lib/theme';

// A living style guide / component inventory. Renders every reusable element the
// app is built from — using the REAL components, CSS classes, and tokens — so it
// re-skins live with the 🎨 picker and follows light/dark, and stays accurate as
// the app changes. This is the reference an artist works from when replacing the
// CSS-art materials with real themed assets. Reachable at /style.

// The inkable course themes (name, theme key, raw accent hex). themeEmoji() and
// accentInk() key off `theme`; the raw hex drives tiles/tags/pucks/glows.
const THEMES = [
  { name: 'Green', theme: 'green', accent: '#22c55e' },
  { name: 'Blue', theme: 'blue', accent: '#3b82f6' },
  { name: 'Red', theme: 'red', accent: '#ef4444' },
  { name: 'Dragon', theme: 'dragon', accent: '#ea580c' },
  { name: 'Western', theme: 'western', accent: '#b45309' },
];

const RAMP = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// ——— Small layout helpers (guide chrome only; not app components) ———
function Section({ n, title, desc, children }: { n: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="mb-9">
      <div className="mb-3 border-b border-fairway-800/60 pb-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-fairway-400">{n}</span>
          <h2 className="text-lg font-black tracking-tight text-fairway-50">{title}</h2>
        </div>
        {desc && <p className="mt-0.5 text-xs text-fairway-100/70">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

// A labelled specimen: the element, with its name/class caption underneath.
function Spec({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex min-h-[3rem] items-center justify-center">{children}</div>
      <span className="font-mono text-[10px] leading-tight text-fairway-400">{label}</span>
    </div>
  );
}

export default function StyleGuide() {
  const [punch, setPunch] = useState(0); // retrigger score-punch demo
  const [motionKey, setMotionKey] = useState(0); // replay entrance animations
  const [confetti, setConfetti] = useState(0); // fire confetti demo

  return (
    <Screen>
      <TopBar title="Style guide" back="/" />
      <Content>
        <p className="mb-6 text-sm text-fairway-100/80">
          Every element the app is built from, rendered live. Switch skins with the 🎨 pill and toggle
          light/dark (bottom-left) — everything here re-skins with them. This is the working inventory for
          theming the app with real art.
        </p>

        {/* 01 · COLOR TOKENS */}
        <Section n="01" title="Color · the fairway ramp" desc="Neutral environment ramp (11 steps). Backgrounds, cards, borders, and muted labels all draw from these; they invert between light and dark.">
          <div className="grid grid-cols-6 gap-2">
            {RAMP.map((s) => (
              <Spec key={s} label={String(s)}>
                <span
                  className="block h-10 w-10 rounded-lg ring-1 ring-inset ring-fairway-500/30"
                  style={{ background: `var(--color-fairway-${s})` }}
                />
              </Spec>
            ))}
          </div>
        </Section>

        {/* 02 · ACCENT + INK + SCORE */}
        <Section n="02" title="Color · accent, inks & score signals" desc="Interactive accent (house green, or the course color on themed screens), the per-course text inks, and the under/over-par score colors.">
          <div className="mb-4 flex flex-wrap gap-3">
            <Spec label="--accent">
              <span className="block h-10 w-10 rounded-lg" style={{ background: 'var(--accent)' }} />
            </Spec>
            <Spec label="--score-under">
              <span className="text-2xl font-black" style={{ color: 'var(--score-under)' }}>
                −3
              </span>
            </Spec>
            <Spec label="--score-over">
              <span className="text-2xl font-black" style={{ color: 'var(--score-over)' }}>
                +5
              </span>
            </Spec>
            <Spec label="par (neutral)">
              <span className="text-2xl font-black text-fairway-100">E</span>
            </Spec>
          </div>
          <div className="flex flex-wrap gap-3">
            {['default', ...THEMES.map((t) => t.theme)].map((th) => (
              <Spec key={th} label={`ink · ${th}`}>
                <span className="surface-1 rounded-lg px-3 py-1.5 text-lg font-black" style={{ color: accentInk(th) }}>
                  Aa
                </span>
              </Spec>
            ))}
          </div>
        </Section>

        {/* 03 · SURFACES & DEPTH */}
        <Section n="03" title="Surfaces & depth" desc="The raised/recessed materials every card, panel, and control is painted with. Skins swap these wholesale.">
          <div className="grid grid-cols-2 gap-4">
            <Spec label=".surface">
              <div className="surface h-16 w-full rounded-2xl" />
            </Spec>
            <Spec label=".surface-1">
              <div className="surface-1 h-16 w-full rounded-2xl" />
            </Spec>
            <Spec label=".surface-sunk">
              <div className="surface-sunk h-16 w-full rounded-2xl" />
            </Spec>
            <Spec label=".key (raised)">
              <div className="key h-16 w-full rounded-2xl" />
            </Spec>
          </div>
        </Section>

        {/* 04 · TYPOGRAPHY */}
        <Section n="04" title="Typography" desc="The type scale in use — heavy display weights, uppercase eyebrows, and the monospace arcade face for tags & numerals.">
          <div className="space-y-2">
            <div className="text-5xl font-black tracking-tight text-fairway-50">Aa 5xl</div>
            <div className="text-3xl font-black tracking-tight text-fairway-50">Aa 3xl · black</div>
            <div className="text-xl font-bold text-fairway-50">Aa xl · bold</div>
            <div className="text-base text-fairway-100">Aa base · body copy</div>
            <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">Eyebrow · xs uppercase</div>
            <div className="font-arcade text-2xl font-black text-fairway-50">ABC · arcade</div>
            <div className="font-mono text-2xl font-black text-fairway-100/60">01 · mono rank</div>
          </div>
        </Section>

        {/* 05 · BUTTONS */}
        <Section n="05" title="Buttons" desc="Primary (catches a one-shot sheen), ghost, and danger — plus their disabled/inert states.">
          <div className="space-y-3">
            <Button>Primary action</Button>
            <Button variant="ghost">Ghost action</Button>
            <Button variant="danger">Danger action</Button>
            <div className="grid grid-cols-3 gap-3 pt-1">
              <Spec label="disabled">
                <Button disabled>Primary</Button>
              </Spec>
              <Spec label="disabled">
                <Button variant="ghost" disabled>
                  Ghost
                </Button>
              </Spec>
              <Spec label="disabled">
                <Button variant="danger" disabled>
                  Danger
                </Button>
              </Spec>
            </div>
          </div>
        </Section>

        {/* 06 · KEYS, STEPPER, PAR */}
        <Section n="06" title="Steppers & score readout" desc="The play-screen stepper: raised ± keys around a carved score well, plus the par medallion and the hole-jump grid.">
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={() => setPunch((p) => p + 1)}
              className="key flex h-14 w-14 items-center justify-center rounded-2xl text-3xl font-bold text-fairway-100"
              aria-label="Decrease"
            >
              −
            </button>
            <div className="surface-sunk flex h-14 flex-1 items-center justify-center rounded-2xl">
              <span key={punch} className="animate-score-punch inline-block text-4xl font-black text-fairway-50">
                {2 + (punch % 4)}
              </span>
            </div>
            <button
              onClick={() => setPunch((p) => p + 1)}
              className="key flex h-14 w-14 items-center justify-center rounded-2xl text-3xl font-bold text-fairway-100"
              aria-label="Increase"
            >
              +
            </button>
          </div>
          <div className="flex items-center gap-6">
            <Spec label="par medallion">
              <div className="surface-1 flex h-12 w-12 items-center justify-center rounded-full text-2xl font-black" style={{ color: accentInk('green') }}>
                3
              </div>
            </Spec>
            <Spec label="hole-jump grid">
              <div className="grid grid-cols-6 gap-1.5">
                {Array.from({ length: 6 }, (_, i) => (
                  <span
                    key={i}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${
                      i === 2
                        ? 'btn-accent text-fairway-50'
                        : i < 2
                          ? 'surface-1 text-fairway-100'
                          : 'border border-fairway-700 text-fairway-400'
                    }`}
                  >
                    {i + 1}
                  </span>
                ))}
              </div>
            </Spec>
          </div>
        </Section>

        {/* 07 · COURSE TILES & PUCKS */}
        <Section n="07" title="Course tiles & pucks" desc="The Home course grid: a candy-key tile in the course color with a domed emoji puck. Skins restyle both.">
          <div className="grid grid-cols-3 gap-3">
            {THEMES.map((t, i) => (
              <button
                key={t.theme}
                className="tile animate-pop-in flex flex-col items-center gap-2.5 rounded-3xl px-2 py-4"
                style={{ '--i': i, '--tile-accent': t.accent } as CSSProperties}
              >
                <span
                  className="course-puck flex h-14 w-14 items-center justify-center rounded-full text-3xl"
                  style={{ '--puck-accent': t.accent } as CSSProperties}
                >
                  {themeEmoji(t.theme)}
                </span>
                <span className="text-sm font-black text-fairway-50">{t.name}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* 08 · TAGS */}
        <Section n="08" title="Player tags" desc="Arcade 3-char chips, colored by the course accent (or the house green default).">
          <div className="flex flex-wrap items-center gap-2">
            {THEMES.map((t) => (
              <TagChip key={t.theme} tag={t.name.slice(0, 3).toUpperCase()} color={t.accent} />
            ))}
            <TagChip tag="JZ" />
            <TagChip tag="" />
          </div>
        </Section>

        {/* 09 · NAV CARDS */}
        <Section n="09" title="Location bar & resume card" desc="The two headline Home cards — a surface-1 selector and the glowing surface CTA.">
          <button className="surface-1 mb-3 flex w-full items-center justify-between rounded-2xl border border-fairway-800/60 px-4 py-2.5 text-left">
            <span className="flex items-center gap-2">
              <span className="text-lg">📍</span>
              <span>
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-fairway-400">Location</span>
                <span className="block font-bold text-fairway-50">Upland</span>
              </span>
            </span>
            <span className="text-sm font-semibold text-fairway-400">Change</span>
          </button>
          <button
            className="surface animate-glow-pulse w-full rounded-2xl border border-fairway-500/40 p-3.5 text-left"
            style={{ '--glow': '#22c55e' } as CSSProperties}
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">Resume round</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-lg font-bold text-fairway-50">Green Course</span>
              <span className="flex gap-1">
                <TagChip tag="AVA" color="#22c55e" />
                <TagChip tag="JZ" color="#22c55e" />
              </span>
            </div>
          </button>
        </Section>

        {/* 10 · SCORECARD & WINNER */}
        <Section n="10" title="Scorecard & winner" desc="The final-card materials: the trophy hero, a standings row, and the nine-grid table with under/over score signals.">
          {/* Winner hero */}
          <div className="animate-glow-pulse mb-3 rounded-3xl" style={{ '--glow': '#22c55e' } as CSSProperties}>
            <div className="surface relative overflow-hidden rounded-3xl border border-fairway-500/40 p-4">
              <div className="relative flex items-center gap-4">
                <div className="animate-trophy-pop w-12 shrink-0 text-center text-4xl leading-none">🏆</div>
                <div className="min-w-0 flex-1 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-fairway-400">Winner</div>
                  <div className="font-arcade text-2xl font-black" style={{ color: accentInk('green') }}>
                    AVA
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-xl font-black text-fairway-50">41</span>
                  <span className="ml-1 text-xs text-fairway-100/70">−4</span>
                </div>
              </div>
            </div>
          </div>
          {/* Standings row */}
          <div className="surface-1 mb-4 flex items-center gap-4 rounded-2xl border border-fairway-800/60 px-5 py-3">
            <span className="w-10 shrink-0 text-center font-mono text-2xl font-black text-fairway-100/50">2</span>
            <div className="min-w-0 flex-1 text-center">
              <span className="font-arcade text-xl font-bold" style={{ color: accentInk('blue') }}>
                JZ
              </span>
            </div>
            <div className="shrink-0 text-right">
              <span className="text-xl font-black text-fairway-50">45</span>
              <span className="ml-1 text-sm text-fairway-100/70">E</span>
            </div>
          </div>
          {/* Mini nine-grid */}
          <div className="surface-1 overflow-hidden rounded-2xl border border-fairway-800/60">
            <table className="w-full table-fixed border-collapse text-center text-sm leading-none">
              <thead>
                <tr className="bg-fairway-900/60 text-fairway-100/70">
                  <th className="px-2 py-1.5 text-left font-semibold">Front</th>
                  {[1, 2, 3, 4, 5].map((h) => (
                    <th key={h} className="px-0.5 py-1.5 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
                <tr className="bg-fairway-950 text-fairway-100/70">
                  <th className="px-2 py-1 text-left font-normal">Par</th>
                  {[3, 2, 4, 3, 3].map((p, i) => (
                    <td key={i} className="px-0.5 py-1">
                      {p}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-fairway-800">
                  <th className="font-arcade px-2 py-1.5 text-left font-bold" style={{ color: accentInk('green') }}>
                    AVA
                  </th>
                  {[
                    [2, 'var(--score-under)'],
                    [2, undefined],
                    [6, 'var(--score-over)'],
                    [3, undefined],
                    [2, 'var(--score-under)'],
                  ].map(([v, c], i) => (
                    <td key={i} className={`px-0.5 py-1.5 ${c ? '' : 'text-fairway-100'}`} style={c ? { color: c as string } : undefined}>
                      {v}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        {/* 11 · CONTROLS */}
        <Section n="11" title="Controls & chrome" desc="The persistent corner controls and status pills.">
          <div className="flex flex-wrap items-center gap-5">
            <Spec label="SkinPicker">
              <SkinPicker />
            </Spec>
            <Spec label="ThemeToggle">
              <ThemeToggle />
            </Spec>
            <Spec label="SoundToggle">
              <SoundToggle />
            </Spec>
            <Spec label="BuildStamp">
              <BuildStamp />
            </Spec>
          </div>
        </Section>

        {/* 12 · FUN ZONE */}
        <Section n="12" title="While-You-Wait primitives" desc="The Fun-zone building blocks: a hub tile, the prize wheel, a result card, and trivia answer states.">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl" style={{ background: '#22c55e22', border: '1px solid #22c55e55' }}>
              🎳
            </span>
            <span className="font-bold text-fairway-50">Fun tile</span>
          </div>
          <div className="mb-4 flex items-center gap-6">
            <Spec label="prize wheel">
              <svg viewBox="0 0 100 100" className="h-24 w-24">
                {Array.from({ length: 6 }, (_, i) => {
                  const a0 = (i / 6) * 2 * Math.PI - Math.PI / 2;
                  const a1 = ((i + 1) / 6) * 2 * Math.PI - Math.PI / 2;
                  const x0 = 50 + 48 * Math.cos(a0), y0 = 50 + 48 * Math.sin(a0);
                  const x1 = 50 + 48 * Math.cos(a1), y1 = 50 + 48 * Math.sin(a1);
                  const fill = ['#3b82f6', '#2563eb', '#f59e0b', '#d97706', '#3b82f6', '#f59e0b'][i];
                  return <path key={i} d={`M50 50 L${x0} ${y0} A48 48 0 0 1 ${x1} ${y1} Z`} fill={fill} stroke="#00000030" strokeWidth="0.5" />;
                })}
                <circle cx="50" cy="50" r="9" className="fill-fairway-900" stroke="var(--color-fairway-700)" />
              </svg>
            </Spec>
            <Spec label="result card">
              <div className="animate-result-swell rounded-2xl border border-fairway-700 bg-fairway-900/50 px-4 py-3 text-center">
                <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">🎉 Just for fun</div>
                <div className="mt-1 text-2xl">🎯</div>
              </div>
            </Spec>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-green-500 bg-green-500/20 px-3 py-2 text-sm font-bold text-fairway-50">Correct ✓</div>
            <div className="rounded-xl border border-red-500 bg-red-500/20 px-3 py-2 text-sm font-bold text-fairway-50">Wrong ✗</div>
          </div>
        </Section>

        {/* 13 · GLYPHS */}
        <Section n="13" title="Icon markers (emoji = placeholder theme)" desc="Every glyph currently used as a UI marker. Emoji is a stand-in — it becomes one swappable icon theme, not the default; each theme supplies its own marker art. This is the full set that needs designing.">
          {[
            ['Course identity', ['🟢', '🔵', '🔴', '🐉', '🤠', '🌴', '⛳️']],
            ['Navigation & chrome', ['⛳️', '📍', '‹', '›', '•', '·', '🔄']],
            ['Controls', ['🎨', '☀️', '🌙', '🔊', '🔇']],
            ['Play controls', ['+', '−', '🔍', '🎡', '⏸', '▶', '⏭', '🏆', '✓']],
            ['Fun zone', ['💡', '🧠', '🎳', '🏒', '🚗', '🚤', '🪓', '⚾️', '🏁', '🔻', '🤖', '🏌️']],
          ].map(([label, glyphs]) => (
            <div key={label as string} className="mb-2">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-fairway-400">{label}</div>
              <div className="flex flex-wrap gap-2 text-2xl">
                {(glyphs as string[]).map((g, i) => (
                  <span key={i} className="surface-1 flex h-10 w-10 items-center justify-center rounded-lg">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </Section>

        {/* 14 · MOTION */}
        <Section n="14" title="Motion" desc="The entrance & feedback animations. Tap replay to re-run the entrances; the score well punches on ± above.">
          <button onClick={() => setMotionKey((k) => k + 1)} className="key mb-3 rounded-xl px-3 py-1.5 text-sm font-bold text-fairway-100">
            ↻ Replay entrances
          </button>
          <div key={motionKey} className="grid grid-cols-3 gap-3">
            <Spec label="animate-pop-in">
              <div className="animate-pop-in surface-1 h-12 w-full rounded-xl" />
            </Spec>
            <Spec label="animate-rise-in">
              <div className="animate-rise-in surface-1 h-12 w-full rounded-xl" />
            </Spec>
            <Spec label="animate-wiggle">
              <span className="animate-wiggle inline-block text-3xl">⛳️</span>
            </Spec>
          </div>
          <div className="mt-3">
            <button onClick={() => setConfetti((c) => c + 1)} className="key rounded-xl px-3 py-1.5 text-sm font-bold text-fairway-100">
              🎉 Fire confetti
            </button>
            {confetti > 0 && <Confetti key={confetti} fire />}
          </div>
        </Section>

        <p className="pb-4 text-center font-mono text-[10px] text-fairway-400">
          /style · re-skins with every template · light + dark
        </p>
      </Content>
    </Screen>
  );
}
