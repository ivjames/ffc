import { useEffect, type RefObject } from 'react';

// Size a fixed-aspect game canvas to the largest W:H box that fits its parent
// (the flex-1 "stage" between the HUD and any footer), so the playfield fills
// the screen instead of only its width-derived height.
//
// The canvas ELEMENT keeps the drawing's aspect ratio, so pointer handlers that
// map through getBoundingClientRect() (`(clientX - rect.left) / rect.width * W`)
// stay exact — unlike object-fit, which would letterbox the drawing inside a
// differently-shaped element and misalign aiming. The drawing buffer (set to
// W*dpr × H*dpr elsewhere) is untouched; only the CSS display size changes.
//
// Reads the parent's laid-out clientWidth/Height, which flexbox resolves to
// concrete pixels even where a CSS percentage height would not, so it works
// under the dvh-height column the play view uses.
export function useFitCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  W: number,
  H: number,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return;

    const fit = () => {
      const availW = stage.clientWidth;
      const availH = stage.clientHeight;
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(availW / W, availH / H);
      canvas.style.width = `${Math.round(W * scale)}px`;
      canvas.style.height = `${Math.round(H * scale)}px`;
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [canvasRef, W, H, active]);
}
