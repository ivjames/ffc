import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from './components';
import { playClick } from '../lib/sound';
import {
  submitFeedback,
  getReviewerName,
  setReviewerName,
  MAX_FEEDBACK_CHARS,
} from '../lib/feedbackApi';

// Reviewer commentary widget — a pill in the bottom-right dev cluster that
// opens a note sheet for whoever is walking the app (staff, stakeholders,
// testers). The point of filing from *inside* the app is that the note arrives
// already attached to its screen: the current route, the build, and the device
// string ride along automatically (src/lib/feedbackApi.ts), so a reviewer
// types an opinion, not a bug report header.
//
// A screenshot is optional and comes from the device — the reviewer takes an
// OS screenshot (the one capture every phone does perfectly, including the
// native chrome an in-page renderer can't see) and attaches it here. It is
// downscaled on the phone like every other image this app uploads.
//
// Dev-mode-gated by the caller (src/App.tsx), alongside the skin picker and
// build stamp. Notes land in Master Control → Feedback.

const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024;

type Phase = 'writing' | 'sending' | 'sent';

function NoteSheet({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation();
  const [body, setBody] = useState('');
  const [reviewer, setReviewer] = useState(getReviewerName);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('writing');
  const [error, setError] = useState<string | null>(null);
  const [droppedShot, setDroppedShot] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // The route is captured when the sheet opens, not when Send is tapped — the
  // reviewer is commenting on the screen behind the sheet, and that's the one
  // that must be recorded even if something navigates underneath.
  const screenPath = useRef(pathname).current;

  // Close on Escape, matching the app's other dismissible overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Object URLs are revoked whenever the chosen file changes and on unmount,
  // so a reviewer swapping screenshots mid-note doesn't leak blobs.
  useEffect(() => {
    if (!screenshot) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  function pickScreenshot(file: File | null) {
    setError(null);
    if (file && file.size > MAX_SCREENSHOT_BYTES) {
      setError('That screenshot is too large — try a smaller one.');
      // Drop whatever was attached before, rather than silently keeping it:
      // the file input now shows the rejected file's name, so leaving the old
      // one staged would send evidence the reviewer thinks they replaced.
      clearScreenshot();
      return;
    }
    setScreenshot(file);
  }

  function clearScreenshot() {
    setScreenshot(null);
    // Reset the input too, so re-picking the SAME file still fires a change.
    if (fileRef.current) fileRef.current.value = '';
  }

  async function send() {
    if (!body.trim()) return;
    setPhase('sending');
    setError(null);
    try {
      const result = await submitFeedback({
        body: body.trim(),
        screenPath,
        reviewer: reviewer.trim(),
        screenshot,
      });
      setReviewerName(reviewer);
      setDroppedShot(Boolean(result.screenshotDropped));
      setPhase('sent');
    } catch (err) {
      setError((err as Error).message);
      setPhase('writing');
    }
  }

  const remaining = MAX_FEEDBACK_CHARS - body.length;

  // The sheet's `pointer-events-auto` is load-bearing, not decoration: App
  // mounts the pill inside a pass-through overlay (pointer-events-none) so the
  // fixed corner never eats a tap meant for the screen underneath. This sheet
  // renders inside that overlay, so without opting back in it would paint
  // perfectly and ignore every tap. Keeping the opt-in on the sheet itself
  // (rather than relying on its mount point) makes the widget self-contained.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-sheet-title"
      className="pointer-events-auto fixed inset-0 z-[100] flex items-end justify-center bg-fairway-950/80 p-3 backdrop-blur-sm sm:items-center"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-fairway-700 bg-fairway-900 p-5 shadow-2xl"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        {phase === 'sent' ? (
          <>
            <h2 id="feedback-sheet-title" className="text-lg font-black text-fairway-50">
              Thanks — noted ✓
            </h2>
            <p className="mt-2 text-sm text-fairway-100/70">
              Your comment is in Master Control, filed against{' '}
              <code className="text-fairway-100">{screenPath}</code>.
              {droppedShot && ' The screenshot could not be stored (storage is full), but your comment landed.'}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setBody('');
                  setScreenshot(null);
                  setDroppedShot(false);
                  setPhase('writing');
                }}
              >
                Another note
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        ) : (
          <>
            <h2 id="feedback-sheet-title" className="text-lg font-black text-fairway-50">
              Leave a note
            </h2>
            <p className="mt-1 text-xs text-fairway-100/60">
              About this screen: <code className="text-fairway-100/80">{screenPath}</code>
            </p>

            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-fairway-100/70">
                What's on your mind?
              </span>
              <textarea
                autoFocus
                rows={5}
                value={body}
                maxLength={MAX_FEEDBACK_CHARS}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What works, what doesn't, what's confusing…"
                className="w-full rounded-xl border border-fairway-700 bg-fairway-950/60 px-3 py-2 text-base text-fairway-50 outline-none placeholder:text-fairway-100/30 focus:border-fairway-500"
              />
            </label>
            <div className="mt-1 text-right text-[10px] text-fairway-100/40">
              {remaining} characters left
            </div>

            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-fairway-100/70">
                Your name <span className="font-normal normal-case">(optional)</span>
              </span>
              <input
                type="text"
                value={reviewer}
                maxLength={80}
                onChange={(e) => setReviewer(e.target.value)}
                placeholder="So we know who to ask"
                className="w-full rounded-xl border border-fairway-700 bg-fairway-950/60 px-3 py-2 text-base text-fairway-50 outline-none placeholder:text-fairway-100/30 focus:border-fairway-500"
              />
            </label>

            <div className="mt-3">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-fairway-100/70">
                Screenshot <span className="font-normal normal-case">(optional)</span>
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                aria-label="Attach a screenshot"
                onChange={(e) => pickScreenshot(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-fairway-100/70 file:mr-3 file:rounded-lg file:border-0 file:bg-fairway-800 file:px-3 file:py-2 file:text-xs file:font-bold file:text-fairway-50"
              />
              {previewUrl && (
                <div className="mt-2 flex items-center gap-3">
                  <img
                    src={previewUrl}
                    alt="Screenshot to attach"
                    className="h-20 w-20 rounded-lg border border-fairway-700 object-cover"
                  />
                  <button
                    type="button"
                    className="text-xs text-fairway-100/70 underline"
                    onClick={clearScreenshot}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-danger/20 px-3 py-2 text-xs text-fairway-50">
                {error}
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={onClose} disabled={phase === 'sending'}>
                Cancel
              </Button>
              <Button onClick={() => void send()} disabled={phase === 'sending' || !body.trim()}>
                {phase === 'sending' ? 'Sending…' : 'Send note'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          playClick();
          setOpen(true);
        }}
        className="surface-1 pointer-events-auto rounded-full border border-fairway-700/70 px-3 py-1.5 text-xs font-bold text-fairway-50 active:translate-y-px"
      >
        💬 Feedback
      </button>
      {open && <NoteSheet onClose={() => setOpen(false)} />}
    </>
  );
}
