import * as THREE from 'three';
import type { Rating } from '../lib/data.ts';

/**
 * Shader mode per rating against the account's usual post: fire for hot, charged energy for
 * good, ice for meh, cracked dust for shit, and plain stripes while there is nothing to compare.
 */
export const RATING_MODE: Record<Rating | 'none', number> = { hot: 0, good: 1, meh: 2, shit: 3, none: 4 };

// Shared GLSL: hash noise snapped to a pixel grid, so every effect reads as chunky pixels
// with the content-visualizer scanlines, never as smooth gradients.
const common = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { return noise(p) * 0.6 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 + 7.1) * 0.1; }
  vec3 fireRamp(float h) {
    h = clamp(h, 0.0, 1.0);
    vec3 c = mix(vec3(0.25, 0.02, 0.0), vec3(0.91, 0.22, 0.12), smoothstep(0.0, 0.35, h));
    c = mix(c, vec3(0.94, 0.35, 0.11), smoothstep(0.35, 0.6, h));
    c = mix(c, vec3(0.96, 0.82, 0.23), smoothstep(0.6, 0.85, h));
    return mix(c, vec3(1.0, 0.97, 0.85), smoothstep(0.85, 1.0, h));
  }
`;

const towerVertex = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  void main() {
    vPos = position;
    vNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const towerFragment = /* glsl */ `
  uniform float uTime;
  uniform float uMode;
  uniform float uHeight;
  uniform float uActive;
  uniform float uSeed;
  uniform vec3 uBase;
  varying vec3 vPos;
  varying vec3 vNormal;
  ${common}

  void main() {
    // A 30-pixels-per-unit grid; the side faces use their horizontal axis.
    const float PIX = 30.0;
    float side = abs(vNormal.x) > 0.5 ? vPos.z : vPos.x;
    vec2 px = floor(vec2(side, vPos.y) * PIX) / PIX;
    float row = floor(vPos.y * PIX);
    float stripe = mod(row, 2.0);
    float y01 = clamp(vPos.y / uHeight + 0.5, 0.0, 1.0);
    float t = uTime + uSeed * 10.0;
    float shade = vNormal.y > 0.5 ? 1.15 : 0.75 + 0.25 * abs(vNormal.x);
    vec3 col;

    if (uMode < 0.5) {
      // Hot: the tower burns from the base up, embers drifting off its faces.
      float n = fbm(vec2(px.x * 9.0, px.y * 7.0 - t * 2.6));
      float heat = clamp((y01 + 0.15) / 1.15 + (n - 0.5) * 0.9, 0.0, 1.0);
      vec3 body = uBase * (0.35 + 0.65 * stripe);
      col = mix(body, fireRamp(heat + 0.15 * stripe), smoothstep(0.08, 0.4, heat));
      float ember = step(0.985, hash(floor(vec2(px.x * PIX, (vPos.y - t * 0.4) * PIX))));
      col += ember * vec3(1.0, 0.6, 0.2);
    } else if (uMode < 1.5) {
      // Good: charged. Bands of green energy climb the post's colour, with sparks at the front.
      float band = fract(y01 * 3.0 - t * 0.6);
      float glow = smoothstep(0.75, 1.0, band);
      vec3 body = uBase * (0.4 + 0.6 * stripe);
      vec3 energy = vec3(0.27, 0.82, 0.25);
      col = mix(body, energy * (0.8 + 0.4 * stripe), 0.25 + 0.65 * glow);
      float spark = step(0.988, hash(floor(px * PIX) + floor(t * 6.0))) * glow;
      col += spark * vec3(0.8, 1.0, 0.7);
    } else if (uMode < 2.5) {
      // Meh: frozen. Ice facets over the post's colour, frost creeping in from the edges, sparkles.
      float facet = floor(noise(px * 7.0 + uSeed) * 4.0) / 4.0;
      vec3 ice = mix(vec3(0.55, 0.85, 1.0), vec3(0.85, 0.97, 1.0), facet);
      float frost = smoothstep(0.35, 0.0, min(y01, 1.0 - y01)) * 0.6 + facet * 0.4;
      col = mix(uBase * (0.4 + 0.6 * stripe), ice * (0.7 + 0.3 * stripe), 0.55 + 0.35 * frost);
      float sparkle = step(0.992, hash(floor(px * PIX) + floor(t * 3.0)));
      col += sparkle * vec3(1.0);
    } else if (uMode < 3.5) {
      // Shit: drained of colour, cracked, dust settling, the odd dead pixel flickering.
      float grey = dot(uBase, vec3(0.3, 0.59, 0.11)) * 0.3 + 0.16;
      float dust = hash(floor(px * PIX) + floor(t * 0.7)) * 0.12;
      col = vec3(grey + dust) * (0.55 + 0.45 * stripe);
      float crack = step(0.82, noise(vec2(px.x * 40.0 + px.y * 13.0, px.y * 9.0) + uSeed * 5.0)) * step(0.5, noise(px * 6.0 + uSeed));
      col *= 1.0 - 0.75 * crack;
      float dead = step(0.997, hash(floor(px * PIX) * 1.3 + floor(t * 8.0)));
      col = mix(col, vec3(0.04), dead);
    } else {
      // Not rated yet: the plain striped sprite body.
      col = uBase * (0.3 + 0.7 * stripe);
    }

    col *= shade;
    col = mix(col, vec3(1.0), uActive * 0.35 * stripe);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function towerMaterial(base: string, rating: Rating | null, height: number, seed: number) {
  return new THREE.ShaderMaterial({
    vertexShader: towerVertex,
    fragmentShader: towerFragment,
    uniforms: {
      uTime: { value: 0 },
      uMode: { value: RATING_MODE[rating ?? 'none'] },
      uHeight: { value: height },
      uActive: { value: 0 },
      uSeed: { value: seed },
      uBase: { value: new THREE.Color(base) },
    },
  });
}

const beaconVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const beaconFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    // Pixel rings rippling out from the tower's foot: this post went out in the last 48 hours.
    vec2 g = floor(vUv * 24.0) / 24.0 - 0.5;
    float r = length(g) * 2.0;
    if (r > 1.0) discard;
    float wave = fract(r * 2.0 - uTime * 0.8);
    float ring = step(0.82, wave) * (1.0 - r);
    if (ring < 0.05) discard;
    gl_FragColor = vec4(uColor, ring);
  }
`;

/** Flat rings rippling out from an active post's base. */
export function beaconMaterial(color: string) {
  return new THREE.ShaderMaterial({
    vertexShader: beaconVertex,
    fragmentShader: beaconFragment,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    transparent: true,
    depthWrite: false,
  });
}

const flameVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flameFragment = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  ${common}

  void main() {
    // A 12 x 20 pixel flame: noise rising, pinched towards the tip.
    vec2 g = floor(vUv * vec2(12.0, 20.0)) / vec2(12.0, 20.0);
    float t = uTime * 2.4 + uSeed * 10.0;
    float n = fbm(vec2(g.x * 5.0, g.y * 4.0 - t));
    float width = (1.0 - g.y) * 0.55 + 0.05;
    float body = 1.0 - abs(g.x - 0.5 + (n - 0.5) * 0.25 * g.y) / width;
    float heat = body * (1.0 - g.y * 0.9) + (n - 0.5) * 0.6;
    if (heat < 0.25) discard;
    gl_FragColor = vec4(fireRamp(heat), 1.0);
  }
`;

/** The flame that stands on top of hot towers, always facing the camera. */
export function flameMaterial(seed: number) {
  return new THREE.ShaderMaterial({
    vertexShader: flameVertex,
    fragmentShader: flameFragment,
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
