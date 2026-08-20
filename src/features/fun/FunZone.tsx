import { useNavigate } from 'react-router-dom';
import { useEffect, type CSSProperties } from 'react';
import { Screen, TopBar, Content } from '../../ui/components';
import Icon from '../../ui/Icon';
import type { DrawnIcon } from '../../ui/icons/registry';
import { playClick } from '../../lib/sound';
import { usePos } from '../../lib/pos';
import { clearActiveChallenge } from '../../lib/activeChallenge';

// The Arcade section (formerly "While You Wait") — the venue's whole roster of
// offline line-entertainment: ~24 attraction mini-games plus fun facts, trivia,
// a challenge spinner, and the photo booth. One of the app's top-level sections;
// each tile routes to its own screen. All content is bundled (works offline).

type Tile = {
  to: string;
  /**
   * Semantic icon name, NOT a picture. Skee-Ball and Bowling both showed 🎳
   * and Whack-a-Mole and High Striker both showed 🔨 — the emoji font has no
   * separate glyph for them, so the tiles were lying about being different
   * games. Naming the meaning lets each one have its own drawing; see
   * src/ui/icons/manifest.ts.
   */
  icon: DrawnIcon;
  title: string;
  blurb: string;
  accent: string;
  // Games that credit tickets on the linked card — mirrors the server's
  // GAME_REWARD_GAMES registry (server/lib/gameRewards.js), i.e. the tiles whose
  // screen mounts <GameAwards> with a real ticket count. Arcade Putt (tickets: 0)
  // and Fun Facts don't earn, so they carry no flag. Drives the 🎟️ hint, shown
  // only where the venue actually sells game rewards.
  earns?: boolean;
};

const TILES: Tile[] = [
  {
    to: '/arcade/facts',
    icon: 'game.fun-facts',
    title: 'Fun Facts',
    blurb: 'Bite-size facts about the games you love.',
    accent: '#f59e0b',
  },
  {
    to: '/arcade/trivia',
    icon: 'game.trivia',
    title: 'Trivia',
    blurb: 'Ten quick questions — how many can you get?',
    accent: '#3b82f6',
    earns: true,
  },
  {
    to: '/arcade/trivia/live',
    // Not game.trivia: that is the solo game's icon, and reusing it here would
    // recreate exactly the collision the icon set was built to pull apart.
    // What distinguishes Live Trivia is that it's the one you play together.
    icon: 'action.play-together',
    title: 'Live Trivia',
    blurb: 'Join the room game — solo or as a table.',
    accent: '#8b5cf6',
  },
  {
    to: '/arcade/putt',
    icon: 'game.arcade-putt',
    title: 'Arcade Putt',
    blurb: 'Mini-golf — sink it in as few strokes as you can.',
    accent: '#16a34a',
  },
  {
    to: '/arcade/skeeball',
    icon: 'game.skee-ball',
    title: 'Skee-Ball',
    blurb: 'Roll the lane — nail the corners for 100.',
    accent: '#22c55e',
    earns: true,
  },
  {
    to: '/arcade/airhockey',
    icon: 'game.air-hockey',
    title: 'Air Hockey',
    blurb: 'Face the CPU — first to seven goals wins.',
    accent: '#38bdf8',
    earns: true,
  },
  {
    to: '/arcade/bumper',
    icon: 'game.bumper-cars',
    title: 'Bumper Cars',
    blurb: 'Ram the pack — most bumps in 30 seconds.',
    accent: '#f97316',
    earns: true,
  },
  {
    to: '/arcade/boats',
    icon: 'game.bumper-boats',
    title: 'Bumper Boats',
    blurb: 'Bumper cars on water — floatier, driftier bumps.',
    accent: '#0ea5e9',
    earns: true,
  },
  {
    to: '/arcade/axe',
    icon: 'game.axe-throwing',
    title: 'Axe Throwing',
    blurb: 'Time your throw — stick the bullseye or a clutch.',
    accent: '#eab308',
    earns: true,
  },
  {
    to: '/arcade/batting',
    icon: 'game.batting-cages',
    title: 'Batting Cages',
    blurb: 'Time your swing — crush it for a home run.',
    accent: '#ef4444',
    earns: true,
  },
  {
    to: '/arcade/bowling',
    icon: 'game.bowling',
    title: 'Bowling',
    blurb: 'Roll a full 10-frame game — go for the strike.',
    accent: '#a855f7',
    earns: true,
  },
  {
    to: '/arcade/karts',
    icon: 'game.go-karts',
    title: 'Go-Karts',
    blurb: 'Three-lap time trial — set your best lap.',
    accent: '#06b6d4',
    earns: true,
  },
  {
    to: '/arcade/mole',
    icon: 'game.whack-a-mole',
    title: 'Whack-a-Mole',
    blurb: 'Bop the gophers — gold pays triple, bombs bite.',
    accent: '#84cc16',
    earns: true,
  },
  {
    to: '/arcade/hoops',
    icon: 'game.pop-a-shot',
    title: 'Pop-a-Shot',
    blurb: '45 seconds of buckets — hit the bonus round.',
    accent: '#fb923c',
    earns: true,
  },
  {
    to: '/arcade/darts',
    icon: 'game.darts',
    title: 'Darts',
    blurb: 'Nine darts — trebles, doubles, and the bull.',
    accent: '#dc2626',
    earns: true,
  },
  {
    to: '/arcade/gallery',
    icon: 'game.shooting-gallery',
    title: 'Shooting Gallery',
    blurb: 'Six shots, three shelves — drop the tin ducks.',
    accent: '#facc15',
    earns: true,
  },
  {
    to: '/arcade/sheep',
    icon: 'game.sheep-drive',
    title: 'Sheep Drive',
    blurb: 'Send the dog — herd the whole flock into the pen.',
    accent: '#a3e635',
    earns: true,
  },
  {
    to: '/arcade/claw',
    icon: 'game.claw-machine',
    title: 'Claw Machine',
    blurb: 'Five credits — center the grip, carry it home.',
    accent: '#ec4899',
    earns: true,
  },
  {
    to: '/arcade/striker',
    icon: 'game.high-striker',
    title: 'High Striker',
    blurb: 'One perfect swing — ring the bell.',
    accent: '#f43f5e',
    earns: true,
  },
  {
    to: '/arcade/rings',
    icon: 'game.ring-toss',
    title: 'Ring Toss',
    blurb: 'Flick rings onto the bottles — red pays five.',
    accent: '#8b5cf6',
    earns: true,
  },
  {
    to: '/arcade/bottles',
    icon: 'game.milk-bottles',
    title: 'Milk Bottles',
    blurb: 'Three racks — smash the pyramid clean.',
    accent: '#e5e7eb',
    earns: true,
  },
  {
    to: '/arcade/watergun',
    icon: 'game.water-gun-race',
    title: 'Water Gun Race',
    blurb: 'Soak the bullseye — first balloon to pop wins.',
    accent: '#2dd4bf',
    earns: true,
  },
  {
    to: '/arcade/pinball',
    icon: 'game.pinball',
    title: 'Pinball',
    blurb: 'Three balls, two flippers — light the lanes.',
    accent: '#d946ef',
    earns: true,
  },
];

export default function FunZone() {
  const navigate = useNavigate();
  // The 🎟️ hint only makes sense where the venue actually credits tickets — if
  // this location doesn't sell game rewards, no game pays out, so show nothing.
  const { gameRewards } = usePos();

  // Landing back on the hub means the player left whatever game they were in.
  // If they had armed a challenge round and backed out, disarm it here: a
  // challenge allows ONE round each, so a marker left lying around would spend
  // that attempt on the next casual game they happened to open.
  useEffect(() => {
    clearActiveChallenge();
  }, []);

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
                <Icon name={t.icon} />
              </span>
              <span className="block min-w-0 flex-1 text-sm font-bold leading-tight text-fairway-50">
                {t.title}
              </span>
              {gameRewards && t.earns && (
                <Icon name="award.ticket" label="Earns tickets" className="shrink-0 text-base" />
              )}
            </button>
          ))}
        </div>
      </Content>
    </Screen>
  );
}
