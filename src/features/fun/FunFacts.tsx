import { useMemo, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { FUN_FACTS } from '../../data/funContent';
import { playClick } from '../../lib/sound';

// §12 Fun Facts — flip through a shuffled deck of bite-size facts, one at a
// time. Purely client-side; the deck is bundled so it works offline.

/** Fisher–Yates shuffle of a copy — used to randomize the deck order once. */
function shuffled<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function FunFacts() {
  // Shuffle once per visit so the deck feels fresh but is stable while browsing.
  const deck = useMemo(() => shuffled(FUN_FACTS), []);
  const [pos, setPos] = useState(0);
  const fact = deck[pos];

  const next = () => {
    playClick();
    setPos((p) => (p + 1) % deck.length);
  };

  return (
    <Screen>
      <TopBar title="Fun Facts" back="/fun" />
      <Content>
        {/* Tapping the card advances too, so the whole surface is the control. */}
        <button
          key={pos}
          onClick={next}
          className="animate-score-pop mb-6 flex min-h-[16rem] w-full flex-col items-center justify-center gap-4 rounded-3xl border border-fairway-700 bg-fairway-900/50 px-6 py-8 text-center active:scale-[0.99]"
        >
          <span className="text-6xl">{fact.emoji}</span>
          <p className="text-lg font-semibold leading-snug text-fairway-50">{fact.text}</p>
        </button>

        <Button onClick={next} sound="none">
          Next fact →
        </Button>
      </Content>
    </Screen>
  );
}
