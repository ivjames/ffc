import type { ReactNode } from 'react';
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
      style={{ top: 'env(safe-area-inset-top)' }}
      className="sticky z-10 flex items-center gap-2 border-b border-fairway-800/60 bg-fairway-950/90 px-3 py-3 backdrop-blur"
    >
      {back !== undefined && (
        <button
          onClick={() => (typeof back === 'number' ? navigate(back) : navigate(back))}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-fairway-100 active:bg-fairway-800"
          aria-label="Back"
        >
          <span className="text-2xl leading-none">‹</span>
        </button>
      )}
      <h1 className="flex-1 truncate text-lg font-bold text-fairway-50">{title}</h1>
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
  // A springy press: the button dips a bit further on tap and rides back on a
  // slight overshoot ease, so every press feels physical. `duration-150` keeps
  // the rebound quick enough not to lag the tap.
  const base =
    'flex w-full items-center justify-center rounded-xl px-4 py-3 text-base font-semibold transition duration-150 ease-[cubic-bezier(0.22,1.4,0.36,1)] active:scale-[0.96] disabled:opacity-40 disabled:active:scale-100';
  const variants = {
    // The primary action also catches a one-shot light sweep on mount (btn-sheen)
    // so it reads as the lit, tappable "candy" element on the screen.
    primary: 'btn-accent btn-sheen text-fairway-50',
    ghost: 'border border-fairway-700 bg-fairway-900/40 text-fairway-50 active:bg-fairway-800',
    danger: 'bg-red-500/90 text-white active:bg-red-500',
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

/** Arcade-style 3-char tag chip. A glossy top highlight + soft drop give it a
 *  tactile, candy-button read against the neutral chrome. */
export function TagChip({ tag, color }: { tag: string; color?: string }) {
  return (
    <span
      className="font-arcade inline-flex items-center rounded-md px-2 py-1 text-lg font-bold"
      style={{
        background: color ?? '#166534',
        color: '#f0fdf4',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 4px rgba(0,0,0,0.22), 0 1px 2px rgba(0,0,0,0.25)',
        textShadow: '0 1px 1px rgba(0,0,0,0.35)',
      }}
    >
      {tag || '···'}
    </span>
  );
}
