import { useEffect, useRef } from 'react';

// Full-screen canvas confetti "cannons". Two bursts fire up-and-inward from the
// bottom corners, then gravity takes over. Self-contained (no dependency).
//
// The confetti is a short (~2s), user-triggered celebration (finishing a round,
// landing on the leaderboard), so it plays for everyone rather than being gated
// behind prefers-reduced-motion — the ambient, always-on screen-entrance motion
// is what honors that setting (see index.css). Callers who never want it can
// simply pass `fire={false}`.

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  color: string;
  life: number; // frames remaining
};

const COLORS = ['#22c55e', '#f0fdf4', '#fbbf24', '#38bdf8', '#f472b6', '#a78bfa'];

// One cannon: `count` particles launched from (ox, oy) toward `angle` (radians,
// measured from +x, counter-clockwise) with some spread.
function cannon(count: number, ox: number, oy: number, angle: number): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.7;
    const speed = 9 + Math.random() * 9;
    const a = angle + spread;
    out.push({
      x: ox,
      y: oy,
      vx: Math.cos(a) * speed,
      vy: -Math.sin(a) * speed,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.4,
      size: 6 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 90 + Math.floor(Math.random() * 50),
    });
  }
  return out;
}

export default function Confetti({ fire = true }: { fire?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!fire) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = window.innerWidth;
    let H = window.innerHeight;
    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      // Recompute the ratio too: on an overscaled display (or when the window
      // moves to a monitor with a different scale) devicePixelRatio changes, and
      // a stale ratio would mis-scale the context and throw the burst off-screen.
      dpr = Math.min(2, window.devicePixelRatio || 1);
      // Buffer is sized in device pixels for crispness…
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      // …but <canvas> is a replaced element: with only `fixed inset-0` and no
      // explicit CSS size it renders at its INTRINSIC (buffer) size, so on a
      // high-DPI phone (devicePixelRatio ≥ 2 — every iPhone) it displayed at 2×
      // the viewport and the corner bursts fired off-screen. Pin the CSS size to
      // the viewport so display px stay decoupled from the buffer.
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Fire both cannons from just INSIDE the bottom corners, not the literal
    // corners: overscanned/overscaled screens (a TV on the /tv board, kiosk
    // displays) crop the edges, so launching from (0,H)/(W,H) puts the densest
    // burst in the cropped-off region and reads as "no confetti". Insetting keeps
    // the launch points on the visible panel.
    const mx = Math.round(W * 0.08); // horizontal inset from each side
    const my = Math.round(H * 0.04); // small lift off the very bottom edge
    let particles: Particle[] = [
      ...cannon(70, mx, H - my, Math.PI / 3), // bottom-left, up and to the right
      ...cannon(70, W - mx, H - my, (2 * Math.PI) / 3), // bottom-right, up and to the left
    ];
    const wave2 = window.setTimeout(() => {
      particles.push(
        ...cannon(45, mx, H - my, Math.PI / 2.6),
        ...cannon(45, W - mx, H - my, Math.PI - Math.PI / 2.6),
      );
    }, 350);

    const GRAVITY = 0.32;
    const DRAG = 0.99;
    let raf = 0;
    const frame = () => {
      ctx.clearRect(0, 0, W, H);
      particles = particles.filter((p) => p.life > 0 && p.y < H + 40);
      for (const p of particles) {
        p.vx *= DRAG;
        p.vy = p.vy * DRAG + GRAVITY;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        p.life -= 1;
        const alpha = Math.min(1, p.life / 30);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (particles.length > 0) {
        raf = requestAnimationFrame(frame);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(wave2);
      window.removeEventListener('resize', resize);
    };
  }, [fire]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-40"
      aria-hidden="true"
    />
  );
}
