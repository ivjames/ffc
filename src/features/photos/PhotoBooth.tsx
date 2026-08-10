import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  fetchVenueStickers,
  venueStickerUrl,
  type BoothPhoto,
  type VenueSticker,
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
// emoji. `ratio` is the em (reference font size) as a fraction of the square,
// so the caller sizes the rendered sticker to the prior em-based scale (see
// stickerBitmap's return). `w`/`h` are the bitmap's pixel dimensions, cropped to
// the glyph's ACTUAL ink (+ a small margin), so the rendered sticker, its
// selection ring, and its tap area hug the glyph instead of a big square that
// dwarfs a wide/short emoji like 🕶️.
type StickerBitmap = {
  canvas: HTMLCanvasElement;
  url: string;
  w: number;
  h: number;
};

// The box hugs the glyph's ink; this is just a hair of breathing room so the
// anti-aliased edge isn't shaved and the selection ring doesn't touch the ink.
const STICKER_MARGIN = 0.02;
// Font px the emoji is drawn at when rasterizing.
const EMOJI_REF = 256;
const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

// The tight bounding box of the painted (non-transparent) pixels. measureText's
// actualBoundingBox is unreliable for color emoji — Apple Color Emoji reports a
// full-em square regardless of the glyph's real shape — so scan the alpha
// channel instead. Returns null if nothing was painted.
function inkBounds(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const emojiCache = new Map<string, StickerBitmap>();
function emojiBitmap(emoji: string): StickerBitmap {
  const cached = emojiCache.get(emoji);
  if (cached) return cached;

  const REF = EMOJI_REF;
  const font = `${REF}px ${EMOJI_FONT}`;
  // Draw big into a padded scratch canvas, then find the real ink box by
  // scanning pixels (color-emoji font metrics don't give a tight box).
  const pad = Math.round(REF * 0.6);
  const work = REF + pad * 2;
  const wc = document.createElement('canvas');
  wc.width = wc.height = work;
  const wctx = wc.getContext('2d', { willReadFrequently: true });
  let box: { x: number; y: number; w: number; h: number } | null = null;
  if (wctx) {
    wctx.font = font;
    wctx.textAlign = 'center';
    wctx.textBaseline = 'middle';
    wctx.fillText(emoji, work / 2, work / 2);
    box = inkBounds(wctx, work, work);
  }
  // Fallback (no context / getImageData blocked): a centered em square.
  if (!box) box = { x: (work - REF) / 2, y: (work - REF) / 2, w: REF, h: REF };

  const margin = Math.round(Math.max(box.w, box.h) * STICKER_MARGIN);
  const bw = box.w + margin * 2;
  const bh = box.h + margin * 2;
  const canvas = document.createElement('canvas');
  canvas.width = bw;
  canvas.height = bh;
  const ctx = canvas.getContext('2d');
  // Copy just the ink region out of the scratch canvas, centered with margin.
  if (ctx && wctx) ctx.drawImage(wc, box.x, box.y, box.w, box.h, margin, margin, box.w, box.h);

  const bitmap: StickerBitmap = { canvas, url: canvas.toDataURL(), w: bw, h: bh };
  emojiCache.set(emoji, bitmap);
  return bitmap;
}

// --- Venue SVG stickers ------------------------------------------------------
// Venue SVGs stay VECTORS through editing — the editor renders each as an <img>
// (inert, never inlined — no script execution) so it's crisp at any size, and
// rasterization happens only at export, where the SVG is drawn to the flatten
// canvas at the export resolution (not a fixed pre-raster that would go soft
// when a sticker is scaled up large). Same-origin + sanitized (no
// foreignObject/external refs) means drawing it never taints the canvas, so the
// export toBlob still works. The loaded HTMLImageElement is cached so export
// can drawImage it synchronously once decoded.
const svgImages = new Map<string, HTMLImageElement>();
const svgImagePending = new Map<string, Promise<HTMLImageElement | null>>();

function loadSvgImage(svgId: string): Promise<HTMLImageElement | null> {
  const done = svgImages.get(svgId);
  if (done) return Promise.resolve(done);
  const inflight = svgImagePending.get(svgId);
  if (inflight) return inflight;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    // Request CORS so this element stays origin-clean when the API is a
    // separate origin (VITE_API_BASE) — the API sends permissive CORS headers.
    // Without it, drawing the SVG onto the export canvas taints it and toBlob
    // throws. Harmless same-origin. Must be set before src.
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      svgImages.set(svgId, img);
      resolve(img);
    };
    img.onerror = () => resolve(null); // venue removed it, offline, etc.
    img.src = venueStickerUrl(svgId);
  }).finally(() => svgImagePending.delete(svgId));
  svgImagePending.set(svgId, p);
  return p;
}

// The rendered sticker's width/height in px, sized so the box (and its ring/tap
// area) hugs the art. Emoji are anchored to the em (EMOJI_REF) exactly as
// before this change: the visible glyph resolves to inkW*target/REF either way,
// so a stored `scale` means the same thing and pre-existing drafts don't
// resize — the only thing that changed is a tighter, aspect-correct box. SVG is
// sized from its intrinsic larger side.
function displaySize(
  st: Sticker,
  imageWidth: number,
  scale: number,
  svgMeta: SvgMeta,
): { dw: number; dh: number } {
  const target = STICKER_BASE * imageWidth * scale;
  if (st.emoji) {
    const b = emojiBitmap(st.emoji);
    const f = target / EMOJI_REF; // em -> target (unchanged scale semantics)
    return { dw: b.w * f, dh: b.h * f };
  }
  const meta = st.svgId ? svgMeta.get(st.svgId) : undefined;
  // `??` only fills nullish, so a stored/served 0 (an SVG whose intrinsic
  // dimension rounded to zero) would slip through and yield a zero-sized
  // sticker or NaN — normalize each to a positive fallback.
  const rawW = st.svgW ?? meta?.width ?? 100;
  const rawH = st.svgH ?? meta?.height ?? 100;
  const aw = rawW > 0 ? rawW : 100;
  const ah = rawH > 0 ? rawH : 100;
  const f = target / Math.max(aw, ah);
  return { dw: aw * f, dh: ah * f };
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

// Intrinsic sizes for the venue SVG stickers currently in play, so an SVG
// sticker draws at the right aspect. Missing entry -> a 1:1 fallback.
type SvgMeta = Map<string, { width: number; height: number }>;

// Watermark placement: its larger dimension is this fraction of the photo
// width, inset this fraction from the chosen corner.
const WM_FRAC = 0.18;
const WM_MARGIN = 0.04;

// Drop shadow behind the watermark, so the brand stays legible over any photo.
// Blur + vertical offset are fractions of the photo width, so export and the
// CSS-scaled preview both track the rendered size. Drawn as several stacked
// passes at full opacity so the shadow reads as a thick, solid halo even over a
// bright, busy background (e.g. the green mini-golf frame).
const WM_SHADOW_COLOR = 'rgba(0,0,0,1)';
const WM_SHADOW_BLUR = 0.04;
const WM_SHADOW_OFFSET = 0.01;
const WM_SHADOW_PASSES = 4;

// Thrown by the export when a FORCED watermark can't be composited (its image
// failed to load) — so a photo never goes out missing the venue's branding.
const BRANDING_UNAVAILABLE = 'BRANDING_UNAVAILABLE';
const BRANDING_PENDING_MSG =
  "Can't confirm this venue's branding yet — check your connection and try again.";
const BRANDING_FAIL_MSG =
  "Couldn't apply the venue's branding — reconnect and try again.";

// Durable cache of a venue's asset config, so the forced-watermark requirement
// is known even offline / before the network resolves — treating an unreachable
// list as "no watermark" would silently drop branding.
const VENUE_CACHE_PREFIX = 'ffc:venueStickers:';
function readVenueCache(locId: string): VenueSticker[] | null {
  try {
    const raw = localStorage.getItem(VENUE_CACHE_PREFIX + locId);
    return raw ? (JSON.parse(raw) as VenueSticker[]) : null;
  } catch {
    return null;
  }
}
function writeVenueCache(locId: string, list: VenueSticker[]): void {
  try {
    localStorage.setItem(VENUE_CACHE_PREFIX + locId, JSON.stringify(list));
  } catch {
    // Storage full / unavailable — the network path still gates export.
  }
}

// Full-photo frame + forced corner watermark(s) composited on top of stickers.
type Overlays = {
  frameId: string | null;
  watermarks: VenueSticker[];
};

// A watermark occupies a WM_FRAC-of-width SQUARE slot inset WM_MARGIN from the
// chosen corner; the SVG is contained + centered within that slot. Preview and
// export both use this, so what's shown is what bakes. Returns the slot's
// top-left in photo pixels.
function watermarkSlot(corner: string, w: number, h: number) {
  const slot = WM_FRAC * w;
  const m = WM_MARGIN * w;
  const x = corner[1] === 'l' ? m : w - m - slot;
  const y = corner[0] === 't' ? m : h - m - slot;
  return { x, y, slot };
}

async function flattenToJpeg(
  editor: Editor,
  stickers: Sticker[],
  svgMeta: SvgMeta,
  overlays: Overlays,
): Promise<Blob> {
  const { img } = editor;
  const s = Math.min(1, EXPORT_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  for (const st of stickers) {
    ctx.save();
    ctx.translate(st.x * w, st.y * h);
    ctx.rotate((st.rot * Math.PI) / 180);
    if (st.emoji) {
      // The same measured bitmap the editor previews — pixel-identical.
      const { dw, dh } = displaySize(st, w, st.scale, svgMeta);
      ctx.drawImage(emojiBitmap(st.emoji).canvas, -dw / 2, -dh / 2, dw, dh);
    } else if (st.svgId) {
      // Rasterize the vector HERE, at export resolution, so it's crisp however
      // large the sticker is. An SVG that won't load is simply skipped.
      const svg = await loadSvgImage(st.svgId);
      if (svg) {
        const { dw, dh } = displaySize(st, w, st.scale, svgMeta);
        ctx.drawImage(svg, -dw / 2, -dh / 2, dw, dh);
      }
    }
    ctx.restore();
  }

  // Frame: a full-bleed overlay stretched edge-to-edge, ON TOP of the stickers.
  if (overlays.frameId) {
    const frame = await loadSvgImage(overlays.frameId);
    if (frame) ctx.drawImage(frame, 0, 0, w, h);
  }

  // Watermark(s): forced venue branding, each pinned to its corner at a fixed
  // size — drawn last so nothing covers the brand.
  for (const wm of overlays.watermarks) {
    const img = await loadSvgImage(wm.id);
    // A forced watermark that won't load must NOT be silently dropped — abort
    // the export so the photo never goes out missing the venue's branding.
    if (!img) throw new Error(BRANDING_UNAVAILABLE);
    const { x, y, slot } = watermarkSlot(wm.corner, w, h);
    const aw = wm.width > 0 ? wm.width : 100;
    const ah = wm.height > 0 ? wm.height : 100;
    const fit = slot / Math.max(aw, ah); // contain within the square slot
    const dw = aw * fit;
    const dh = ah * fit;
    // Center the contained mark within the slot (matches the preview's
    // object-contain), so preview and export line up.
    // A soft drop shadow lifts the mark off busy photos so it stays legible
    // over any background. Sized relative to photo width so it scales with the
    // export; mirrored by the preview's CSS drop-shadow filter.
    ctx.save();
    ctx.shadowColor = WM_SHADOW_COLOR;
    ctx.shadowBlur = WM_SHADOW_BLUR * w;
    ctx.shadowOffsetY = WM_SHADOW_OFFSET * w;
    // Redraw in place; each pass lays down the same alpha-shaped shadow, so the
    // shadow accumulates (deeper) while the mark itself stays crisp on top.
    const dx = x + (slot - dw) / 2;
    const dy = y + (slot - dh) / 2;
    for (let p = 0; p < WM_SHADOW_PASSES; p++) ctx.drawImage(img, dx, dy, dw, dh);
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

  // Venue SVG assets for the current location, split by kind. In the editor
  // they render as crisp vector <img>s directly; only the export rasterizes
  // them (at export resolution), so no pre-raster bookkeeping is needed here.
  const [venueStickers, setVenueStickers] = useState<VenueSticker[]>([]);
  const stickerSheet = useMemo(() => venueStickers.filter((s) => s.kind === 'sticker'), [venueStickers]);
  const frames = useMemo(() => venueStickers.filter((s) => s.kind === 'frame'), [venueStickers]);
  const watermarks = useMemo(() => venueStickers.filter((s) => s.kind === 'watermark'), [venueStickers]);
  const svgMeta = useMemo<SvgMeta>(
    () => new Map(venueStickers.map((s) => [s.id, { width: s.width, height: s.height }])),
    [venueStickers],
  );
  // The selected full-photo frame (null = none). The forced watermark isn't
  // state — it's always the venue's, applied automatically.
  const [frameId, setFrameId] = useState<string | null>(null);
  // Whether the venue's asset config is KNOWN (from network or durable cache).
  // Export is gated on this so a forced watermark is never silently skipped
  // because the list hadn't loaded. No venue (locationId null) counts as known.
  const [venueReady, setVenueReady] = useState(false);

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

  // The venue's asset config for the current location. Seed from the durable
  // cache immediately (so the forced-watermark requirement is known even
  // offline), then refresh from the network. `venueReady` is true once we have
  // a config from either source; only a first-ever visit that can't reach the
  // server stays not-ready, which blocks export rather than dropping branding.
  useEffect(() => {
    if (!locationId) {
      setVenueStickers([]);
      setVenueReady(true); // no venue -> nothing is forced
      return;
    }
    let cancelled = false;
    const cached = readVenueCache(locationId);
    if (cached) {
      setVenueStickers(cached);
      setVenueReady(true);
    } else {
      setVenueStickers([]);
      setVenueReady(false);
    }
    void fetchVenueStickers(locationId).then(
      (list) => {
        if (cancelled) return;
        setVenueStickers(list);
        writeVenueCache(locationId, list);
        setVenueReady(true);
      },
      () => {
        // Keep the cached config if we had one; otherwise we still don't know
        // this venue's requirements, so leave venueReady false (export blocked).
        if (!cancelled && !cached) setVenueReady(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  // Warm the export cache: decode the HTMLImageElement for each placed SVG
  // sticker, the selected frame, and the forced watermark(s) now (also covers
  // reopening a draft), so a Save/Share right after doesn't wait on a load. The
  // editor <img>s render regardless; this is just a head start.
  useEffect(() => {
    for (const st of stickers) {
      if (st.svgId) void loadSvgImage(st.svgId);
    }
    if (frameId) void loadSvgImage(frameId);
    for (const wm of watermarks) void loadSvgImage(wm.id);
  }, [stickers, frameId, watermarks]);

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
      setFrameId(null);
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
      setFrameId(draft.frameId ?? null);
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

  function addSticker(kind: { emoji: string } | { svgId: string }) {
    const id = nextStickerId.current++;
    // Warm the export cache; the editor <img> renders the vector immediately.
    // Capture the SVG's intrinsic size NOW so a reopened draft keeps its aspect
    // regardless of whether venue metadata is loaded later.
    let dims: { svgW?: number; svgH?: number } = {};
    if ('svgId' in kind) {
      void loadSvgImage(kind.svgId);
      const m = svgMeta.get(kind.svgId);
      if (m) dims = { svgW: m.width, svgH: m.height };
    }
    // Drop new stickers near the middle, staggered a little so a quick series
    // doesn't stack into one invisible pile.
    const n = stickers.length;
    setStickers((s) => [
      ...s,
      {
        id,
        ...kind,
        ...dims,
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
    setFrameId(null);
    setSelectedId(null);
    setEditorError(null);
  }

  // The overlays applied at export: the chosen frame + the venue's forced
  // watermark(s). Reused by Save and Share so both bake the same result.
  const overlays: Overlays = { frameId, watermarks };

  async function onSave() {
    if (!editor || saving) return;
    // Don't save until the venue's forced-branding config is known.
    if (!venueReady) {
      setEditorError(BRANDING_PENDING_MSG);
      return;
    }
    setSaving(true);
    setEditorError(null);
    try {
      const blob = await flattenToJpeg(editor, stickers, svgMeta, overlays);
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
        frameId,
        updatedAt: Date.now(),
      }).catch(() => {});

      closeEditor();
      void refreshGallery();
    } catch (err) {
      const msg = err instanceof Error && err.message === BRANDING_UNAVAILABLE
        ? BRANDING_FAIL_MSG
        : err instanceof Error
          ? err.message
          : 'Save failed — try again.';
      setEditorError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function onShareFromEditor() {
    if (!editor || saving) return;
    if (!venueReady) {
      setEditorError(BRANDING_PENDING_MSG);
      return;
    }
    setSaving(true);
    setEditorError(null);
    try {
      await shareEditedPhoto(await flattenToJpeg(editor, stickers, svgMeta, overlays));
    } catch (err) {
      setEditorError(
        err instanceof Error && err.message === BRANDING_UNAVAILABLE
          ? BRANDING_FAIL_MSG
          : "Couldn't share that — try saving it instead.",
      );
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
              // Emoji render from their measured bitmap (pixel-identical to the
              // export); SVGs render as the crisp vector directly (rasterized
              // only at export). Sized off the box's real width.
              const src = st.emoji
                ? emojiBitmap(st.emoji).url
                : st.svgId
                  ? venueStickerUrl(st.svgId)
                  : null;
              if (!src) return null;
              // Aspect-correct box so the ring/tap area hug the art.
              const { dw, dh } = displaySize(st, boxW, st.scale, svgMeta);
              const isSel = st.id === selectedId;
              return (
                <div
                  key={st.id}
                  className="absolute"
                  style={{
                    left: `${st.x * 100}%`,
                    top: `${st.y * 100}%`,
                    width: `${dw}px`,
                    height: `${dh}px`,
                    transform: `translate(-50%, -50%) rotate(${st.rot}deg)`,
                    touchAction: 'none',
                  }}
                >
                  <img
                    src={src}
                    alt=""
                    draggable={false}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onStickerPointerDown(e, st);
                    }}
                    onPointerMove={onStickerPointerMove}
                    onPointerUp={onStickerPointerUp}
                    // The box already matches the art's aspect, so the image
                    // fills it exactly (emoji bitmap and SVG alike).
                    className={`h-full w-full object-fill cursor-grab ${
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

            {/* Full-photo frame overlay — above stickers, non-interactive.
                object-fill stretches it edge-to-edge, matching the export. */}
            {frameId && (
              <img
                src={venueStickerUrl(frameId)}
                alt=""
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full object-fill"
              />
            )}

            {/* Forced venue watermark(s), pinned to their corner — topmost,
                non-interactive. Sized/inset off the box WIDTH (px), exactly as
                the export sizes off the photo width, so preview == save. */}
            {watermarks.map((wm) => (
              <div
                key={wm.id}
                className="pointer-events-none absolute"
                style={{
                  width: `${WM_FRAC * boxW}px`,
                  height: `${WM_FRAC * boxW}px`,
                  [wm.corner[0] === 't' ? 'top' : 'bottom']: `${WM_MARGIN * boxW}px`,
                  [wm.corner[1] === 'l' ? 'left' : 'right']: `${WM_MARGIN * boxW}px`,
                }}
              >
                {/* One <img> per shadow pass, each carrying a SINGLE drop-shadow.
                    Stacking chained CSS filters on one element would compound the
                    offset+blur (each filter shadows the previous filter's output),
                    drifting the preview away from the export at 4 passes. Instead
                    these layers are independent — every copy shadows the ORIGINAL
                    logo at the same offset, exactly like the export's canvas loop
                    (drawImage N times), so the shadow density accumulates in place
                    and preview == save. */}
                {Array.from({ length: WM_SHADOW_PASSES }).map((_, i) => (
                  <img
                    key={i}
                    src={venueStickerUrl(wm.id)}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-contain"
                    style={{
                      filter: `drop-shadow(0 ${WM_SHADOW_OFFSET * boxW}px ${WM_SHADOW_BLUR * boxW}px ${WM_SHADOW_COLOR})`,
                    }}
                  />
                ))}
              </div>
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
                {keyBtn('🗑️', () => selectedId !== null && removeSticker(selectedId), 'Remove sticker')}
              </>
            ) : (
              <span className="text-xs text-fairway-100/60">
                Tap a sticker to select · drag to move · ✕ to remove
              </span>
            )}
          </div>

          {/* Frames — full-photo overlays, pick one (tap again to clear). */}
          {frames.length > 0 && (
            <>
              <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-fairway-400">
                Frames
              </div>
              <div className="surface-sunk mt-1 flex gap-1 overflow-x-auto rounded-2xl p-2">
                <button
                  onClick={() => setFrameId(null)}
                  className={`flex h-11 shrink-0 items-center justify-center rounded-xl px-3 text-xs font-semibold ${
                    frameId === null ? 'btn-accent text-fairway-50' : 'key text-fairway-100'
                  }`}
                >
                  None
                </button>
                {frames.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFrameId((cur) => (cur === f.id ? null : f.id))}
                    aria-label={`Frame ${f.label ?? ''}`}
                    title={f.label ?? undefined}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl p-1 ${
                      frameId === f.id ? 'ring-2 ring-fairway-300/90' : ''
                    }`}
                  >
                    <img
                      src={venueStickerUrl(f.id)}
                      alt=""
                      draggable={false}
                      className="max-h-full max-w-full object-contain"
                    />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* The sticker sheet — this venue's draggable stickers first (when
              any), then the built-in emoji. */}
          <div className="surface-sunk mt-2 flex gap-1 overflow-x-auto rounded-2xl p-2">
            {stickerSheet.map((s) => (
              <button
                key={s.id}
                onClick={() => addSticker({ svgId: s.id })}
                aria-label={`Add ${s.label ?? 'venue'} sticker`}
                title={s.label ?? undefined}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl p-1.5 transition-transform active:scale-125"
              >
                {/* Rendered as an <img>: inert, never inlined. */}
                <img
                  src={venueStickerUrl(s.id)}
                  alt=""
                  draggable={false}
                  className="max-h-full max-w-full object-contain"
                />
              </button>
            ))}
            {STICKER_SHEET.map((emoji) => (
              <button
                key={emoji}
                onClick={() => addSticker({ emoji })}
                aria-label={`Add ${emoji} sticker`}
                className="shrink-0 rounded-xl p-1.5 text-3xl leading-none transition-transform active:scale-125"
              >
                {emoji}
              </button>
            ))}
          </div>

          {watermarks.length > 0 && (
            <p className="mt-2 text-center text-[11px] text-fairway-100/50">
              This venue adds its branding to saved photos.
            </p>
          )}

          {editorError && (
            <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {editorError}
            </div>
          )}

          <div className="mt-4 space-y-2">
            <Button onClick={() => void onSave()} disabled={saving || !venueReady} sound="cup">
              {saving
                ? 'Saving…'
                : editor.editingId
                  ? '✅ Save changes'
                  : '✅ Save to camera roll'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void onShareFromEditor()}
              disabled={saving || !venueReady}
            >
              📤 Share
            </Button>
            {!venueReady && (
              <p className="text-center text-[11px] text-fairway-100/50">
                Connecting to this venue to apply its branding…
              </p>
            )}
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
