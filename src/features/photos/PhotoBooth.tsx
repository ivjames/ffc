import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { loadImage, blobToBase64 } from '../../lib/image';
import { useCurrentLocationId } from '../../lib/location';
import {
  fetchBoothPhotos,
  uploadBoothPhoto,
  deleteBoothPhoto,
  shareBoothPhoto,
  shareEditedPhoto,
  boothPhotoUrl,
  type BoothPhoto,
} from './api';

// Photo booth — snap a photo, slap stickers on it, keep it in the group's
// camera roll, share it. The whole pipeline is AI-free (nothing is verified or
// judged, unlike the hunt): stickers are emoji composited onto the photo
// RIGHT HERE on the phone — dragged around as DOM elements while editing, then
// flattened into a single JPEG on a canvas — so the server only ever sees and
// stores the finished picture. Sharing is the Web Share API straight from the
// editor (works offline) or from the stored gallery.
//
// The gallery is keyed by an unguessable per-device booth id (api.ts), not a
// round or an account — the booth works before, during, and after a game.

// The sticker sheet. Emoji, not image assets: nothing to precache into the PWA
// bundle, free color rendering on canvas, and endless variety is one edit away.
const STICKER_SHEET = [
  '😎', '🤩', '😂', '🥳', '😜', '🤠', '👑', '🕶️',
  '🎉', '🎈', '⭐', '🌈', '🔥', '💯', '⚡', '💥',
  '❤️', '🫶', '👍', '✌️', '💪', '🏆', '⛳', '🏌️',
  '🌵', '🦖', '🏰', '🤖', '🍦', '🍕', '🌭', '🎪',
];

// A placed sticker. x/y are the sticker's CENTER as fractions of the photo box
// (0..1), so placement survives both screen rotation and the export upscale;
// scale multiplies the base size (22% of the photo's width); rot is degrees.
type Sticker = {
  id: number;
  emoji: string;
  x: number;
  y: number;
  scale: number;
  rot: number;
};

// Base sticker size as a fraction of the photo's width — same constant drives
// the on-screen preview and the canvas export, so what you see is what bakes.
const STICKER_BASE = 0.22;
// Long-edge cap for the exported JPEG, matching the hunt's upload ceiling.
const EXPORT_MAX_DIM = 1280;

type Editor = {
  /** Object URL of the picked photo, alive for the whole editing session. */
  url: string;
  img: HTMLImageElement;
};

function flattenToJpeg(editor: Editor, stickers: Sticker[]): Promise<Blob> {
  const { img } = editor;
  const s = Math.min(1, EXPORT_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas is unavailable'));
  ctx.drawImage(img, 0, 0, w, h);
  for (const st of stickers) {
    ctx.save();
    ctx.translate(st.x * w, st.y * h);
    ctx.rotate((st.rot * Math.PI) / 180);
    ctx.font = `${Math.round(STICKER_BASE * w * st.scale)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.emoji, 0, 0);
    ctx.restore();
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not save the photo'))),
      'image/jpeg',
      0.85,
    );
  });
}

export default function PhotoBooth() {
  const locationId = useCurrentLocationId();

  // Gallery
  const [photos, setPhotos] = useState<BoothPhoto[] | null>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  // Viewer overlay: which stored photo is open, and share/delete state.
  const [viewing, setViewing] = useState<BoothPhoto | null>(null);
  const [viewerBusy, setViewerBusy] = useState(false);
  // Two-tap delete: first tap arms, second deletes. Re-arms per photo.
  const [deleteArmed, setDeleteArmed] = useState(false);

  // Editor
  const [editor, setEditor] = useState<Editor | null>(null);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const nextStickerId = useRef(1);

  const fileRef = useRef<HTMLInputElement>(null);
  // The photo box's rendered width, for sizing sticker previews in px.
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);

  async function refreshGallery() {
    try {
      setPhotos(await fetchBoothPhotos());
      setGalleryError(null);
    } catch {
      // Offline (or server down): the booth's editor + direct share still
      // work, so keep the page useful and say the gallery part is off.
      setGalleryError("Couldn't load your saved photos — check your connection.");
      setPhotos((cur) => cur ?? []);
    }
  }

  useEffect(() => {
    void refreshGallery();
  }, []);

  // Track the photo box's width (rotation, window resize) while editing.
  useEffect(() => {
    if (!editor) return;
    const el = boxRef.current;
    if (!el) return;
    const update = () => setBoxW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editor]);

  // The editing session's object URL lives until the editor closes.
  useEffect(() => {
    if (!editor) return;
    return () => URL.revokeObjectURL(editor.url);
  }, [editor]);

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    try {
      const img = await loadImage(file);
      setStickers([]);
      setSelectedId(null);
      setEditorError(null);
      setEditor({ url: URL.createObjectURL(file), img });
    } catch {
      setGalleryError("Couldn't read that photo — try another one.");
    }
  }

  function addSticker(emoji: string) {
    const id = nextStickerId.current++;
    // Drop new stickers near the middle, staggered a little so a quick series
    // doesn't stack into one invisible pile.
    const n = stickers.length;
    setStickers((s) => [
      ...s,
      {
        id,
        emoji,
        x: 0.5 + ((n % 3) - 1) * 0.08,
        y: 0.5 + ((Math.floor(n / 3) % 3) - 1) * 0.08,
        scale: 1,
        rot: 0,
      },
    ]);
    setSelectedId(id);
  }

  function updateSelected(patch: (st: Sticker) => Partial<Sticker>) {
    setStickers((s) => s.map((st) => (st.id === selectedId ? { ...st, ...patch(st) } : st)));
  }

  // Drag state — refs, not state: pointermove shouldn't re-render more than
  // the sticker position update itself already does.
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);

  function onStickerPointerDown(e: React.PointerEvent, st: Sticker) {
    e.preventDefault();
    setSelectedId(st.id);
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    // Grab offset: keep the finger's position within the sticker constant so
    // it doesn't jump-center under the touch.
    drag.current = {
      id: st.id,
      dx: st.x - (e.clientX - box.left) / box.width,
      dy: st.y - (e.clientY - box.top) / box.height,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onStickerPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width + d.dx));
    const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height + d.dy));
    setStickers((s) => s.map((st) => (st.id === d.id ? { ...st, x, y } : st)));
  }

  function onStickerPointerUp() {
    drag.current = null;
  }

  function closeEditor() {
    setEditor(null);
    setStickers([]);
    setSelectedId(null);
    setEditorError(null);
  }

  async function onSave() {
    if (!editor || saving) return;
    setSaving(true);
    setEditorError(null);
    try {
      const blob = await flattenToJpeg(editor, stickers);
      await uploadBoothPhoto({
        imageBase64: await blobToBase64(blob),
        mediaType: 'image/jpeg',
        locationId: locationId ?? undefined,
      });
      closeEditor();
      void refreshGallery();
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Save failed — try again.');
    } finally {
      setSaving(false);
    }
  }

  async function onShareFromEditor() {
    if (!editor || saving) return;
    setSaving(true);
    setEditorError(null);
    try {
      await shareEditedPhoto(await flattenToJpeg(editor, stickers));
    } catch {
      setEditorError("Couldn't share that — try saving it instead.");
    } finally {
      setSaving(false);
    }
  }

  async function onShareStored(photo: BoothPhoto) {
    if (viewerBusy) return;
    setViewerBusy(true);
    try {
      await shareBoothPhoto(photo.id);
    } catch {
      // Best-effort sugar — offline or already gone; the viewer stays up.
    } finally {
      setViewerBusy(false);
    }
  }

  async function onDeleteStored(photo: BoothPhoto) {
    if (viewerBusy) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setViewerBusy(true);
    try {
      await deleteBoothPhoto(photo.id);
      setViewing(null);
      setDeleteArmed(false);
      setPhotos((cur) => cur?.filter((p) => p.id !== photo.id) ?? null);
    } catch {
      setGalleryError("Couldn't delete that photo — check your connection.");
    } finally {
      setViewerBusy(false);
    }
  }

  const selected = stickers.find((st) => st.id === selectedId) ?? null;

  // Square control key for the sticker-adjust row.
  const keyBtn = (label: string, onClick: () => void, aria: string) => (
    <button
      onClick={onClick}
      aria-label={aria}
      className="key flex h-10 w-10 items-center justify-center rounded-xl text-lg text-fairway-100"
    >
      {label}
    </button>
  );

  // --- Editor mode -----------------------------------------------------------
  if (editor) {
    const ratio = editor.img.naturalWidth / editor.img.naturalHeight;
    return (
      <Screen>
        <TopBar title="Decorate" />
        <Content>
          <div
            ref={boxRef}
            className="relative w-full select-none overflow-hidden rounded-2xl border border-fairway-800/60"
            style={{ aspectRatio: `${ratio}`, touchAction: 'none' }}
            // Tap the backdrop (not a sticker) to deselect.
            onPointerDown={() => setSelectedId(null)}
          >
            <img
              src={editor.url}
              alt="Your photo"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
            />
            {stickers.map((st) => (
              <span
                key={st.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onStickerPointerDown(e, st);
                }}
                onPointerMove={onStickerPointerMove}
                onPointerUp={onStickerPointerUp}
                className={`absolute cursor-grab leading-none ${
                  st.id === selectedId ? 'rounded-lg ring-2 ring-fairway-300/90' : ''
                }`}
                style={{
                  left: `${st.x * 100}%`,
                  top: `${st.y * 100}%`,
                  fontSize: `${STICKER_BASE * boxW * st.scale}px`,
                  transform: `translate(-50%, -50%) rotate(${st.rot}deg)`,
                  touchAction: 'none',
                }}
              >
                {st.emoji}
              </span>
            ))}
          </div>

          {/* Adjust the selected sticker — or the hint when none is. */}
          <div className="mt-3 flex min-h-10 items-center justify-center gap-2">
            {selected ? (
              <>
                {keyBtn('−', () => updateSelected((st) => ({ scale: Math.max(0.4, st.scale / 1.2) })), 'Smaller')}
                {keyBtn('+', () => updateSelected((st) => ({ scale: Math.min(3, st.scale * 1.2) })), 'Bigger')}
                {keyBtn('↺', () => updateSelected((st) => ({ rot: st.rot - 15 })), 'Rotate left')}
                {keyBtn('↻', () => updateSelected((st) => ({ rot: st.rot + 15 })), 'Rotate right')}
                {keyBtn('🗑️', () => {
                  setStickers((s) => s.filter((st) => st.id !== selectedId));
                  setSelectedId(null);
                }, 'Remove sticker')}
              </>
            ) : (
              <span className="text-xs text-fairway-100/60">
                Tap a sticker below to add it · drag to move
              </span>
            )}
          </div>

          {/* The sticker sheet. */}
          <div className="surface-sunk mt-2 flex gap-1 overflow-x-auto rounded-2xl p-2">
            {STICKER_SHEET.map((emoji) => (
              <button
                key={emoji}
                onClick={() => addSticker(emoji)}
                aria-label={`Add ${emoji} sticker`}
                className="shrink-0 rounded-xl p-1.5 text-3xl leading-none transition-transform active:scale-125"
              >
                {emoji}
              </button>
            ))}
          </div>

          {editorError && (
            <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {editorError}
            </div>
          )}

          <div className="mt-4 space-y-2">
            <Button onClick={() => void onSave()} disabled={saving} sound="cup">
              {saving ? 'Saving…' : '✅ Save to camera roll'}
            </Button>
            <Button variant="ghost" onClick={() => void onShareFromEditor()} disabled={saving}>
              📤 Share
            </Button>
            <Button variant="ghost" onClick={closeEditor} disabled={saving}>
              ✕ Discard
            </Button>
          </div>
        </Content>
      </Screen>
    );
  }

  // --- Gallery mode ----------------------------------------------------------
  return (
    <Screen>
      <TopBar title="Photo Booth" back="/" />
      {/* No `capture` on purpose (unlike the hunt): the booth wants selfies and
          library picks alike — the OS sheet offers front/rear camera and the
          photo roll, and there's nothing to verify, so nothing to lock down. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onFileChosen(e)}
      />
      <Content>
        <p className="mb-1 text-sm text-fairway-100/70">
          Snap a photo, pile on the stickers, and share it — or keep it in your camera
          roll for the group.
        </p>
        {/* The pipeline's player-facing disclosure — stored on the venue
            server, never sent to any AI (see /privacy). */}
        <p className="mb-4 text-xs text-fairway-100/50">
          Saved photos stay private to this phone and are never AI-checked.{' '}
          <Link to="/privacy" className="underline">
            How photos are handled
          </Link>
        </p>

        <Button onClick={() => fileRef.current?.click()} sound="cup">
          📸 Take a photo
        </Button>

        {galleryError && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            {galleryError}
          </div>
        )}

        <div className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-fairway-400">
          Camera roll
        </div>
        {photos === null ? (
          <p className="text-sm text-fairway-100/70">Loading…</p>
        ) : photos.length === 0 ? (
          <p className="text-sm text-fairway-100/60">
            Nothing here yet — your saved photos will show up in a grid.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <button
                key={p.id}
                onClick={() => {
                  setViewing(p);
                  setDeleteArmed(false);
                }}
                className="tile animate-pop-in aspect-square overflow-hidden rounded-2xl"
                style={{ '--i': i } as CSSProperties}
              >
                <img
                  src={boothPhotoUrl(p.id)}
                  alt="Saved photo"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </Content>

      {/* Full-screen viewer for a stored photo. */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4"
          style={{
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          }}
        >
          <img
            src={boothPhotoUrl(viewing.id)}
            alt="Saved photo"
            className="min-h-0 flex-1 object-contain"
          />
          <div className="mx-auto mt-4 flex w-full max-w-md flex-col gap-2">
            <Button onClick={() => void onShareStored(viewing)} disabled={viewerBusy}>
              {viewerBusy ? '…' : '📤 Share'}
            </Button>
            <Button
              variant="danger"
              onClick={() => void onDeleteStored(viewing)}
              disabled={viewerBusy}
            >
              {deleteArmed ? 'Tap again to delete' : '🗑️ Delete'}
            </Button>
            <Button variant="ghost" onClick={() => setViewing(null)} disabled={viewerBusy}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Screen>
  );
}
