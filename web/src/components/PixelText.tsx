import { useLayoutEffect, useRef } from 'react';
import { drawText, GLYPH_H, textWidth, wrap } from '../lib/font.ts';

interface Props {
  text: string;
  /** Size of one font pixel in CSS px. */
  px?: number;
  color?: string;
  scan?: boolean;
  /** Wrap to this width in CSS px. */
  maxWidth?: number;
  maxLines?: number;
  className?: string;
  title?: string;
}

/**
 * Text in content-visualizer's 5x7 bitmap font, drawn on a canvas at device resolution so
 * every font pixel lands on whole screen pixels.
 */
export function PixelText({ text, px = 2, color = '#fff', scan = false, maxWidth, maxLines, className, title }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = ref.current!;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const unit = px * dpr;
    let lines = maxWidth ? wrap(text, Math.floor(maxWidth / px), 1) : [String(text).toUpperCase()];
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,3}$/, '...');
    }
    const lineH = GLYPH_H + 3;
    const w = Math.max(1, ...lines.map((l) => textWidth(l, 1)));
    const h = lines.length * lineH - 3;
    canvas.width = w * unit;
    canvas.height = h * unit;
    canvas.style.width = `${w * px}px`;
    canvas.style.height = `${h * px}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    lines.forEach((l, i) => drawText(ctx, l, 0, i * lineH * unit, { color, sx: unit, sy: unit, scan: scan && px >= 3 }));
  }, [text, px, color, scan, maxWidth, maxLines]);

  return <canvas ref={ref} className={className} role="img" aria-label={text} title={title} style={{ display: 'block', imageRendering: 'pixelated' }} />;
}
