import { useEffect, useRef } from 'react';
import { generate } from 'lean-qr';

// QR code for the join link, rendered client-side onto a canvas (lean-qr is a
// tiny zero-dependency generator). White quiet zone + dark modules regardless
// of theme so any phone camera reads it.
export default function JoinQr({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    generate(url).toCanvas(canvas);
  }, [url]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="QR code to join this game"
      className="h-40 w-40 rounded-xl bg-white p-2"
      // lean-qr sizes the canvas to the module count; CSS scales it up. Crisp
      // edges keep the scaled-up modules scannable.
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
