import { useState } from 'react';
import { useApiBuild } from './useApiBuild';

// Tiny build indicator so we can confirm which build the browser actually loaded
// (the service worker caches aggressively). Shows the client build baked in at
// build time, plus the API's build from /api/health, and flags a mismatch. The
// actionable prompt for a mismatch is the UpdateModal — both read the same
// key via useApiBuild.
//
// Tap it to copy the hashes (text selection is fiddly on mobile). The pill opts
// back into pointer events; the surrounding overlay stays pass-through so it
// never blocks a real control.
export function BuildStamp() {
  const apiBuild = useApiBuild();
  const [copied, setCopied] = useState(false);

  const mismatch = apiBuild != null && apiBuild !== __BUILD_ID__;
  const text = `build ${__BUILD_ID__}${apiBuild ? ` · api ${apiBuild}` : ''}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — the text is still selectable as a fallback */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`Built ${__BUILD_TIME__} — tap to copy build info`}
      className="pointer-events-auto max-w-full select-text truncate rounded bg-fairway-950/60 px-1.5 py-1 text-[10px] leading-none text-fairway-100/70 backdrop-blur-sm active:text-fairway-100/80"
    >
      {copied ? (
        'copied ✓'
      ) : (
        <>
          build {__BUILD_ID__}
          {apiBuild && <> · api {apiBuild}</>}
          {mismatch && <span className="text-amber-400/80"> (mismatch)</span>}
        </>
      )}
    </button>
  );
}
