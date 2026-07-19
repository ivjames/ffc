import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { CHALLENGES } from '../../data/funContent';
import { playClick, playTick, playLand } from '../../lib/sound';

// §12 Challenge Spinner — a wheel of quick group dares. Tap to spin; the wheel
// decelerates onto a random challenge (ticking as it passes each peg) and shows
// the result. Bundled content, no network.

const N = CHALLENGES.length;
const SECTOR = 360 / N; // degrees per wedge

// Wheel geometry (SVG user units); the viewBox is square so it scales cleanly.
const CX = 100;
const CY = 100;
const R = 94;

// Spin timing — must match the CSS transition below (duration + easing) so the
// tick track lines up peg-for-peg with the actual rotation.
const SPIN_MS = 4000;
// cubic-bezier(0.17, 0.67, 0.14, 0.99) — x = time, y = progress.
const [BX1, BY1, BX2, BY2] = [0.17, 0.67, 0.14, 0.99];

// One coordinate of a cubic Bézier at parameter s (control points 0 and 1 are
// the fixed 0/1 endpoints, so only the two middle controls appear).
function bezierAxis(s: number, p1: number, p2: number): number {
  const ms = 1 - s;
  return 3 * ms * ms * s * p1 + 3 * ms * s * s * p2 + s * s * s;
}

/**
 * For a CSS easing curve, map an output progress fraction back to the time
 * fraction at which the animation reaches it. The curve's y (progress) is
 * monotonic for these controls, so bisect on the parameter to invert it, then
 * read off x (time).
 */
function timeAtProgress(progress: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bezierAxis(mid, BY1, BY2) < progress) lo = mid;
    else hi = mid;
  }
  return bezierAxis((lo + hi) / 2, BX1, BX2);
}

// Alternating wedge fills — a bright arcade ribbon, cycled around the wheel.
const WEDGE_COLORS = ['#f59e0b', '#3b82f6', '#ec4899', '#22c55e', '#a855f7', '#ef4444', '#14b8a6'];

/** Point on the wheel at `angle` degrees clockwise from the top (12 o'clock). */
function pointAt(angle: number, radius: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
}

/** SVG path for the pie wedge covering sector `i`. */
function wedgePath(i: number): string {
  const [x0, y0] = pointAt(i * SECTOR, R);
  const [x1, y1] = pointAt((i + 1) * SECTOR, R);
  // SECTOR < 180 so large-arc is always 0; sweep 1 draws clockwise.
  return `M ${CX} ${CY} L ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1} Z`;
}

export default function Spinner() {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const targetRef = useRef<number | null>(null);
  const timers = useRef<number[]>([]);

  // Return to wherever the spinner was opened from (a scorecard's toolbar);
  // fall back to Home when opened directly.
  const location = useLocation();
  const backTo = (location.state as { from?: string } | null)?.from ?? '/';

  // Clear any pending tick timers on unmount so no stray sound fires later.
  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout);
    };
  }, []);

  const spin = () => {
    if (spinning) return;
    playClick();
    setResult(null);
    setSpinning(true);

    const target = Math.floor(Math.random() * N);
    targetRef.current = target;

    // Land the target wedge's center under the top pointer: rotating the wheel
    // by R puts the wedge whose center is at (360 − R) mod 360 at the top.
    const center = (target + 0.5) * SECTOR;
    const desiredMod = ((-center) % 360 + 360) % 360;
    const currentMod = ((rotation % 360) + 360) % 360;
    let delta = desiredMod - currentMod;
    if (delta < 0) delta += 360;
    const travel = 5 * 360 + delta; // total degrees this spin sweeps
    setRotation((r) => r + travel);

    // Tick once per peg as it actually passes the pointer. A peg boundary sits
    // every SECTOR degrees; for each one the wheel crosses, invert the easing
    // curve to find WHEN that crossing happens, so the clicks track the real
    // rotation speed — dense at the fast start, spreading out as it settles.
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const pegs = Math.floor(travel / SECTOR);
    for (let k = 1; k <= pegs; k++) {
      const when = timeAtProgress((k * SECTOR) / travel) * SPIN_MS;
      const id = window.setTimeout(playTick, when);
      timers.current.push(id);
    }
  };

  const onSpinEnd = () => {
    if (targetRef.current === null) return;
    setSpinning(false);
    setResult(targetRef.current);
    playLand();
  };

  const chosen = result !== null ? CHALLENGES[result] : null;

  return (
    <Screen>
      <TopBar title="Challenge Spinner" back={backTo} />
      <Content>
        <div className="relative mx-auto mb-6 w-full max-w-xs">
          {/* Fixed pointer at the top, dipping into the wheel. */}
          <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1 text-3xl drop-shadow">
            🔻
          </div>

          <svg viewBox="0 0 200 200" className="w-full drop-shadow-xl" role="img" aria-label="Challenge wheel">
            <g
              style={{
                transform: `rotate(${rotation}deg)`,
                // Rotate about the group's own center. `fill-box` + `center` is
                // self-relative and well-supported (incl. iOS WebKit), unlike a
                // pixel transform-origin on an SVG <g>, whose reference box
                // differs across engines.
                transformBox: 'fill-box',
                transformOrigin: 'center',
                transition: spinning ? 'transform 4s cubic-bezier(0.17, 0.67, 0.14, 0.99)' : 'none',
              }}
              onTransitionEnd={onSpinEnd}
            >
              {CHALLENGES.map((c, i) => {
                const center = (i + 0.5) * SECTOR;
                const [ex, ey] = pointAt(center, R * 0.66);
                return (
                  <g key={i}>
                    <path d={wedgePath(i)} fill={WEDGE_COLORS[i % WEDGE_COLORS.length]} stroke="#0b0f14" strokeWidth={0.8} />
                    {/* Orient each emoji radially with its base toward the hub,
                        so when its wedge lands under the top pointer the emoji
                        stands upright. */}
                    <text
                      x={ex}
                      y={ey}
                      fontSize={13}
                      textAnchor="middle"
                      dominantBaseline="central"
                      transform={`rotate(${center} ${ex} ${ey})`}
                    >
                      {c.emoji}
                    </text>
                  </g>
                );
              })}
              {/* Hub cap. */}
              <circle cx={CX} cy={CY} r={12} fill="#0b0f14" stroke="#334155" strokeWidth={1.5} />
            </g>
          </svg>
        </div>

        {chosen ? (
          <div className="animate-result-swell mb-5 rounded-2xl border border-fairway-700 bg-fairway-900/50 px-5 py-5 text-center">
            <div className="text-4xl">{chosen.emoji}</div>
            <p className="mt-2 text-lg font-semibold leading-snug text-fairway-50">{chosen.text}</p>
          </div>
        ) : (
          <p className="mb-5 text-center text-sm text-fairway-100/70">
            {spinning ? 'Round and round…' : 'Tap spin for a challenge!'}
          </p>
        )}

        <Button onClick={spin} disabled={spinning} sound="none">
          {spinning ? 'Spinning…' : chosen ? 'Spin again' : 'Spin the wheel'}
        </Button>
      </Content>
    </Screen>
  );
}
