import { useLayoutEffect, useRef } from 'react';
import { ICONS, type IconName } from '../lib/icons.ts';

/** A 7 x 7 pixel icon, drawn like the bitmap font: whole device pixels, no smoothing. */
export function PixelIcon({ name, px = 2, color = '#fff', title }: { name: IconName; px?: number; color?: string; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current!;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const unit = px * dpr;
    canvas.width = canvas.height = 7 * unit;
    canvas.style.width = canvas.style.height = `${7 * px}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ICONS[name].forEach((row, y) => [...row].forEach((c, x) => c === 'X' && ctx.fillRect(x * unit, y * unit, unit, unit)));
  }, [name, px, color]);
  return <canvas ref={ref} className="pixel-icon" role="img" aria-label={title ?? name} title={title} style={{ display: 'block', imageRendering: 'pixelated', flex: 'none' }} />;
}
