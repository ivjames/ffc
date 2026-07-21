import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSkin, setSkin, subscribeSkin, SKINS } from '../lib/skin';
import { playClick } from '../lib/sound';

// Always-available theme (skin) picker. A palette pill in the bottom-left
// control cluster that opens a small menu of the selectable skins. Mirrors the
// pill styling of ThemeToggle/SoundToggle; the chosen skin persists (see
// src/lib/skin.ts) and re-skins the whole app via a `data-template` attribute.
export default function SkinPicker() {
  const skin = useSyncExternalStore(subscribeSkin, getSkin, getSkin);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Dismiss on outside tap or Escape while the menu is open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {open && (
        <div
          role="menu"
          aria-label="Theme"
          className="surface-1 absolute bottom-11 left-0 z-50 w-52 rounded-2xl border border-fairway-700/70 p-1"
        >
          {SKINS.map((s) => {
            const active = s.id === skin;
            return (
              <button
                key={s.id}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setSkin(s.id);
                  playClick();
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors active:bg-fairway-800/60 ${
                  active ? 'bg-fairway-800/50' : ''
                }`}
              >
                <span
                  className="h-4 w-4 flex-none rounded-full"
                  style={{ background: s.dot, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.5)' }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold leading-tight text-fairway-50">
                    {s.label}
                  </span>
                  <span className="block truncate text-[11px] text-fairway-300">{s.blurb}</span>
                </span>
                {active && (
                  <span className="flex-none text-sm text-fairway-100" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            );
          })}

          {/* Style-guide references: the live inventory plus the static artist
              docs (wireframe HTML + printable PDF, served from /docs). */}
          <div className="my-1 border-t border-fairway-700/60" />
          <button
            role="menuitem"
            onClick={() => {
              playClick();
              setOpen(false);
              navigate('/style');
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors active:bg-fairway-800/60"
          >
            <span
              className="flex h-4 w-4 flex-none items-center justify-center text-[11px] leading-none text-fairway-300"
              aria-hidden="true"
            >
              ▦
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold leading-tight text-fairway-50">Style guide</span>
              <span className="block truncate text-[11px] text-fairway-300">Every element, live</span>
            </span>
            <span className="flex-none text-fairway-400" aria-hidden="true">
              ›
            </span>
          </button>
          {/* Static artist deliverables — open in a new tab so the app stays put. */}
          {[
            { href: '/docs/style-guide.html', glyph: '❏', label: 'Style guide · HTML', blurb: 'Wireframes & element specs' },
            { href: '/docs/style-guide.pdf', glyph: '⤓', label: 'Style guide · PDF', blurb: 'Printable artist reference' },
          ].map((doc) => (
            <a
              key={doc.href}
              role="menuitem"
              href={doc.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                playClick();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors active:bg-fairway-800/60"
            >
              <span
                className="flex h-4 w-4 flex-none items-center justify-center text-[11px] leading-none text-fairway-300"
                aria-hidden="true"
              >
                {doc.glyph}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold leading-tight text-fairway-50">{doc.label}</span>
                <span className="block truncate text-[11px] text-fairway-300">{doc.blurb}</span>
              </span>
              <span className="flex-none text-fairway-400" aria-hidden="true">
                ↗
              </span>
            </a>
          ))}
        </div>
      )}
      <button
        onClick={() => {
          setOpen((o) => !o);
          playClick();
        }}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-fairway-800/70 bg-fairway-950/80 text-base text-fairway-100/80 backdrop-blur active:bg-fairway-800"
        aria-label="Choose a theme"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Theme"
      >
        🎨
      </button>
    </div>
  );
}
