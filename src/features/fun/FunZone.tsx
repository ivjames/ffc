import { useNavigate } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { Screen, TopBar, Content } from '../../ui/components';
import { playClick } from '../../lib/sound';

// §12 "While You Wait" — a small hub of offline line-entertainment: rotating
// fun facts, a quick trivia round, and a challenge spinner. Reached from Home;
// each tile routes to its own screen. All content is bundled (works offline).

type Tile = {
  to: string;
  emoji: string;
  title: string;
  blurb: string;
  accent: string;
};

const TILES: Tile[] = [
  {
    to: '/fun/facts',
    emoji: '💡',
    title: 'Fun Facts',
    blurb: 'Bite-size facts about the games you love.',
    accent: '#f59e0b',
  },
  {
    to: '/fun/trivia',
    emoji: '🧠',
    title: 'Trivia',
    blurb: 'Ten quick questions — how many can you get?',
    accent: '#3b82f6',
  },
  {
    to: '/putt',
    emoji: '⛳️',
    title: 'Arcade Putt',
    blurb: 'Mini-golf — sink it in as few strokes as you can.',
    accent: '#16a34a',
  },
  {
    to: '/fun/skeeball',
    emoji: '🎳',
    title: 'Skee-Ball',
    blurb: 'Roll the lane — nail the corners for 100.',
    accent: '#22c55e',
  },
  {
    to: '/fun/airhockey',
    emoji: '🏒',
    title: 'Air Hockey',
    blurb: 'Face the CPU — first to seven goals wins.',
    accent: '#38bdf8',
  },
  {
    to: '/fun/bumper',
    emoji: '🚗',
    title: 'Bumper Cars',
    blurb: 'Ram the pack — most bumps in 30 seconds.',
    accent: '#f97316',
  },
  {
    to: '/fun/boats',
    emoji: '🚤',
    title: 'Bumper Boats',
    blurb: 'Bumper cars on water — floatier, driftier bumps.',
    accent: '#0ea5e9',
  },
  {
    to: '/fun/axe',
    emoji: '🪓',
    title: 'Axe Throwing',
    blurb: 'Time your throw — stick the bullseye or a clutch.',
    accent: '#eab308',
  },
  {
    to: '/fun/batting',
    emoji: '⚾️',
    title: 'Batting Cages',
    blurb: 'Time your swing — crush it for a home run.',
    accent: '#ef4444',
  },
  {
    to: '/fun/bowling',
    emoji: '🎳',
    title: 'Bowling',
    blurb: 'Roll a full 10-frame game — go for the strike.',
    accent: '#a855f7',
  },
  {
    to: '/fun/karts',
    emoji: '🏁',
    title: 'Go-Karts',
    blurb: 'Three-lap time trial — set your best lap.',
    accent: '#06b6d4',
  },
];

export default function FunZone() {
  const navigate = useNavigate();

  return (
    <Screen>
      <TopBar title="While You Wait" back="/" />
      <Content>
        <p className="mb-3 text-center text-sm text-fairway-100/70">
          Waiting for a lane, a kart, or the next hole?
          <br />
          Pass the time.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {TILES.map((t, i) => (
            <button
              key={t.to}
              onClick={() => {
                playClick();
                navigate(t.to);
              }}
              className="surface-1 animate-rise-in flex h-full w-full items-center gap-2.5 rounded-xl border border-fairway-800/60 px-3 py-2.5 text-left transition-transform active:translate-y-px"
              style={{ '--i': i } as CSSProperties}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl"
                style={{ background: `${t.accent}22`, border: `1px solid ${t.accent}55` }}
              >
                {t.emoji}
              </span>
              <span className="block min-w-0 text-sm font-bold leading-tight text-fairway-50">
                {t.title}
              </span>
            </button>
          ))}
        </div>
      </Content>
    </Screen>
  );
}
