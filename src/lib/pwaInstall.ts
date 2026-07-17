import { useEffect, useState } from 'react';

// PWA install support (§ install page). The tricky bit: Chrome/Edge fire the
// `beforeinstallprompt` event exactly once, early in page load — often before
// any React component has mounted. If we only listened from inside a component
// we'd miss it and the install button would never light up. So we capture the
// event at module load (see initInstallCapture, called from main.tsx) and stash
// it; the hook below reads the stashed value and subscribes to changes.

// Minimal typing for the non-standard event (not in lib.dom yet).
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/**
 * Wire up the global capture. Call once at app boot, before React renders, so
 * we never miss the one-shot `beforeinstallprompt`. Safe to call in non-browser
 * contexts (SSR/tests) — it no-ops without a window.
 */
export function initInstallCapture(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    // Stop Chrome's default mini-infobar so *our* button is the only entry
    // point, then keep the event so we can fire it on demand.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });

  // Once installed, the prompt is spent — clear it so the UI flips to "done".
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export type Platform = 'ios' | 'android' | 'desktop' | 'other';

/** Best-effort platform sniff — only used to pick which instructions to show. */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports as desktop Safari, so also treat touch-capable Macs as iOS.
  const iOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
  if (iOS) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/mobile/i.test(ua)) return 'other';
  return 'desktop';
}

/** True when the app is already running as an installed PWA. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari uses the non-standard navigator.standalone; everyone else the
  // display-mode media query.
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

export interface InstallState {
  platform: Platform;
  /** Already installed / running standalone. */
  installed: boolean;
  /** A native install prompt is available (Chrome/Edge on Android & desktop). */
  canPrompt: boolean;
  /** Fire the native prompt. Returns the user's choice, or null if unavailable. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | null>;
}

export function useInstallPrompt(): InstallState {
  const [canPrompt, setCanPrompt] = useState(deferredPrompt !== null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const update = () => {
      setCanPrompt(deferredPrompt !== null);
      setInstalled(isStandalone());
    };
    listeners.add(update);
    // Reflect any state that changed between render and effect (e.g. the event
    // fired in the gap).
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);

  const promptInstall = async (): Promise<'accepted' | 'dismissed' | null> => {
    const evt = deferredPrompt;
    if (!evt) return null;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    // The event can only be used once.
    deferredPrompt = null;
    notify();
    return outcome;
  };

  return { platform: detectPlatform(), installed, canPrompt, promptInstall };
}
