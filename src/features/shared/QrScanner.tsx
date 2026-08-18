import { useCallback, useEffect, useRef, useState } from 'react';

// Camera viewfinder that reads a QR code, for players who are already inside
// the app when the host holds up the tablet.
//
// Two decoders, in this order:
//   • BarcodeDetector — built into Chrome/Android, costs nothing to use.
//   • jsQR — imported ONLY when the native one is missing, which is every
//     iPhone. Loading it lazily keeps ~45kb out of the bundle for the players
//     who never open the scanner; the service worker precaches the chunk, so
//     it still resolves on venue wifi that has given up.
//
// The camera is the whole reason this component can misbehave, so:
//   • every exit path stops the tracks (a viewfinder left running is a hot
//     phone and a recording light nobody asked for),
//   • the video is muted + playsInline, without which iOS refuses to play it
//     inline and takes over the screen,
//   • a decode runs every OTHER frame — a full-rate loop drains battery for
//     no gain, since nobody moves a phone that fast.

type Props = {
  /** Raw text of the first code we could read. */
  onResult: (text: string) => void;
  onCancel: () => void;
  /** Return false to keep looking — for codes that aren't ours (the menu QR
   *  on the next table). Default accepts anything. */
  accept?: (text: string) => boolean;
};

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function nativeDetector(): BarcodeDetectorLike | null {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

/** Why the camera isn't running — phrased for a player in a loud room, not a
 *  developer. Null while it's fine. */
function cameraProblem(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return "This phone blocked camera access. Allow it in your browser settings, or type the code instead.";
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return "Couldn't find a camera on this phone — type the code instead.";
  }
  return "Couldn't start the camera — type the code instead.";
}

export default function QrScanner({ onResult, onCancel, accept }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Stops the CURRENT effect run's camera. Held in a ref so the Cancel button
  // and a successful read can close it, but owned by the run that opened it —
  // see the comment on `cancelled` below for why that distinction matters.
  const haltRef = useRef<() => void>(() => {});
  const stop = useCallback(() => haltRef.current(), []);

  useEffect(() => {
    let raf = 0;
    // Per-RUN, deliberately not a ref shared across runs. React invokes an
    // effect, cleans it up, and invokes it again on mount (StrictMode, and any
    // quick remount does the same), so two getUserMedia calls can be in flight
    // at once. With a shared flag the second run's re-arming let the FIRST
    // run's stream pass its "am I still wanted" check and overwrite the
    // second's — orphaning a live camera track, which is a hot phone and a
    // recording light that never goes out. Each run now owns its own stream
    // and its own cancelled flag, so a late arrival can only stop itself.
    let cancelled = false;
    let stream: MediaStream | null = null;

    const halt = () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };
    haltRef.current = halt;
    let frame = 0;
    let jsQR: ((d: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const native = nativeDetector();

    async function decode(video: HTMLVideoElement): Promise<string | null> {
      if (native) {
        const hits = await native.detect(video).catch(() => []);
        return hits[0]?.rawValue ?? null;
      }
      if (!ctx) return null;
      // Lazy, and only on the platforms without the native detector.
      if (!jsQR) jsQR = (await import('jsqr')).default;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(image.data, image.width, image.height)?.data ?? null;
    }

    async function start() {
      try {
        // `environment` asks for the rear camera; a phone without one falls
        // back to whatever it has rather than failing.
        const opened = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        // Torn down while the permission prompt was up: stop what we opened
        // and leave. Only this run's `cancelled` can say so.
        if (cancelled) {
          opened.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = opened;
        const video = videoRef.current;
        if (!video) {
          halt();
          return;
        }
        video.srcObject = opened;
        await video.play().catch(() => {});
        raf = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) setError(cameraProblem(err));
      }
    }

    async function tick() {
      const video = videoRef.current;
      if (cancelled || !video) return;
      // Every other frame, and never before the camera has produced one.
      if (++frame % 2 === 0 && video.readyState >= video.HAVE_CURRENT_DATA) {
        const text = await decode(video).catch(() => null);
        if (cancelled) return;
        if (text && (!accept || accept(text))) {
          halt();
          onResult(text);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the camera — type the code instead.");
    } else {
      void start();
    }

    return () => {
      cancelAnimationFrame(raf);
      halt();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mb-4 rounded-2xl border border-fairway-700 bg-fairway-900/60 p-3">
      {error ? (
        <p className="text-sm text-fairway-100/80">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-56 w-full object-cover"
            aria-label="Camera viewfinder — point it at the game's code"
          />
          {/* A frame to aim with. Purely decorative, so it never eats a tap. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-36 w-36 rounded-xl border-2 border-white/80" />
          </div>
        </div>
      )}
      <p className="mt-2 text-center text-xs text-fairway-400">
        {error ? '' : 'Point it at the code on the host’s screen'}
      </p>
      <button
        onClick={() => {
          stop();
          onCancel();
        }}
        className="mt-2 w-full text-center text-xs text-fairway-400"
      >
        Cancel
      </button>
    </div>
  );
}
