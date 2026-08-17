import { useNavigate } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { Screen, TopBar, Content } from '../../ui/components';
import { playClick } from '../../lib/sound';
import { usePos } from '../../lib/pos';

// The Arcade section (formerly "While You Wait") — the venue's whole roster of
// offline line-entertainment: ~24 attraction mini-games plus fun facts, trivia,
// a challenge spinner, and the photo booth. One of the app's top-level sections;
// each tile routes to its own screen. All content is bundled (works offline).

type Tile = {
  to: string;
  emoji: string;
  title: string;
  blurb: string;
  accent: string;
  // Games that credit tickets on the linked card — mirrors the server's
  // GAME_REWARD_GAMES registry (server/lib/gameRewards.js), i.e. the tiles whose
  // screen mounts <GameTicketAward>. The coin pusher (pure chance), Arcade Putt,
  // and Fun Facts don't earn, so they carry no flag. Drives the 🎟️ hint, shown
  // only where the venue actually sells game rewards.
  earns?: boolean;
};

const TILES: Tile[] = [
  {
    to: '/arcade/facts',
    emoji: '💡',
    title: 'Fun Facts',
    blurb: 'Bite-size facts about the games you love.',
    accent: '#f59e0b',
  },
  {
    to: '/arcade/trivia',
    emoji: '🧠',
    title: 'Trivia',
    blurb: 'Ten quick questions — how many can you get?',
    accent: '#3b82f6',
    earns: true,
  },
  {
    to: '/arcade/trivia/live',
    emoji: '🎤',
    title: 'Live Trivia',
    blurb: 'Join the room game — solo or as a table.',
    accent: '#8b5cf6',
  },
  {
    to: '/arcade/putt',
    emoji: '⛳️',
    title: 'Arcade Putt',
    blurb: 'Mini-golf — sink it in as few strokes as you can.',
    accent: '#16a34a',
  },
  {
    to: '/arcade/skeeball',
    emoji: '🎳',
    title: 'Skee-Ball',
    blurb: 'Roll the lane — nail the corners for 100.',
    accent: '#22c55e',
    earns: true,
  },
  {
    to: '/arcade/airhockey',
    emoji: '🏒',
    title: 'Air Hockey',
    blurb: 'Face the CPU — first to seven goals wins.',
    accent: '#38bdf8',
    earns: true,
  },
  {
    to: '/arcade/bumper',
    emoji: '🚗',
    title: 'Bumper Cars',
    blurb: 'Ram the pack — most bumps in 30 seconds.',
    accent: '#f97316',
    earns: true,
  },
  {
    to: '/arcade/boats',
    emoji: '🚤',
    title: 'Bumper Boats',
    blurb: 'Bumper cars on water — floatier, driftier bumps.',
    accent: '#0ea5e9',
    earns: true,
  },
  {
    to: '/arcade/axe',
    emoji: '🪓',
    title: 'Axe Throwing',
    blurb: 'Time your throw — stick the bullseye or a clutch.',
    accent: '#eab308',
    earns: true,
  },
  {
    to: '/arcade/batting',
    emoji: '⚾️',
    title: 'Batting Cages',
    blurb: 'Time your swing — crush it for a home run.',
    accent: '#ef4444',
    earns: true,
  },
  {
    to: '/arcade/bowling',
    emoji: '🎳',
    title: 'Bowling',
    blurb: 'Roll a full 10-frame game — go for the strike.',
    accent: '#a855f7',
    earns: true,
  },
  {
    to: '/arcade/karts',
    emoji: '🏁',
    title: 'Go-Karts',
    blurb: 'Three-lap time trial — set your best lap.',
    accent: '#06b6d4',
    earns: true,
  },
  {
    to: '/arcade/mole',
    emoji: '🔨',
    title: 'Whack-a-Mole',
    blurb: 'Bop the gophers — gold pays triple, bombs bite.',
    accent: '#84cc16',
    earns: true,
  },
  {
    to: '/arcade/hoops',
    emoji: '🏀',
    title: 'Pop-a-Shot',
    blurb: '45 seconds of buckets — hit the bonus round.',
    accent: '#fb923c',
    earns: true,
  },
  {
    to: '/arcade/darts',
    emoji: '🎯',
    title: 'Darts',
    blurb: 'Nine darts — trebles, doubles, and the bull.',
    accent: '#dc2626',
    earns: true,
  },
  {
    to: '/arcade/gallery',
    emoji: '🦆',
    title: 'Shooting Gallery',
    blurb: 'Six shots, three shelves — drop the tin ducks.',
    accent: '#facc15',
    earns: true,
  },
  {
    to: '/arcade/claw',
    emoji: '🧸',
    title: 'Claw Machine',
    blurb: 'Five credits — center the grip, carry it home.',
    accent: '#ec4899',
    earns: true,
  },
  {
    to: '/arcade/striker',
    emoji: '🔔',
    title: 'High Striker',
    blurb: 'One perfect swing — ring the bell.',
    accent: '#f43f5e',
    earns: true,
  },
  {
    to: '/arcade/rings',
    emoji: '🎪',
    title: 'Ring Toss',
    blurb: 'Flick rings onto the bottles — red pays five.',
    accent: '#8b5cf6',
    earns: true,
  },
  {
    to: '/arcade/bottles',
    emoji: '🥛',
    title: 'Milk Bottles',
    blurb: 'Three racks — smash the pyramid clean.',
    accent: '#e5e7eb',
    earns: true,
  },
  {
    to: '/arcade/watergun',
    emoji: '💦',
    title: 'Water Gun Race',
    blurb: 'Soak the bullseye — first balloon to pop wins.',
    accent: '#2dd4bf',
    earns: true,
  },
  {
    to: '/arcade/pinball',
    emoji: '🕹️',
    title: 'Pinball',
    blurb: 'Three balls, two flippers — light the lanes.',
    accent: '#d946ef',
    earns: true,
  },
  {
    to: '/arcade/pusher',
    emoji: '🪙',
    title: 'Coin Pusher',
    blurb: 'Time your drops — push the shelf over the edge.',
    accent: '#fbbf24',
  },
];

export default function FunZone() {
  const navigate = useNavigate();
  // The 🎟️ hint only makes sense where the venue actually credits tickets — if
  // this location doesn't sell game rewards, no game pays out, so show nothing.
  const { gameRewards } = usePos();

  return (
    <Screen>
      <TopBar title="Arcade" back="/" />
      <Content>
        <p className="mb-3 text-center text-sm text-fairway-100/70">
          Every game in the house — plus facts and trivia.
          <br />
          Pass the time between attractions.
        </p>

        {/* Full-width, above the grid rather than a tile inside it: the boards
            are ABOUT the games, not another one of them, and burying that in
            slot 27 of a 2-column grid would hide the reason to play twice. */}
        <button
          onClick={() => {
            playClick();
            navigate('/arcade/scores');
          }}
          className="surface-1 mb-3 flex w-full items-center gap-2.5 rounded-xl border border-fairway-800/60 px-3 py-2.5 text-left transition-transform active:translate-y-px"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl"
            style={{ background: '#fbbf2422', border: '1px solid #fbbf2455' }}
          >
            🏆
          </span>
          <span className="block min-w-0 flex-1">
            <span className="block text-sm font-bold leading-tight text-fairway-50">
              High Scores
            </span>
            <span className="block text-xs leading-tight text-fairway-100/70">
              Every game's top ten at this venue.
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-fairway-400">→</span>
        </button>

        <button
          onClick={() => {
            playClick();
            navigate('/arcade/challenges');
          }}
          className="surface-1 mb-3 flex w-full items-center gap-2.5 rounded-xl border border-fairway-800/60 px-3 py-2.5 text-left transition-transform active:translate-y-px"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl"
            style={{ background: '#38bdf822', border: '1px solid #38bdf855' }}
          >
            ⚔️
          </span>
          <span className="block min-w-0 flex-1">
            <span className="block text-sm font-bold leading-tight text-fairway-50">
              Head to Head
            </span>
            <span className="block text-xs leading-tight text-fairway-100/70">
              Challenge a friend — together or whenever.
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-fairway-400">→</span>
        </button>

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
              <span className="block min-w-0 flex-1 text-sm font-bold leading-tight text-fairway-50">
                {t.title}
              </span>
              {gameRewards && t.earns && (
                <span
                  className="shrink-0 text-base leading-none"
                  role="img"
                  aria-label="Earns tickets"
                  title="Earns tickets"
                >
                  🎟️
                </span>
              )}
            </button>
          ))}
        </div>
      </Content>
    </Screen>
  );
}
