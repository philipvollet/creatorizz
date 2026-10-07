import { useState } from 'react';
import { Shader, Aurora, DotGrid, Dither, CRTScreen, SolidColor } from 'shaders/react';
import { C } from '../lib/data.ts';

/**
 * The CRT sky behind the 3D scene (WebGPU, via shaders). It tints with momentum: green and
 * blue on an up week, red and orange on a down week. Without WebGPU it falls back to CSS.
 */
export function Backdrop({ momentum }: { momentum: number | null }) {
  const [failed, setFailed] = useState(false);
  const m = momentum ?? 0;
  const [a, b, c] = m > 0.05 ? [C.green, C.blue, '#0a3d12'] : m < -0.05 ? [C.red, C.orange, '#3d0a05'] : [C.blue, C.gray, '#101830'];

  if (failed) return <div className="backdrop backdrop-fallback" style={{ ['--tint' as string]: a }} />;

  return (
    <Shader className="backdrop" disableTelemetry colorSpace="srgb" onUnavailable={() => setFailed(true)}>
      <SolidColor color={C.bg} />
      <Aurora colorA={a} colorB={b} colorC={c} intensity={55 + Math.abs(m) * 35} speed={2} curtainCount={3} height={90} />
      <DotGrid color={C.gray} density={70} dotSize={0.12} twinkle={0.4} opacity={0.35} />
      <Dither pattern="bayer4" pixelSize={3} colorMode="source" />
      <CRTScreen pixelSize={256} scanlineIntensity={0.45} scanlineFrequency={260} vignetteIntensity={1.2} brightness={1} contrast={1.1} colorShift={0.6} />
    </Shader>
  );
}
