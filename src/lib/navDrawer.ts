// Global navigation-drawer open/close state.
//
// The app has no persistent nav bar; the slide-out drawer (src/ui/NavDrawer.tsx)
// is the one always-reachable way to jump between the top-level sections
// (Home / Golf / Arcade / Food / Me). Its open/closed state is a tiny external
// store — the same useSyncExternalStore pattern the app uses for skin, mode,
// location, etc. — so the hamburger (src/ui/MenuButton.tsx, riding in every
// screen's HeaderControls) and the drawer overlay (mounted once in App) can
// share it without threading props or a context provider through the tree.

import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function openNav(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeNav(): void {
  if (!open) return;
  open = false;
  emit();
}

export function toggleNav(): void {
  open = !open;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): boolean {
  return open;
}

/** Reactive drawer-open flag. */
export function useNavDrawer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
