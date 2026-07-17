import { useEffect, useMemo, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { PUZZLES, scoreLabel } from './puzzles';
import { runGolf, type RunResult } from './runner';

// §Extra — "JS Golf": a code-golf minigame for the clubhouse queue. Write the
// shortest JavaScript function that clears every test. Your character count is
// your stroke count; beat par for a birdie. Fully offline — puzzles are
// bundled, code runs in a Web Worker, best scores live in localStorage.

const BEST_KEY = 'jsgolf.best.v1';
const codeKey = (id: string) => `jsgolf.code.${id}`;

type BestMap = Record<string, number>;

function loadBest(): BestMap {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as BestMap;
  } catch {
    return {};
  }
}

/** Characters that count toward the stroke total (leading/trailing space free). */
function strokes(code: string): number {
  return code.trim().length;
}

export default function JsGolf() {
  const [idx, setIdx] = useState(0);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [best, setBest] = useState<BestMap>(() => loadBest());

  const puzzle = PUZZLES[idx];

  // Load this hole's saved draft when we switch holes; clear stale results.
  useEffect(() => {
    setCode(localStorage.getItem(codeKey(puzzle.id)) ?? '');
    setResult(null);
    setRunning(false);
  }, [puzzle.id]);

  // Persist the draft as the player types — offline-first, survives a refresh.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(codeKey(puzzle.id), code);
      } catch {
        /* storage full / disabled — draft just won't persist */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [code, puzzle.id]);

  const s = strokes(code);
  const solved = result?.kind === 'ok' && result.passed === puzzle.tests.length;

  async function onRun() {
    setRunning(true);
    setResult(null);
    const r = await runGolf(code, puzzle.tests);
    setResult(r);
    setRunning(false);

    if (r.kind === 'ok' && r.passed === puzzle.tests.length) {
      const prev = best[puzzle.id];
      if (prev === undefined || s < prev) {
        const next = { ...best, [puzzle.id]: s };
        setBest(next);
        try {
          localStorage.setItem(BEST_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Clubhouse scorecard: total best strokes vs par over the holes played.
  const card = useMemo(() => {
    let played = 0;
    let totalStrokes = 0;
    let totalPar = 0;
    for (const p of PUZZLES) {
      if (best[p.id] !== undefined) {
        played += 1;
        totalStrokes += best[p.id];
        totalPar += p.par;
      }
    }
    return { played, totalStrokes, totalPar };
  }, [best]);

  return (
    <Screen>
      <TopBar title="JS Golf" back="/" />
      <Content>
        <p className="mb-4 text-sm text-fairway-100/70">
          Write the shortest JavaScript function that clears every test. Characters are strokes —
          beat <span className="font-semibold text-fairway-300">par</span> for a birdie.
        </p>

        {/* Hole picker — the front nine (well, eight). */}
        <div className="mb-4 flex flex-wrap gap-2">
          {PUZZLES.map((p, i) => {
            const b = best[p.id];
            const active = i === idx;
            return (
              <button
                key={p.id}
                onClick={() => setIdx(i)}
                className={`flex h-10 w-10 flex-col items-center justify-center rounded-lg text-sm font-bold transition ${
                  active
                    ? 'bg-fairway-500 text-fairway-950'
                    : b !== undefined
                      ? 'border border-fairway-500/50 bg-fairway-900/60 text-fairway-200'
                      : 'border border-fairway-800 bg-fairway-900/40 text-fairway-400'
                }`}
                aria-label={`Hole ${i + 1}${b !== undefined ? `, best ${b}` : ''}`}
              >
                {i + 1}
                {b !== undefined && <span className="text-[9px] leading-none">✓</span>}
              </button>
            );
          })}
        </div>

        {/* Current hole */}
        <div className="rounded-2xl border border-fairway-800 bg-fairway-900/40 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold text-fairway-50">
              <span className="text-fairway-500">Hole {idx + 1}.</span> {puzzle.title}
            </h2>
            <span className="shrink-0 rounded-md bg-fairway-950/60 px-2 py-1 text-xs font-semibold text-fairway-300">
              Par {puzzle.par}
            </span>
          </div>
          <p className="mt-2 text-sm text-fairway-100/80">{puzzle.brief}</p>
          <p className="mt-1 font-mono text-xs text-fairway-400">signature: {puzzle.hint}</p>

          {/* Editor */}
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            rows={3}
            placeholder={puzzle.hint}
            className="mt-3 w-full resize-y rounded-xl border border-fairway-700 bg-fairway-950/70 p-3 font-mono text-sm text-fairway-50 outline-none focus:border-fairway-500"
          />

          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="font-mono text-fairway-300">
              {s} {s === 1 ? 'stroke' : 'strokes'}
              <span className="text-fairway-500"> · par {puzzle.par}</span>
            </span>
            {best[puzzle.id] !== undefined && (
              <span className="font-mono text-fairway-400">best {best[puzzle.id]}</span>
            )}
          </div>

          <div className="mt-3">
            <Button onClick={onRun} disabled={running || s === 0}>
              {running ? 'Running…' : 'Run tests'}
            </Button>
          </div>
        </div>

        {/* Result panel */}
        {result && (
          <ResultPanel result={result} puzzle={puzzle} strokes={s} solved={!!solved} />
        )}

        {/* Running scorecard */}
        {card.played > 0 && (
          <div className="mt-6 rounded-2xl border border-fairway-800 bg-fairway-900/40 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">
              Your card
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-fairway-100/80">
                {card.played} of {PUZZLES.length} holes cleared
              </span>
              <span className="font-mono text-lg font-bold text-fairway-50">
                {card.totalStrokes}
                <span className="text-fairway-500"> / par {card.totalPar}</span>
              </span>
            </div>
            <div className="mt-1 text-sm font-semibold" style={toParStyle(card.totalStrokes - card.totalPar)}>
              {toParText(card.totalStrokes - card.totalPar)}
            </div>
          </div>
        )}
      </Content>
    </Screen>
  );
}

function ResultPanel({
  result,
  puzzle,
  strokes: s,
  solved,
}: {
  result: RunResult;
  puzzle: (typeof PUZZLES)[number];
  strokes: number;
  solved: boolean;
}) {
  if (result.kind === 'timeout') {
    return (
      <Banner tone="bad">
        ⏱️ Timed out — an infinite loop? The runner stopped it after a second.
      </Banner>
    );
  }
  if (result.kind === 'compile-error') {
    return <Banner tone="bad">🚫 {result.message}</Banner>;
  }

  const total = puzzle.tests.length;
  const score = scoreLabel(s, puzzle.par);

  return (
    <div className="mt-4">
      {solved ? (
        <Banner tone="good">
          {score.emoji} All {total} tests pass — {score.label} at {s} strokes (par {puzzle.par}).
        </Banner>
      ) : (
        <Banner tone="warn">
          {result.passed} of {total} tests pass. Keep swinging.
        </Banner>
      )}

      <ul className="mt-3 space-y-2">
        {result.results.map((r, i) => {
          const t = puzzle.tests[i];
          return (
            <li
              key={i}
              className={`rounded-xl border p-3 font-mono text-xs ${
                r.pass
                  ? 'border-fairway-600/40 bg-fairway-900/40 text-fairway-200'
                  : 'border-red-500/40 bg-red-950/30 text-red-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{r.pass ? '✅' : '❌'}</span>
                <span className="text-fairway-400">f({fmtArgs(t.args)})</span>
              </div>
              {!r.pass && (
                <div className="mt-1 pl-6 text-fairway-300/80">
                  {r.error ? (
                    <span className="text-red-300">threw: {r.error}</span>
                  ) : (
                    <>
                      got <span className="text-red-300">{r.got}</span>, want{' '}
                      <span className="text-fairway-200">{fmtVal(t.expect)}</span>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: React.ReactNode }) {
  const styles = {
    good: 'border-fairway-500/50 bg-fairway-500/15 text-fairway-100',
    warn: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    bad: 'border-red-500/40 bg-red-500/10 text-red-100',
  }[tone];
  return (
    <div className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${styles}`}>
      {children}
    </div>
  );
}

// --- display helpers -------------------------------------------------------

function fmtVal(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === undefined) return 'undefined';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function fmtArgs(args: unknown[]): string {
  return args.map(fmtVal).join(', ');
}

function toParText(diff: number): string {
  if (diff === 0) return 'Even par ⛳️';
  if (diff < 0) return `${Math.abs(diff)} under par 🔥`;
  return `${diff} over par`;
}

function toParStyle(diff: number): React.CSSProperties {
  if (diff < 0) return { color: '#4ade80' };
  if (diff > 0) return { color: '#fca5a5' };
  return { color: '#e2e8f0' };
}
