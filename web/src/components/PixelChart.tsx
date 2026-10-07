import { useLayoutEffect, useRef } from 'react';
import { C } from '../lib/data.ts';

interface Props {
  values: number[];
  color?: string;
  /** Logical size; each logical pixel is drawn `px` CSS px wide. */
  w?: number;
  h?: number;
  px?: number;
}

/** A tiny chart drawn on a logical pixel grid: a stepped line over a striped fill. */
export function PixelChart({ values, color = C.green, w = 150, h = 40, px = 2 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current!;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w * px}px`;
    canvas.style.height = `${h * px}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    // Baseline dots, like content-visualizer's signal lines.
    ctx.fillStyle = C.gray;
    for (let x = 0; x < w; x += 3) ctx.fillRect(x, h - 1, 1, 1);
    if (!values.length) return;

    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    const y = (v: number) => Math.round(h - 3 - ((v - lo) / span) * (h - 6));
    const step = w / values.length;

    let prevY = y(values[0]);
    values.forEach((v, i) => {
      const x0 = Math.round(i * step);
      const x1 = Math.round((i + 1) * step);
      const yy = y(v);
      ctx.fillStyle = color;
      for (let x = x0; x < x1; x++) {
        for (let fy = yy + 2; fy < h - 1; fy += 2) {
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x, fy, 1, 1);
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillRect(x0, Math.min(prevY, yy), 1, Math.abs(prevY - yy) + 1);
      ctx.fillRect(x0, yy, x1 - x0, 1);
      prevY = yy;
    });
  }, [values, color, w, h, px]);
  return <canvas ref={ref} style={{ display: 'block', imageRendering: 'pixelated' }} />;
}

/**
 * The main graph: one stacked bar per day on the logical pixel grid, each layer striped in
 * its series colour, plus a dotted baseline. Bars stay at least 1 logical px apart.
 */
export function PixelStack({ series, h = 70, px = 2, maxW = 190 }: { series: { values: number[]; color: string }[]; h?: number; px?: number; maxW?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const n = series[0]?.values.length ?? 0;
    const bar = Math.max(1, Math.floor(maxW / Math.max(n, 1)) - 1);
    const w = Math.max(1, n * (bar + 1));
    const canvas = ref.current!;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w * px}px`;
    canvas.style.height = `${h * px}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.gray;
    for (let x = 0; x < w; x += 3) ctx.fillRect(x, h - 1, 1, 1);
    const totals = Array.from({ length: n }, (_, i) => series.reduce((s, x) => s + x.values[i], 0));
    const max = Math.max(1, ...totals);
    for (let i = 0; i < n; i++) {
      let y = h - 2;
      const x0 = i * (bar + 1);
      for (const s of series) {
        const v = s.values[i];
        if (!v) continue;
        const hh = Math.max(1, Math.round((v / max) * (h - 4)));
        ctx.fillStyle = s.color;
        // Solid top edge, striped body: the content-visualizer sprite look.
        ctx.fillRect(x0, y - hh + 1, bar, 1);
        for (let yy = y - hh + 3; yy <= y; yy += 2) ctx.fillRect(x0, yy, bar, 1);
        y -= hh;
      }
    }
  }, [series, h, px, maxW]);
  return <canvas ref={ref} style={{ display: 'block', imageRendering: 'pixelated' }} />;
}
