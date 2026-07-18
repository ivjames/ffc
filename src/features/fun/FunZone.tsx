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
    to: '/fun/spinner',
    emoji: '🎡',
    title: 'Challenge Spinner',
    blurb: 'Spin for a silly dare while you wait your turn.',
    accent: '#ec4899',
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
        <p className="mb-4 text-center text-sm text-fairway-100/70">
          Waiting for a lane, a kart, or the next hole? Pass the time.
        </p>

        <div className="space-y-3">
          {TILES.map((t, i) => (
            <button
              key={t.to}
              onClick={() => {
                playClick();
                navigate(t.to);
              }}
              className="animate-rise-in flex w-full items-center gap-3 rounded-2xl border px-4 py-4 text-left transition active:scale-[0.98]"
              style={
                {
                  '--i': i,
                  background: `${t.accent}1a`,
                  borderColor: `${t.accent}66`,
                } as CSSProperties
              }
            >
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
                style={{ background: `${t.accent}33` }}
              >
                {t.emoji}
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-bold text-fairway-50">{t.title}</span>
                <span className="block text-sm text-fairway-100/70">{t.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </Content>
    </Screen>
  );
}
