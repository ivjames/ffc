import { useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { TRIVIA, type TriviaQuestion } from '../../data/funContent';
import { playClick, playDing, playBuzz, playFanfare } from '../../lib/sound';

// §12 Trivia — a short multiple-choice round. Questions and their choices are
// shuffled per game; a tap locks in an answer, colors right/wrong, then advances
// to a final score. All bundled, so it plays offline.

const ROUND_SIZE = 10;

/** Fisher–Yates shuffle of a copy. */
function shuffled<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A question with its choices shuffled and the correct-choice index tracked. */
type ShuffledQuestion = {
  q: string;
  choices: string[];
  answer: number; // index into the shuffled `choices`
};

function buildRound(): ShuffledQuestion[] {
  return shuffled(TRIVIA)
    .slice(0, ROUND_SIZE)
    .map((item: TriviaQuestion) => {
      const correct = item.choices[item.answer];
      const choices = shuffled(item.choices);
      return { q: item.q, choices, answer: choices.indexOf(correct) };
    });
}

export default function Trivia() {
  const [round, setRound] = useState<ShuffledQuestion[]>(buildRound);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const current = round[index];

  const pick = (choice: number) => {
    if (picked !== null) return; // already answered this question
    const correct = choice === current.answer;
    setPicked(choice);
    if (correct) {
      setScore((s) => s + 1);
      playDing();
    } else {
      playBuzz();
    }
  };

  const advance = () => {
    if (index + 1 >= round.length) {
      playFanfare();
      setDone(true);
    } else {
      playClick();
      setIndex((i) => i + 1);
      setPicked(null);
    }
  };

  const restart = () => {
    playClick();
    setRound(buildRound());
    setIndex(0);
    setPicked(null);
    setScore(0);
    setDone(false);
  };

  if (done) {
    const pct = Math.round((score / round.length) * 100);
    const remark =
      pct === 100 ? 'Perfect score! 🏆' : pct >= 70 ? 'Nicely done! 🎉' : pct >= 40 ? 'Not bad! 👍' : 'Keep playing! 🎮';
    return (
      <Screen>
        <TopBar title="Trivia" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🧠</span>
            <div className="text-5xl font-black text-fairway-50">
              {score}
              <span className="text-2xl text-fairway-400"> / {round.length}</span>
            </div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
          </div>
          <div className="mt-8">
            <Button onClick={restart} sound="none">
              Play again
            </Button>
          </div>
        </Content>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="Trivia" back="/fun" />
      <Content>
        <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-fairway-400">
          <span>
            Question {index + 1} of {round.length}
          </span>
          <span>Score {score}</span>
        </div>

        <p key={index} className="animate-page-in mb-5 text-xl font-bold leading-snug text-fairway-50">
          {current.q}
        </p>

        <div className="space-y-2.5">
          {current.choices.map((choice, i) => {
            const answered = picked !== null;
            const isCorrect = i === current.answer;
            const isPicked = i === picked;

            // Default (unanswered) look uses the shared raised row material;
            // after answering, reveal the correct choice in green and a wrong
            // pick in red (flat feedback colors, not raised — these are no
            // longer tappable). Other options dim to a flat, inert disabled look.
            let cls = 'surface-1 border-fairway-800/60 text-fairway-50';
            if (answered && isCorrect) cls = 'border-green-500 bg-green-500/20 text-fairway-50';
            else if (answered && isPicked) cls = 'border-red-500 bg-red-500/20 text-fairway-50';
            else if (answered) cls = 'border-fairway-800 bg-fairway-900/30 text-fairway-100/50';

            return (
              <button
                key={i}
                onClick={() => pick(i)}
                disabled={answered}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-left text-base font-semibold transition-transform active:translate-y-px disabled:active:translate-y-0 ${cls}`}
              >
                <span>{choice}</span>
                {answered && isCorrect && <span aria-hidden>✓</span>}
                {answered && isPicked && !isCorrect && <span aria-hidden>✗</span>}
              </button>
            );
          })}
        </div>

        {picked !== null && (
          <div className="animate-page-in mt-5">
            <Button onClick={advance} sound="none">
              {index + 1 >= round.length ? 'See results' : 'Next question →'}
            </Button>
          </div>
        )}
      </Content>
    </Screen>
  );
}
