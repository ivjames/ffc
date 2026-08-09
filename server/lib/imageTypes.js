// Image media-type allowlist shared by photo-storage routes. Lives in its own
// neutral module (rather than lib/vision.js, where the hunt's copy originated)
// so pipelines with no AI involvement — e.g. the photo booth (routes/photos.js)
// — never import from the vision layer.
export const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const EXT_BY_MEDIA = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const MEDIA_BY_EXT = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};
