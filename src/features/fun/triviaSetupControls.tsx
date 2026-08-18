import { playClick } from '../../lib/sound';

// The little pieces of a trivia setup form, shared by the staff host screen
// (TriviaHost) and the player-start screen (TriviaStart) so the two ways of
// making a game look like the same game.

export function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fairway-400">
        {label}
      </p>
      {children}
    </div>
  );
}

export function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => {
        playClick();
        onClick();
      }}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        on ? 'bg-fairway-400 text-fairway-950' : 'border border-fairway-800 text-fairway-100/70'
      }`}
    >
      {children}
    </button>
  );
}
