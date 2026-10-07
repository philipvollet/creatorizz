import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** Halo stars are capped so a huge range never floods the GPU; the label keeps the exact count. */
const MAX_HALO = 3000;
const MAX_SHOOTERS = 60;

// ---------- the big star: a five-pointed star drawn on a pixel grid ----------

const starVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const starFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  // Distance to a five-pointed star (negative inside).
  float sdStar5(vec2 p, float r, float rf) {
    const vec2 k1 = vec2(0.809016994375, -0.587785252292);
    const vec2 k2 = vec2(-k1.x, k1.y);
    p.x = abs(p.x);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x);
    p.y -= r;
    vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
    float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    // 40 x 40 pixels; everything below is snapped to that grid.
    vec2 g = (floor(vUv * 40.0) + 0.5) / 40.0 - 0.5;
    float a = sin(uTime * 0.6) * 0.25;
    vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * g;
    float pulse = 1.0 + 0.06 * sin(uTime * 2.2);
    float d = sdStar5(p * 2.4 / pulse, 0.55, 0.45);

    vec3 col;
    float alpha = 1.0;
    if (d < -0.12) col = vec3(1.0, 0.98, 0.85);       // white-hot core
    else if (d < -0.05) col = vec3(0.98, 0.86, 0.28); // yellow
    else if (d < 0.0) col = vec3(0.94, 0.60, 0.12);   // amber rim
    else {
      // Outside: cross rays that twinkle, and a dotted glow.
      float ray = max(step(abs(g.x), 0.013) * step(abs(g.y), 0.48), step(abs(g.y), 0.013) * step(abs(g.x), 0.48));
      ray *= 0.5 + 0.5 * sin(uTime * 3.0 + length(g) * 12.0);
      float glow = step(0.5, hash(floor(vUv * 40.0) + floor(uTime * 2.0))) * smoothstep(0.12, 0.0, d) * 0.6;
      alpha = max(ray * smoothstep(0.5, 0.1, length(g)), glow);
      if (alpha < 0.05) discard;
      col = vec3(1.0, 0.9, 0.4);
    }
    // Content-visualizer scanlines across the star.
    col *= mod(floor(vUv.y * 40.0), 2.0) < 1.0 ? 1.0 : 0.82;
    gl_FragColor = vec4(col, alpha);
  }
`;

// ---------- the halo and the shooting stars ----------

const dustVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPx;
  attribute float aSeed;
  attribute float aKind;
  varying float vTwinkle;
  varying float vKind;
  varying float vLife;
  void main() {
    vec3 p;
    float size;
    if (aKind < 0.5) {
      // Halo: each new star orbits in a thick disc, tilted, at its own speed.
      float r = 1.1 + 2.2 * fract(aSeed * 7.13);
      float a = aSeed * 6.2831 * 17.0 + uTime * (0.25 / r);
      float h = (fract(aSeed * 3.7) - 0.5) * 0.9;
      p = vec3(cos(a) * r, h + sin(a) * r * 0.25, sin(a) * r);
      size = 2.0;
      vLife = 0.0;
    } else {
      // Shooting star: falls in from far out along its own line, then starts over.
      float life = fract(uTime * 0.22 + aSeed * 5.0);
      float a = aSeed * 6.2831 * 9.0;
      vec3 from = vec3(cos(a) * 9.0, 4.0 + 3.0 * fract(aSeed * 11.0), sin(a) * 9.0);
      p = mix(from, vec3(0.0), life * life);
      size = 3.0;
      vLife = life;
    }
    vTwinkle = 0.55 + 0.45 * sin(uTime * (2.0 + fract(aSeed * 13.0) * 3.0) + aSeed * 40.0);
    vKind = aKind;
    gl_PointSize = size * uPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const dustFragment = /* glsl */ `
  varying float vTwinkle;
  varying float vKind;
  varying float vLife;
  void main() {
    vec3 c = vKind < 0.5 ? mix(vec3(0.96, 0.82, 0.23), vec3(1.0), step(0.85, vTwinkle)) : vec3(1.0, 0.95, 0.7);
    float a = vKind < 0.5 ? vTwinkle : (1.0 - vLife * 0.3) * step(0.02, vLife);
    gl_FragColor = vec4(c, a);
  }
`;

/**
 * A tracked repository's stars: a big pixel star that pulses and turns, a halo of one tiny
 * star per star gained in the range, and today's stars falling in as shooting stars.
 */
export function StarWell({ position, gained, today }: { position: [number, number, number]; gained: number; today: number }) {
  const star = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: starVertex,
        fragmentShader: starFragment,
        uniforms: { uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const dust = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: dustVertex,
        fragmentShader: dustFragment,
        uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  const geo = useMemo(() => {
    const halo = Math.min(gained, MAX_HALO);
    const shooters = Math.min(today, MAX_SHOOTERS);
    const n = halo + shooters;
    const seed = new Float32Array(n);
    const kind = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      seed[i] = ((i + 1) * 0.6180339) % 1;
      kind[i] = i < halo ? 0 : 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
    return g;
  }, [gained, today]);

  const plane = useRef<THREE.Mesh>(null);
  const q = useMemo(() => new THREE.Quaternion(), []);
  useFrame(({ clock, camera, gl }) => {
    const t = clock.getElapsedTime();
    star.uniforms.uTime.value = t;
    dust.uniforms.uTime.value = t;
    dust.uniforms.uPx.value = Math.max(1, gl.getPixelRatio() * 2);
    // The star always faces the camera.
    const m = plane.current!;
    m.parent!.getWorldQuaternion(q);
    m.quaternion.copy(q.invert().multiply(camera.quaternion));
  });

  return (
    <group position={position}>
      <mesh ref={plane} material={star}>
        <planeGeometry args={[2.6, 2.6]} />
      </mesh>
      <points geometry={geo} material={dust} frustumCulled={false} />
    </group>
  );
}
