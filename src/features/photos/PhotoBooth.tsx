import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { loadImage, encodeJpeg, blobToBase64 } from '../../lib/image';
import { useCurrentLocationId } from '../../lib/location';
import {
  putBoothDraft,
  getBoothDraft,
  deleteBoothDraft,
  getBoothDraftIds,
  pruneBoothDrafts,
  type BoothSticker,
} from '../../db';
import {
  fetchBoothPhotos,
  uploadBoothPhoto,
  replaceBoothPhoto,
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
//
// Editable drafts: the server only ever holds the flattened JPEG, but this
// device also keeps the editable source (base photo + sticker placements) in
// IndexedDB (db.ts, boothDrafts), so a saved photo can be re-opened and its
// stickers moved/added/removed, then re-flattened. Drafts live only on the
// device that made the photo (never uploaded — no extra data on the server, no
// change to the privacy story) and are pruned when their photo disappears.
// Re-saving an edit replaces the server copy (delete + re-upload).

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
// Defined once in db/index.ts (BoothSticker) so a saved draft round-trips
// through the exact same shape.
type Sticker = BoothSticker;

// Base sticker size as a fraction of the photo's width — same constant drives
// the on-screen preview and the canvas export, so what you see is what bakes.
const STICKER_BASE = 0.22;
// Long-edge cap for the exported JPEG, matching the hunt's upload ceiling.
const EXPORT_MAX_DIM = 1280;

// --- Sticker rasterization ---------------------------------------------------
// Each emoji is drawn ONCE to a bitmap, and that same bitmap drives both the
// on-screen preview and the flattened export — so a placed sticker lands in
// exactly the same spot when saved. (The editor previously drew the emoji as
// DOM text but the export drew it as canvas text; `translate(-50%,-50%)` on a
// line box and canvas `textBaseline:'middle'` on the em box anchor an emoji
// glyph slightly differently, so exported stickers sat a few percent off. One
// shared bitmap removes that divergence.)
//
// The bitmap is sized to the glyph's MEASURED bounding box plus a small margin,
// not a fixed square: a fixed square clipped wide or off-center glyphs (e.g. 🕶️
// overflowed and showed a hard rectangular edge when scaled up). Measuring and
// centering on the visual box guarantees no clip and a true center for any
// emoji. `ratio` is the glyph's larger dimension as a fraction of the square,
// so the caller can size the rendered sticker to a target glyph size.
type StickerBitmap = { canvas: HTMLCanvasElement; url: string; ratio: number };

// Transparent halo around the glyph — room for anti-aliasing and the odd emoji
// whose reported bounds run a touch tight, without bloating the tap area.
const STICKER_MARGIN = 0.14;
const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const stickerCache = new Map<string, StickerBitmap>();
function stickerBitmap(emoji: string): StickerBitmap {
  const cached = stickerCache.get(emoji);
  if (cached) return cached;

  const REF = 256; // reference font px for measuring + drawing
  const font = `${REF}px ${EMOJI_FONT}`;
  const measure = document.createElement('canvas').getContext('2d');
  let glyphW = REF;
  let glyphH = REF;
  let dxCenter = 0; // glyph bbox center offset from the pen, in x
  let dyCenter = 0; // …and y
  if (measure) {
    measure.font = font;
    measure.textAlign = 'center';
    measure.textBaseline = 'middle';
    const m = measure.measureText(emoji);
    // actualBoundingBox* are supported in modern mobile Safari; fall back to
    // the em box (a centered square) if a browser doesn't report them.
    const left = m.actualBoundingBoxLeft ?? REF / 2;
    const right = m.actualBoundingBoxRight ?? REF / 2;
    const asc = m.actualBoundingBoxAscent ?? REF / 2;
    const desc = m.actualBoundingBoxDescent ?? REF / 2;
    glyphW = Math.max(1, left + right);
    glyphH = Math.max(1, asc + desc);
    // With a center/middle pen, the bbox is offset by these when it isn't
    // symmetric about the pen — subtract to re-center the glyph in the square.
    dxCenter = (right - left) / 2;
    dyCenter = (desc - asc) / 2;
  }
  const maxDim = Math.max(glyphW, glyphH);
  const side = Math.ceil(maxDim * (1 + 2 * STICKER_MARGIN));

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, side / 2 - dxCenter, side / 2 - dyCenter);
  }
  const bitmap: StickerBitmap = { canvas, url: canvas.toDataURL(), ratio: maxDim / side };
  stickerCache.set(emoji, bitmap);
  return bitmap;
}

// The rendered square's side, so the glyph's larger dimension ends up
// STICKER_BASE*width*scale regardless of the emoji's shape (the bitmap's
// transparent margin is divided back out via `ratio`).
function stickerSide(imageWidth: number, scale: number, ratio: number): number {
  return (STICKER_BASE * imageWidth * scale) / ratio;
}

type Editor = {
  /** Object URL of the base photo, alive for the whole editing session. */
  url: string;
  img: HTMLImageElement;
  /** The undecorated, normalized base photo — persisted with the draft so a
   *  re-edit starts from the exact same pixels (no generational recompression).
   *  img is loaded from this blob, so the two are pixel-identical. */
  base: Blob;
  /** The server photo id when re-editing an existing save; null for a new
   *  capture. Drives whether Save creates or replaces. */
  editingId: string | null;
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
    // Same bitmap the editor previews, centered on the same fractional point —
    // so the save matches the screen exactly.
    const bmp = stickerBitmap(st.emoji);
    const side = stickerSide(w, st.scale, bmp.ratio);
    ctx.save();
    ctx.translate(st.x * w, st.y * h);
    ctx.rotate((st.rot * Math.PI) / 180);
    ctx.drawImage(bmp.canvas, -side / 2, -side / 2, side, side);
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
  // Ids of saved photos that have a local editable draft (this device only).
  const [editableIds, setEditableIds] = useState<Set<string>>(new Set());
  // Cache-bust tokens per photo id, bumped after an in-place replace so the
  // gallery/viewer/share fetch the new bytes instead of the cached originals.
  const [versions, setVersions] = useState<Record<string, number>>({});
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

  async function refreshEditable() {
    try {
      setEditableIds(new Set(await getBoothDraftIds()));
    } catch {
      // idb unavailable (private mode / quota) — drafts just won't show.
    }
  }

  async function refreshGallery() {
    try {
      const list = await fetchBoothPhotos();
      setPhotos(list);
      setGalleryError(null);
      // The fetch is complete (booth cap < the 200-row limit), so any draft
      // whose photo isn't here was deleted elsewhere (staff/retention/another
      // device) — prune it. Guarded on success so an offline blip never wipes
      // live drafts.
      await pruneBoothDrafts(list.map((p) => p.id)).catch(() => {});
      await refreshEditable();
    } catch {
      // Offline (or server down): the booth's editor + direct share still
      // work, so keep the page useful and say the gallery part is off.
      setGalleryError("Couldn't load your saved photos — check your connection.");
      setPhotos((cur) => cur ?? []);
      await refreshEditable();
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
      // Normalize once to a downscaled JPEG base, then work off THAT image, so
      // the editing pixels, the stored draft, and the export all match — and
      // the draft stays small. Fall back to the raw file if canvas is out.
      const picked = await loadImage(file);
      const base = (await encodeJpeg(picked, EXPORT_MAX_DIM, 0.85)) ?? file;
      const img = await loadImage(base);
      nextStickerId.current = 1;
      setStickers([]);
      setSelectedId(null);
      setEditorError(null);
      setEditor({ url: URL.createObjectURL(base), img, base, editingId: null });
    } catch {
      setGalleryError("Couldn't read that photo — try another one.");
    }
  }

  // Re-open a saved photo from its local draft: reconstruct the editor from the
  // stored base + sticker placements. Only offered for photos this device has a
  // draft for (editableIds).
  async function onEditPhoto(photo: BoothPhoto) {
    try {
      const draft = await getBoothDraft(photo.id);
      if (!draft) return; // pruned/gone — the button shouldn't have shown
      const img = await loadImage(draft.base);
      nextStickerId.current =
        draft.stickers.reduce((m, s) => Math.max(m, s.id), 0) + 1;
      setViewing(null);
      setStickers(draft.stickers);
      setSelectedId(null);
      setEditorError(null);
      setEditor({
        url: URL.createObjectURL(draft.base),
        img,
        base: draft.base,
        editingId: photo.id,
      });
    } catch {
      setGalleryError("Couldn't open that photo for editing.");
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

  function removeSticker(id: number) {
    setStickers((s) => s.filter((st) => st.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
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
      const imageBase64 = await blobToBase64(blob);

      // Re-saving an edit overwrites the same row in place (same id, same
      // gallery position); a new capture creates a row. Either way the photo id
      // that owns the draft is stable, so the draft key never has to migrate.
      let photoId: string;
      if (editor.editingId) {
        await replaceBoothPhoto(editor.editingId, { imageBase64, mediaType: 'image/jpeg' });
        photoId = editor.editingId;
        // Same URL, new bytes — bump the cache-bust token so the grid, viewer,
        // and any share re-fetch the edited photo, not the cached original.
        setVersions((v) => ({ ...v, [photoId]: Date.now() }));
      } else {
        const saved = await uploadBoothPhoto({
          imageBase64,
          mediaType: 'image/jpeg',
          locationId: locationId ?? undefined,
        });
        photoId = saved.id;
      }

      // Persist the editable draft locally (never uploaded) so this photo can
      // be re-opened and re-decorated. Best-effort: a save is still a save even
      // if idb is full/unavailable — the photo just won't be re-editable.
      await putBoothDraft({
        id: photoId,
        base: editor.base,
        stickers,
        updatedAt: Date.now(),
      }).catch(() => {});

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
      await shareBoothPhoto(photo.id, versions[photo.id]);
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
      await deleteBoothDraft(photo.id).catch(() => {});
      setViewing(null);
      setDeleteArmed(false);
      setPhotos((cur) => cur?.filter((p) => p.id !== photo.id) ?? null);
      setEditableIds((cur) => {
        if (!cur.has(photo.id)) return cur;
        const next = new Set(cur);
        next.delete(photo.id);
        return next;
      });
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
        <TopBar title={editor.editingId ? 'Edit photo' : 'Decorate'} />
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
            {stickers.map((st) => {
              // The rendered bitmap — identical pixels to what the export bakes,
              // so the preview is truly WYSIWYG. Sized off the box's real width.
              const bmp = stickerBitmap(st.emoji);
              const side = stickerSide(boxW, st.scale, bmp.ratio);
              const isSel = st.id === selectedId;
              return (
                <div
                  key={st.id}
                  className="absolute"
                  style={{
                    left: `${st.x * 100}%`,
                    top: `${st.y * 100}%`,
                    width: `${side}px`,
                    height: `${side}px`,
                    transform: `translate(-50%, -50%) rotate(${st.rot}deg)`,
                    touchAction: 'none',
                  }}
                >
                  <img
                    src={bmp.url}
                    alt=""
                    draggable={false}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onStickerPointerDown(e, st);
                    }}
                    onPointerMove={onStickerPointerMove}
                    onPointerUp={onStickerPointerUp}
                    className={`h-full w-full cursor-grab ${
                      isSel ? 'rounded-lg ring-2 ring-fairway-300/90' : ''
                    }`}
                    style={{ touchAction: 'none' }}
                  />
                  {/* Direct delete: an × on the selected sticker, tappable right
                      on the canvas. Counter-rotated so the glyph stays upright,
                      and it swallows the pointerdown so tapping it never starts
                      a drag or deselects. */}
                  {isSel && (
                    <button
                      type="button"
                      aria-label="Remove sticker"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSticker(st.id);
                      }}
                      className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-red-600 text-base font-bold leading-none text-white shadow-md"
                      style={{ transform: `rotate(${-st.rot}deg)`, touchAction: 'none' }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Adjust the selected sticker — or the hint when none is. */}
          <div className="mt-3 flex min-h-10 items-center justify-center gap-2">
            {selected ? (
              <>
                {keyBtn('−', () => updateSelected((st) => ({ scale: Math.max(0.4, st.scale / 1.2) })), 'Smaller')}
                {keyBtn('+', () => updateSelected((st) => ({ scale: Math.min(3, st.scale * 1.2) })), 'Bigger')}
                {keyBtn('↺', () => updateSelected((st) => ({ rot: st.rot - 15 })), 'Rotate left')}
                {keyBtn('↻', () => updateSelected((st) => ({ rot: st.rot + 15 })), 'Rotate right')}
                {keyBtn('🗑️', () => selectedId !== null && removeSticker(selectedId), 'Remove sticker')}
              </>
            ) : (
              <span className="text-xs text-fairway-100/60">
                Tap a sticker to select · drag to move · ✕ to remove
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
              {saving
                ? 'Saving…'
                : editor.editingId
                  ? '✅ Save changes'
                  : '✅ Save to camera roll'}
            </Button>
            <Button variant="ghost" onClick={() => void onShareFromEditor()} disabled={saving}>
              📤 Share
            </Button>
            <Button variant="ghost" onClick={closeEditor} disabled={saving}>
              {editor.editingId ? '✕ Cancel' : '✕ Discard'}
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
          Saved photos are only visible to this phone and never AI-checked — until you
          choose to share one.{' '}
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
                className="tile animate-pop-in relative aspect-square overflow-hidden rounded-2xl"
                style={{ '--i': i } as CSSProperties}
              >
                <img
                  src={boothPhotoUrl(p.id, versions[p.id])}
                  alt="Saved photo"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                {/* This device has the editable draft — mark it re-openable. */}
                {editableIds.has(p.id) && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 right-1 rounded-full bg-black/55 px-1.5 py-0.5 text-xs leading-none"
                  >
                    ✏️
                  </span>
                )}
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
            src={boothPhotoUrl(viewing.id, versions[viewing.id])}
            alt="Saved photo"
            className="min-h-0 flex-1 object-contain"
          />
          <div className="mx-auto mt-4 flex w-full max-w-md flex-col gap-2">
            <Button onClick={() => void onShareStored(viewing)} disabled={viewerBusy}>
              {viewerBusy ? '…' : '📤 Share'}
            </Button>
            {/* Re-open in the editor — only when this device holds the draft. */}
            {editableIds.has(viewing.id) && (
              <Button
                variant="ghost"
                onClick={() => void onEditPhoto(viewing)}
                disabled={viewerBusy}
              >
                ✏️ Edit stickers
              </Button>
            )}
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
