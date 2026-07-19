import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { playClick, playStroke, playUndo, playCup } from '../lib/sound';

// Map a button's declared sound to its player. 'none' skips audio entirely
// (for buttons that trigger their own effect elsewhere).
const SOUNDS = {
  click: playClick,
  stroke: playStroke,
  undo: playUndo,
  cup: playCup,
  none: () => {},
} as const;

export type ButtonSound = keyof typeof SOUNDS;

// Small shared UI kit. Touch-first: large tap targets, high contrast for
// outdoor sunlight (§5.1).

export function Screen({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-full w-full max-w-md flex-col">{children}</div>;
}

export function TopBar({
  title,
  back,
  right,
}: {
  title: string;
  back?: string | number;
  right?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    // Sticky, but pinned to the safe-area top rather than the raw viewport edge.
    // With `top-0` the bar slid up behind the iPhone status bar / camera on
    // scroll; offsetting by env(safe-area-inset-top) locks it just below the
    // notch. The area above stays covered by the body's safe-area padding.
    <header
      style={{
        top: 'env(safe-area-inset-top)',
        backgroundImage:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-fairway-900), transparent 12%), color-mix(in srgb, var(--color-fairway-950), transparent 12%))',
        boxShadow: '0 2px 12px -2px rgba(0,0,0,0.35), var(--bevel)',
      }}
      className="sticky z-10 flex items-center gap-2 border-b border-fairway-800/60 px-3 py-3 backdrop-blur"
    >
      {back !== undefined && (
        <button
          onClick={() => (typeof back === 'number' ? navigate(back) : navigate(back))}
          className="key flex h-10 w-10 items-center justify-center rounded-xl text-fairway-100"
          aria-label="Back"
        >
          <span className="text-2xl leading-none">‹</span>
        </button>
      )}
      <h1 className="flex-1 truncate text-lg font-black tracking-tight text-fairway-50">{title}</h1>
      {right}
    </header>
  );
}

export function Content({ children }: { children: ReactNode }) {
  return <main className="animate-page-in flex-1 px-4 py-4">{children}</main>;
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  className?: string;
  /** Which UI sound to play on press. Defaults to a mild click. */
  sound?: ButtonSound;
};

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
  className = '',
  sound = 'click',
}: ButtonProps) {
  // Chunky, physical keys. The primary/danger variants carry their own 3D lip
  // and depress on press (translateY, driven by `.btn-accent`/`.btn-danger` in
  // index.css); the ghost variant is a subtler raised surface that dips a pixel.
  // Extra bottom padding leaves room for each key's lip so the label stays
  // centered in the visible face.
  const base =
    'flex w-full items-center justify-center rounded-2xl px-4 pb-4 pt-3.5 text-base font-bold transition disabled:opacity-40 disabled:shadow-none disabled:active:translate-y-0';
  const variants = {
    // The primary action also catches a one-shot light sweep on mount (btn-sheen)
    // so it reads as the lit, tappable "candy" element on the screen.
    primary: 'btn-accent btn-sheen text-fairway-50',
    ghost:
      'surface-1 border border-fairway-700/70 text-fairway-50 transition-transform active:translate-y-px active:brightness-95',
    danger: 'btn-danger text-white',
  };
  return (
    <button
      type={type}
      onClick={() => {
        SOUNDS[sound]();
        onClick?.();
      }}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Arcade-style 3-char tag chip. The material lives in `.tag-chip` (index.css)
 *  so each visual template can reskin it; the course accent (or the house green
 *  default) is passed in as `--tag-accent`. Candy paints it as a glossy pill. */
export function TagChip({ tag, color }: { tag: string; color?: string }) {
  return (
    <span
      className="tag-chip font-arcade inline-flex items-center rounded-lg px-2.5 py-1 text-lg font-bold"
      style={{ '--tag-accent': color ?? '#166534' } as CSSProperties}
    >
      {tag || '···'}
    </span>
  );
}
