import { useEffect, useRef, useState } from 'react';

/**
 * A photo as pixel art: drawn onto a small canvas (`grid` pixels across, aspect kept) and
 * scaled up without smoothing, so post thumbnails match the rest of the dashboard.
 */
export function PixelImage({ src, width, grid = 64, className }: { src: string; width: number; grid?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Nothing is shown until the picture has loaded, and nothing at all if it can't be.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const img = new Image();
    img.onerror = () => setReady(false);
    img.onload = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const h = Math.max(1, Math.round((grid * img.height) / img.width));
      canvas.width = grid;
      canvas.height = h;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${(width * h) / grid}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, 0, 0, grid, h);
      setReady(true);
    };
    img.src = src;
  }, [src, width, grid]);
  return <canvas ref={ref} className={className} style={{ display: ready ? 'block' : 'none', imageRendering: 'pixelated' }} />;
}
