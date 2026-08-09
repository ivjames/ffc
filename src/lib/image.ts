// Browser-canvas image helpers, shared by every photo feature (the hunt's
// verify upload, the photo booth's editor). There is deliberately no
// server-side image processing in this app — all decoding, downscaling, and
// re-encoding happens on the phone, and the server only stores bytes.

/** Read a Blob as base64 (data: URL prefix stripped). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the photo'));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode the photo'));
    };
    img.src = url;
  });
}

// Re-encode an image at a given long-edge size and JPEG quality.
export function encodeJpeg(
  img: HTMLImageElement,
  maxDim: number,
  quality: number,
): Promise<Blob | null> {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
}

// Target blob size. base64 inflates ~33%, so a 600 KB blob is ~800 KB on the
// wire — comfortably under nginx's default 1 MB body cap AND the server's 10 MB.
const TARGET_BYTES = 600_000;

/**
 * Turn a camera File into a small upload payload. Phone photos are several MB;
 * we downscale + re-encode as JPEG, stepping size/quality down until the result
 * fits the byte budget so it reliably passes body-size limits (no 413) and uses
 * less mobile data. Falls back to the raw file only if canvas encoding is
 * entirely unavailable.
 */
export async function fileToUpload(
  file: File,
): Promise<{ base64: string; mediaType: string }> {
  try {
    const img = await loadImage(file);
    // Progressively smaller/cheaper encodings; stop at the first under budget.
    const steps: Array<[number, number]> = [
      [1280, 0.72],
      [1024, 0.68],
      [1024, 0.55],
      [800, 0.55],
      [640, 0.5],
    ];
    let best: Blob | null = null;
    for (const [dim, q] of steps) {
      const blob = await encodeJpeg(img, dim, q);
      if (!blob) continue;
      best = blob;
      if (blob.size <= TARGET_BYTES) break;
    }
    if (best) return { base64: await blobToBase64(best), mediaType: 'image/jpeg' };
    throw new Error('encode produced no output');
  } catch {
    // Last resort: send the original file (may be large; server/nginx caps apply).
    return { base64: await blobToBase64(file), mediaType: file.type || 'image/jpeg' };
  }
}

/**
 * Hand an image blob to the Web Share API as a named file, falling back to a
 * download on browsers without file sharing. Returns how it went out.
 */
export async function shareImageBlob(
  blob: Blob,
  filename: string,
  share: { title: string; text?: string },
): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: blob.type });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], ...share });
      return 'shared';
    } catch (err) {
      // AbortError = the player closed the share sheet — nothing to recover.
      if ((err as DOMException).name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
