import { useEffect, useState } from 'react';
import { PixelText } from './PixelText.tsx';
import { PixelStack } from './PixelChart.tsx';
import { C, SERIES_COLOR, type Dashboard, type SeriesKey } from '../lib/data.ts';

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** 0 to 1 over `ms`, starting when the component mounts (each cinema shot remounts it). */
function useProgress(ms: number, delay = 0) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const start = performance.now() + delay;
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, Math.max(0, (performance.now() - start) / ms));
      setP(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ms, delay]);
  return p;
}

/** A big number counting up from zero, slowing as it lands. */
export function CountUp({ to, format, px, color }: { to: number; format: (n: number) => string; px: number; color: string }) {
  const p = useProgress(1800, 250);
  const n = to * easeOut(p);
  // Whole numbers stay whole while counting; fractional targets (like 7.4X) keep their decimals.
  // Scanlines only on big numbers; at small sizes they read as broken pixels.
  return <PixelText text={format(Number.isInteger(to) ? Math.round(n) : n)} px={px} scan={px >= 6} color={color} />;
}

/**
 * The score chart building up day by day: a running total per series, stacked, revealed one
 * day at a time, so the bars climb towards the range's score.
 */
export function BuildGraph({ data, visible }: { data: Dashboard; visible: Set<SeriesKey> }) {
  const p = useProgress(5200, 600);
  const series = data.impact.series.filter((x) => visible.has(x.key));
  const days = data.impact.labels.length;
  const shown = Math.ceil(easeOut(p) * days);
  const stack = series.map((x) => {
    let run = 0;
    return { values: x.values.map((v, i) => (i < shown ? (run += v) : 0)), color: SERIES_COLOR[x.key] };
  });
  // Keep the final scale from the start, so bars rise into a fixed frame instead of rescaling.
  const finalTotal = series.reduce((t, x) => t + x.values.reduce((a, b) => a + b, 0), 0);
  // An invisible bar on the last day tops it up to the final total until the real one arrives.
  const lastShown = stack.reduce((t, x) => t + x.values[days - 1], 0);
  const frame = { values: data.impact.labels.map((_, i) => (i === days - 1 ? Math.max(0, finalTotal - lastShown) : 0)), color: 'transparent' };
  const day = data.impact.labels[Math.max(0, shown - 1)] ?? '';
  return (
    <div className="build-graph">
      <PixelStack series={[...stack, frame]} h={70} px={5} maxW={150} />
      <PixelText text={shown >= days ? 'TODAY' : day} px={3} color={C.gray} />
    </div>
  );
}
