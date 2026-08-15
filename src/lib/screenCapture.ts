// One-tap screen grab for the reviewer feedback widget.
//
// Uses the browser's own screen-capture API (getDisplayMedia): the reviewer
// approves a capture, we pull a SINGLE frame out of the stream, and stop the
// tracks immediately — nothing is recorded and no stream stays open. Real
// pixels, so gradients, blur, the arcade skins and any native chrome all come
// out exactly as the reviewer saw them, which is precisely what an in-page DOM
// renderer (html2canvas and friends) gets wrong on this app's CSS. It also
// costs no bundle weight.
//
// The catch is support: getDisplayMedia is a desktop-browser API. iOS Safari
// doesn't implement it at all, and neither does Chrome on Android. So this is
// strictly an upgrade for reviewers on a laptop — `isScreenCaptureSupported()`
// tells the UI whether to offer it, and the manual "attach a screenshot" file
// picker remains the path that works on every device.

/** Can this browser grab the screen itself? False on iOS/Android. */
export function isScreenCaptureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  );
}

/** Pull one frame from a live capture stream and encode it as a PNG file. */
async function grabFrame(stream: MediaStream): Promise<File | null> {
  const video = document.createElement('video');
  video.srcObject = stream;
  // Muted + playsInline so autoplay isn't blocked and iOS never goes fullscreen.
  video.muted = true;
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('capture stream would not load'));
    });
    await video.play();
    // One frame has to actually paint before the canvas has anything to copy.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);

    // PNG keeps text crisp; the upload path downscales and re-encodes to JPEG
    // anyway (src/lib/image.ts), so this only has to survive one hop.
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!blob) return null;
    return new File([blob], `screen-${Date.now()}.png`, { type: 'image/png' });
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

/**
 * Ask the browser to capture the screen and return one frame as a File.
 *
 * Resolves to null for every "no picture, carry on" outcome — unsupported
 * browser, the reviewer dismissing the picker, or a frame that wouldn't
 * encode. Declining to share your screen is a choice, not an error, so the
 * caller opens the note sheet either way and never shows a failure.
 *
 * MUST be called directly from a user gesture (a click handler): browsers
 * reject a capture request that isn't tied to one.
 */
export async function captureScreen(): Promise<File | null> {
  if (!isScreenCaptureSupported()) return null;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
      // Chrome-only hint that puts "This Tab" first in the picker, so the
      // common case is one click. Other browsers ignore unknown members.
      preferCurrentTab: true,
    } as DisplayMediaStreamOptions);
    return await grabFrame(stream);
  } catch {
    return null;
  } finally {
    // Always release the capture — otherwise the browser keeps showing its
    // "sharing your screen" indicator for the rest of the session.
    stream?.getTracks().forEach((track) => track.stop());
  }
}
