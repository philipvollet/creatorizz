import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beaconMaterial } from './towerShaders.ts';

// The cinema spotlight on a post: a pixel light beam whose bands stream upward, green chevrons
// climbing the tower, and shockwave rings from its base. Everything moves up: the post is rising.

const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    // Snapped to a coarse grid so the light reads as pixels, not a gradient.
    vec2 g = floor(vUv * vec2(24.0, 60.0)) / vec2(24.0, 60.0);
    float band = step(0.55, fract(g.y * 9.0 - uTime * 1.4));
    float fade = (1.0 - g.y) * (1.0 - g.y);
    float a = fade * (0.3 + 0.5 * band);
    gl_FragColor = vec4(uColor, a);
  }
`;

const chevronVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPx;
  uniform float uHeight;
  attribute float aSeed;
  varying float vFade;
  void main() {
    // Up the tower and past its top, round and round, then from the base again.
    float life = fract(uTime * 0.35 + aSeed);
    float side = floor(aSeed * 4.0) * 1.5708;
    vec3 p = vec3(cos(side) * 0.42, life * (uHeight + 1.6), sin(side) * 0.42);
    vFade = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.75, 1.0, life));
    gl_PointSize = 7.0 * uPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const chevronFragment = /* glsl */ `
  varying float vFade;
  void main() {
    // A 7 x 7 up-chevron, drawn in the point sprite.
    vec2 c = floor(gl_PointCoord * 7.0);
    float x = abs(c.x - 3.0);
    float y = c.y;
    bool on = (y == x + 1.0 || y == x + 2.0) && y < 6.0;
    if (!on) discard;
    gl_FragColor = vec4(0.27, 0.82, 0.25, vFade);
  }
`;

export function Spotlight({ position, height, color }: { position: [number, number, number]; height: number; color: string }) {
  const beam = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [color],
  );
  const chevrons = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: chevronVertex,
        fragmentShader: chevronFragment,
        uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uHeight: { value: height } },
        transparent: true,
        depthWrite: false,
      }),
    [height],
  );
  const chevronGeo = useMemo(() => {
    const n = 16;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(Array.from({ length: n }, (_, i) => i / n), 1));
    return g;
  }, []);
  const rings = useMemo(() => beaconMaterial(color), [color]);

  useFrame(({ clock, gl }) => {
    const t = clock.getElapsedTime();
    beam.uniforms.uTime.value = t;
    chevrons.uniforms.uTime.value = t;
    chevrons.uniforms.uPx.value = Math.max(1, gl.getPixelRatio() * 2);
    rings.uniforms.uTime.value = t * 1.6;
  });

  const beamHeight = 14;
  return (
    <group position={position}>
      <mesh position={[0, beamHeight / 2, 0]} material={beam}>
        <cylinderGeometry args={[0.55, 0.3, beamHeight, 16, 1, true]} />
      </mesh>
      <points geometry={chevronGeo} material={chevrons} frustumCulled={false} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} material={rings}>
        <planeGeometry args={[3.2, 3.2]} />
      </mesh>
    </group>
  );
}
