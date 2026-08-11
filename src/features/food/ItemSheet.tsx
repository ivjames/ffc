import { useState } from 'react';
import { Button } from '../../ui/components';
import { formatCents } from '../../lib/pos/pricing';
import type { MenuItem } from '../../lib/pos/types';
import { addToCart } from '../../lib/foodCart';
import { playClick } from '../../lib/sound';

// Modifier picker for one menu item — a bottom sheet over the menu. Required
// single-select groups render as radio rows, optional groups as checkboxes
// bounded by maxSelect. Add is disabled until every required group is
// satisfied, so the server's validation should never fire for a UI-built cart.

export default function ItemSheet({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);

  function toggle(groupId: string, optionId: string) {
    playClick();
    const group = item.modifierGroups.find((g) => g.id === groupId)!;
    const next = new Set(chosen);
    if (group.maxSelect === 1) {
      // Radio semantics: picking one clears the group's other option.
      for (const o of group.options) next.delete(o.id);
      next.add(optionId);
    } else if (next.has(optionId)) {
      next.delete(optionId);
    } else if (group.options.filter((o) => next.has(o.id)).length < group.maxSelect) {
      next.add(optionId);
    }
    setChosen(next);
  }

  const satisfied = item.modifierGroups.every(
    (g) => !g.required || g.options.filter((o) => chosen.has(o.id)).length >= g.minSelect,
  );
  const modTotal = item.modifierGroups
    .flatMap((g) => g.options)
    .filter((o) => chosen.has(o.id))
    .reduce((sum, o) => sum + o.priceCents, 0);
  const lineTotal = (item.priceCents + modTotal) * quantity;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
        className="surface-1 max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-fairway-800/60 p-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-fairway-50">{item.name}</h2>
            <p className="text-sm text-fairway-100/70">{item.description}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="key flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-fairway-100"
          >
            ✕
          </button>
        </div>

        {item.modifierGroups.map((g) => (
          <div key={g.id} className="mt-3">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-sm font-bold text-fairway-50">{g.name}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fairway-400">
                {g.required ? 'required' : g.maxSelect > 1 ? `up to ${g.maxSelect}` : 'optional'}
              </span>
            </div>
            <div className="space-y-1.5">
              {g.options.map((o) => {
                const on = chosen.has(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggle(g.id, o.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition-transform active:translate-y-px ${
                      on
                        ? 'border-fairway-500 bg-fairway-800/50 font-bold text-fairway-50'
                        : 'surface-sunk border-fairway-800/60 text-fairway-100/80'
                    }`}
                  >
                    <span>{o.name}</span>
                    <span className="text-sm text-fairway-400">
                      {o.priceCents > 0 ? `+${formatCents(o.priceCents)}` : on ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-4 flex items-center justify-center gap-4">
          <button
            onClick={() => {
              playClick();
              setQuantity((q) => Math.max(1, q - 1));
            }}
            aria-label="Fewer"
            className="key flex h-11 w-11 items-center justify-center rounded-xl text-xl text-fairway-100"
          >
            −
          </button>
          <span className="w-8 text-center text-xl font-black text-fairway-50">{quantity}</span>
          <button
            onClick={() => {
              playClick();
              setQuantity((q) => Math.min(20, q + 1));
            }}
            aria-label="More"
            className="key flex h-11 w-11 items-center justify-center rounded-xl text-xl text-fairway-100"
          >
            +
          </button>
        </div>

        <div className="mt-4">
          <Button
            disabled={!satisfied}
            onClick={() => {
              addToCart({ menuItemId: item.id, quantity, modifierIds: [...chosen] });
              onClose();
            }}
          >
            Add to cart · {formatCents(lineTotal)}
          </Button>
          {!satisfied && (
            <p className="mt-2 text-center text-xs text-fairway-100/60">
              Choose the required options above first.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
