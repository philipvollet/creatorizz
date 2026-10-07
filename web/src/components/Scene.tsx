import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';

/** The scene redraws at this rate rather than the display's (often 120 Hz on a MacBook). */
const FPS = 30;
/** Closest zoom: the camera at this fraction of its normal distance. */
const MIN_ZOOM = 0.4;
import * as THREE from 'three';
import { drawText, textWidth, GLYPH_H } from '../lib/font.ts';
import { C, PLATFORM_COLOR, fmt, platformVisible, signed, type Dashboard, type PostView, type Platform, type SeriesKey } from '../lib/data.ts';
import { beaconMaterial, flameMaterial, towerMaterial } from './towerShaders.ts';
import { StarWell } from './StarWell.tsx';
import { Spotlight } from './Spotlight.tsx';
import type { Shot } from '../lib/cinema.ts';
import { SWEEP, placeTowers } from '../lib/layout.ts';

const PACKET_COLORS = [C.red, C.fg, C.green, C.blue];
const TAU = Math.PI * 2;
const YEAR_RING = { inner: 5.7, depth: 0.16 };

// ---------- textures in the content-visualizer style ----------

const textureCache = new Map<string, THREE.Texture>();

function pixelTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const hit = textureCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, tex);
  return tex;
}

/** "Solid block with striped body": every other row filled, like the retro sprites. */
function stripes(color: string) {
  const t = pixelTexture(`stripes:${color}`, 8, 8, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillStyle = color;
    for (let y = 0; y < 8; y += 2) ctx.fillRect(0, y, 8, 1);
    ctx.fillRect(0, 0, 1, 8);
    ctx.fillRect(7, 0, 1, 8);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function label(text: string, color: string) {
  const w = textWidth(text, 1) + 2;
  const h = GLYPH_H + 2;
  const tex = pixelTexture(`label:${color}:${text}`, w, h, (ctx) => drawText(ctx, text, 1, 1, { color }));
  return { tex, aspect: w / h };
}

function Label({ text, color = C.fg, height = 0.22, position }: { text: string; color?: string; height?: number; position: [number, number, number] }) {
  const { tex, aspect } = useMemo(() => label(text, color), [text, color]);
  return (
    <sprite position={position} scale={[height * aspect, height, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

/** The profile photo, downsampled to a 40px grid so it reads as pixel art. */
function useAvatarTexture(url: string | null) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      const n = 40;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = n;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      // The coin is a cylinder tipped towards the camera, and three.js maps the image onto its
      // cap a quarter turn clockwise; drawing it a quarter turn the other way keeps faces upright.
      ctx.translate(0, n);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, 0, 0, n, n);
      const t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      setTex(t);
    };
    img.src = url;
  }, [url]);
  return tex;
}

// ---------- persona: avatar coin with platform moons ----------

interface Moon {
  platform: Platform;
  followers: number | null;
  d7: number | null;
}

function Orbit({ radius, tilt, color, speed, moon, phase }: { radius: number; tilt: number; color: string; speed: number; moon: Moon; phase: number }) {
  const group = useRef<THREE.Group>(null);
  const moonRef = useRef<THREE.Group>(null);
  const packets = useRef<THREE.InstancedMesh>(null);
  const dots = useMemo(() => {
    const n = Math.round(radius * 34);
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      pts.set([Math.cos(a) * radius, 0, Math.sin(a) * radius], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    return g;
  }, [radius]);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const packetColors = useMemo(() => PACKET_COLORS.map((c) => new THREE.Color(c)), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const a = phase + t * speed * 0.25;
    moonRef.current!.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    moonRef.current!.rotation.y = -t * 0.8;
    // Packets run along the orbit, faster when this account is growing.
    for (let i = 0; i < 6; i++) {
      const pa = a - 0.35 - i * 0.12 - ((t * speed * 0.9) % 0.12);
      tmp.position.set(Math.cos(pa) * radius, 0, Math.sin(pa) * radius);
      tmp.scale.setScalar(1 - i * 0.12);
      tmp.updateMatrix();
      packets.current!.setMatrixAt(i, tmp.matrix);
      packets.current!.setColorAt(i, packetColors[(i + Math.floor(t * 4)) % packetColors.length]);
    }
    packets.current!.instanceMatrix.needsUpdate = true;
    if (packets.current!.instanceColor) packets.current!.instanceColor.needsUpdate = true;
  });

  const size = 0.22 + Math.min(Math.log10((moon.followers ?? 0) + 1) / 5, 1) * 0.3;
  return (
    <group ref={group} rotation={[tilt, 0, tilt * 0.4]}>
      <points geometry={dots}>
        <pointsMaterial color={color} size={2} sizeAttenuation={false} transparent opacity={0.7} />
      </points>
      <instancedMesh ref={packets} args={[undefined, undefined, 6]}>
        <boxGeometry args={[0.06, 0.06, 0.06]} />
        <meshBasicMaterial />
      </instancedMesh>
      <group ref={moonRef}>
        <mesh>
          <boxGeometry args={[size, size, size]} />
          <meshBasicMaterial map={stripes(color)} />
        </mesh>
        <group rotation={[-tilt, 0, -tilt * 0.4]}>
          <Label text={fmt(moon.followers)} color={C.fg} height={0.2} position={[0, size / 2 + 0.22, 0]} />
          {moon.d7 !== null && <Label text={signed(moon.d7)} color={moon.d7 >= 0 ? C.green : C.red} height={0.14} position={[0, size / 2 + 0.44, 0]} />}
        </group>
      </group>
    </group>
  );
}

function PersonaSystem({ name, avatar, moons, position, growth, scale = 1 }: { name: string; avatar: string | null; moons: Moon[]; position: [number, number, number]; growth: number; scale?: number }) {
  const coin = useRef<THREE.Group>(null);
  const tex = useAvatarTexture(avatar);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    coin.current!.rotation.y = Math.sin(t * 0.5) * 0.6;
    coin.current!.position.y = Math.sin(t * 1.3) * 0.08;
  });
  return (
    <group position={position} scale={scale}>
      <group ref={coin}>
        <mesh key={tex ? 'avatar' : 'blank'} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.9, 0.9, 0.16, 24, 1]} />
          <meshBasicMaterial attach="material-0" map={stripes(C.green)} />
          <meshBasicMaterial attach="material-1" map={tex} color={tex ? '#fff' : C.dim} />
          <meshBasicMaterial attach="material-2" map={tex} color={tex ? '#fff' : C.dim} />
        </mesh>
      </group>
      <Label text={name} color={C.green} height={0.24} position={[0, -1.25, 0]} />
      {moons.map((m, i) => (
        <Orbit
          key={m.platform}
          radius={1.45 + i * 0.5}
          tilt={0.25 - i * 0.22}
          color={PLATFORM_COLOR[m.platform]}
          speed={0.6 + Math.max(-0.4, Math.min(growth, 1.5))}
          moon={m}
          phase={i * 2.1}
        />
      ))}
    </group>
  );
}

// ---------- city: post towers on rings, year of GitHub around it ----------

const FLAME_W = 0.34;
const FLAME_H = 0.55;

function Flame({ y, seed }: { y: number; seed: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => flameMaterial(seed), [seed]);
  const q = useMemo(() => new THREE.Quaternion(), []);
  useFrame(({ clock, camera }) => {
    mat.uniforms.uTime.value = clock.getElapsedTime();
    // Face the camera in world space, whatever the stage and tower rotation.
    const m = ref.current!;
    m.parent!.getWorldQuaternion(q);
    m.quaternion.copy(q.invert().multiply(camera.quaternion));
  });
  return (
    <mesh ref={ref} position={[0, y + FLAME_H / 2 - 0.02, 0]} material={mat}>
      <planeGeometry args={[FLAME_W, FLAME_H]} />
    </mesh>
  );
}

// 11 x 11 pixel skull, content-visualizer sprite style: 'X' bone, 'E' eye socket, '.' empty.
const SKULL = [
  '...XXXXX...',
  '.XXXXXXXXX.',
  'XXXXXXXXXXX',
  'XXEEXXXEEXX',
  'XXEEXXXEEXX',
  'XXXXX.XXXXX',
  '.XXXX.XXXX.',
  '..XXXXXXX..',
  '..X.X.X.X..',
  '..XXXXXXX..',
  '...X.X.X...',
];

/** Two frames: eye sockets dark, and lit red for the blink. */
function skullTexture(lit: boolean) {
  return pixelTexture(`skull:${lit}`, 11, 11, (ctx) => {
    SKULL.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c === '.') return;
        ctx.fillStyle = c === 'E' ? (lit ? C.red : '#111') : y % 2 ? '#d8d8d8' : C.fg;
        ctx.fillRect(x, y, 1, 1);
      }),
    );
  });
}

/** Skulls over dead content: one bobbing, or three circling when it's far below the usual post. */
function Skulls({ y, count, seed }: { y: number; count: number; seed: number }) {
  const group = useRef<THREE.Group>(null);
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const dark = useMemo(() => skullTexture(false), []);
  const lit = useMemo(() => skullTexture(true), []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + seed;
    group.current!.position.y = y + 0.2 + Math.sin(t * 1.6) * 0.04;
    sprites.current.forEach((s, i) => {
      if (!s) return;
      const a = t * 0.9 + (i / count) * Math.PI * 2;
      const r = count > 1 ? 0.18 : 0;
      s.position.set(Math.cos(a) * r, Math.sin(t * 2 + i) * 0.04, Math.sin(a) * r);
      // A short red blink every few seconds, out of step between skulls.
      (s.material as THREE.SpriteMaterial).map = Math.sin(t * 1.3 + i * 2.1) > 0.93 ? lit : dark;
    });
  });
  return (
    <group ref={group}>
      {Array.from({ length: count }, (_, i) => (
        <sprite key={i} ref={(s) => (sprites.current[i] = s)} scale={[0.15, 0.15, 1]}>
          <spriteMaterial map={dark} transparent depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

/** The hovered post's thumbnail, as pixel art floating above its tower. */
function ThumbCard({ url, y }: { url: string; y: number }) {
  const [tex, setTex] = useState<{ t: THREE.Texture; aspect: number } | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const w = 48;
      const h = Math.max(1, Math.round((w * img.height) / img.width));
      const canvas = document.createElement('canvas');
      canvas.width = w + 2;
      canvas.height = h + 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = C.fg;
      ctx.fillRect(0, 0, w + 2, h + 2);
      ctx.drawImage(img, 1, 1, w, h);
      const t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      setTex({ t, aspect: (w + 2) / (h + 2) });
    };
    img.src = url;
  }, [url]);
  if (!tex) return null;
  const height = 0.9;
  return (
    <sprite position={[0, y + 0.35 + height / 2, 0]} scale={[height * tex.aspect, height, 1]} renderOrder={10}>
      <spriteMaterial map={tex.t} depthTest={false} />
    </sprite>
  );
}

function Beacon({ color }: { color: string }) {
  const mat = useMemo(() => beaconMaterial(color), [color]);
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.getElapsedTime();
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={mat}>
      <planeGeometry args={[1.1, 1.1]} />
    </mesh>
  );
}

/**
 * One post. Its rating against the account's usual post sets the material: hot burns with a
 * flame on top, good is charged with climbing energy, meh is frozen, shit is cracked and grey
 * with skulls.
 * Posts from the last 48 hours also send out a beacon from their base.
 */
function Tower({ post, angle, radius, height: h, onPick, active }: { post: PostView; angle: number; radius: number; height: number; onPick: (p: PostView) => void; active: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => towerMaterial(PLATFORM_COLOR[post.platform], post.rating, h, (post.id * 0.618) % 1), [post.platform, post.rating, h, post.id]);
  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.getElapsedTime();
    mat.uniforms.uActive.value = THREE.MathUtils.lerp(mat.uniforms.uActive.value, active ? 1 : 0, 0.2);
    const target = active ? 1.15 : 1;
    ref.current!.scale.x = ref.current!.scale.z = THREE.MathUtils.lerp(ref.current!.scale.x, target, 0.2);
  });

  return (
    <mesh
      ref={ref}
      material={mat}
      position={[Math.cos(angle) * radius, h / 2, Math.sin(angle) * radius]}
      rotation={[0, -angle, 0]}
      // Hovering only changes the cursor; a click selects (and a second click opens), so the post
      // stays on screen while the mouse moves on to scroll or read it.
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta < 6) onPick(post);
      }}
    >
      <boxGeometry args={[0.26, h, 0.26]} />
      {post.active && (
        <group position={[0, -h / 2, 0]}>
          <Beacon color={C.yellow} />
        </group>
      )}
      {active && post.thumb && <ThumbCard url={post.thumb} y={h / 2} />}
      {post.rating === 'shit' && <Skulls y={h / 2} count={(post.ratio ?? 0) < 0.25 ? 3 : 1} seed={post.id} />}
      {post.rating === 'hot' && <Flame y={h / 2} seed={post.id % 7} />}
    </mesh>
  );
}

/**
 * A year of GitHub, one column per day: BUILD in green at the bottom, MAINTAIN in orange on
 * top, like the score graph. Days with contributions but no scored action (private work)
 * count as BUILD.
 */
function YearRing({ days }: { days: { day: string; n: number; build: number; maintain: number }[] }) {
  const build = useRef<THREE.InstancedMesh>(null);
  const maintain = useRef<THREE.InstancedMesh>(null);
  const cells = days.slice(-364);
  useEffect(() => {
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    const amount = (c: (typeof cells)[number]) => {
      const b = c.build || (c.maintain ? 0 : c.n);
      return { b, total: b + c.maintain };
    };
    const max = Math.max(4, ...cells.map((c) => amount(c).total));
    const place = (m: THREE.InstancedMesh, i: number, a: number, r: number, y0: number, h: number, color: string, glow: number) => {
      tmp.position.set(Math.cos(a) * r, y0 + h / 2, Math.sin(a) * r);
      tmp.rotation.set(0, -a, 0);
      tmp.scale.set(h > 0 ? 1 : 0, Math.max(h, 0.0001), h > 0 ? 1 : 0);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, col.set(color).multiplyScalar(glow));
    };
    cells.forEach((c, i) => {
      const a = -Math.PI / 2 + (Math.floor(i / 7) / 52) * SWEEP;
      const r = YEAR_RING.inner + (i % 7) * YEAR_RING.depth;
      const { b, total } = amount(c);
      if (!total) {
        // An empty day: a flat dark tile, so the calendar's shape still reads.
        place(build.current!, i, a, r, 0, 0.02, C.dim, 1);
        place(maintain.current!, i, a, r, 0, 0, C.dim, 1);
        return;
      }
      const h = 0.05 + (total / max) * 0.7;
      const glow = 0.4 + 0.6 * (total / max);
      const hb = (h * b) / total;
      place(build.current!, i, a, r, 0, hb, C.green, glow);
      place(maintain.current!, i, a, r, hb, h - hb, C.orange, glow);
    });
    for (const m of [build.current!, maintain.current!]) {
      m.count = cells.length;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, [cells]);
  return (
    <>
      <instancedMesh ref={build} args={[undefined, undefined, 371]}>
        <boxGeometry args={[0.13, 1, 0.13]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={maintain} args={[undefined, undefined, 371]}>
        <boxGeometry args={[0.13, 1, 0.13]} />
        <meshLambertMaterial />
      </instancedMesh>
    </>
  );
}

function Floor() {
  const geo = useMemo(() => {
    const pts: number[] = [];
    for (let r = 1; r <= 7.4; r += 0.55) {
      const n = Math.round(r * 18);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        pts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <points geometry={geo}>
      <pointsMaterial color={C.gray} size={1.5} sizeAttenuation={false} transparent opacity={0.45} />
    </points>
  );
}

function NowMarker() {
  const a = -Math.PI / 2 + SWEEP;
  return (
    <group>
      <mesh position={[Math.cos(a) * 4.4, 0.01, Math.sin(a) * 4.4]} rotation={[-Math.PI / 2, 0, -a]}>
        <planeGeometry args={[3.6, 0.03]} />
        <meshBasicMaterial color={C.green} />
      </mesh>
      <Label text="NOW" color={C.green} height={0.22} position={[Math.cos(a) * 7.7, 0.3, Math.sin(a) * 7.7]} />
      <Label text="365D" color={C.gray} height={0.16} position={[0, 0.25, -YEAR_RING.inner - 1.6]} />
    </group>
  );
}

// ---------- camera and stage ----------

interface Stops {
  towers: Map<number, { angle: number; radius: number; height: number }>;
  personas: Map<string, THREE.Vector3>;
  stars: THREE.Vector3[];
}

/**
 * The camera. Normally it sits back and follows the mouse a little while the stage turns. In
 * attract mode it flies between the shots of the tour instead, never cutting: position and
 * aim both ease towards each shot, and the stage holds still so towers stay where they are.
 */
/** Asks for a new frame FPS times a second; with frameloop="demand" nothing else redraws. */
function FrameCap() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const t = setInterval(() => invalidate(), 1000 / FPS);
    return () => clearInterval(t);
  }, [invalidate]);
  return null;
}

function Rig({ dragging, paused, zoom, shot, stops, focusY }: {
  dragging: { current: { dx: number; active: boolean } };
  paused: boolean;
  zoom: { current: number };
  /** Height of the profile coin(s), which zooming in steers towards. */
  focusY: number;
  shot: Shot | null;
  stops: Stops;
}) {
  const { camera, pointer, scene, size } = useThree();
  const look = useRef(new THREE.Vector3(0, 0.9, 0));
  const target = useMemo(() => new THREE.Vector3(), []);
  const aim = useMemo(() => new THREE.Vector3(), []);
  const shotStart = useRef({ shot: null as Shot | null, t: 0 });
  useFrame(({ clock }, dt) => {
    // Easing per second, not per frame, so the frame cap doesn't slow the camera down.
    const ease = (f: number) => 1 - Math.pow(1 - f, dt * 60);
    const d = dragging.current!;
    const stage = scene.getObjectByName('stage');
    if (stage) {
      // Hold still while a post is selected (so it stays where it was clicked) and during the tour.
      stage.rotation.y += d.active ? d.dx : paused || shot ? 0 : dt * 0.035;
      d.dx = 0;
    }
    // Pull back on tall, narrow screens so the whole city stays in view.
    const far = Math.max(1, 1.5 / (size.width / size.height)) * zoom.current;

    if (!shot) {
      // Zooming in steers from the middle of the city towards the profile coin, and levels the
      // camera out, so up close the coin and the star well above it are both in view.
      const zi = THREE.MathUtils.clamp((1 - zoom.current) / (1 - MIN_ZOOM), 0, 1);
      const lookY = THREE.MathUtils.lerp(0.9, focusY + 1.2, zi);
      const rise = THREE.MathUtils.lerp(7.5, 3, zi);
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, pointer.x * 1.2 * (1 - zi * 0.6), ease(0.03));
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, lookY + rise * far + pointer.y * 0.8, ease(0.03));
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, 15.5 * far, ease(0.05));
      look.current.lerp(aim.set(0, lookY, 0), ease(0.05));
      camera.lookAt(look.current);
      return;
    }

    if (shotStart.current.shot !== shot) shotStart.current = { shot, t: clock.getElapsedTime() };
    const t = clock.getElapsedTime() - shotStart.current.t;
    const theta = stage?.rotation.y ?? 0;
    // Stage-local to world: the stage only ever turns about Y.
    const world = (x: number, y: number, z: number) => aim.set(x * Math.cos(theta) + z * Math.sin(theta), y, -x * Math.sin(theta) + z * Math.cos(theta));

    switch (shot.kind) {
      case 'orbit': {
        const a = 0.6 + t * 0.07;
        target.set(Math.cos(a) * 15 * far, 6.5 * far, Math.sin(a) * 15 * far);
        aim.set(0, 0.8, 0);
        break;
      }
      case 'tower': {
        const tw = stops.towers.get(shot.postId);
        if (!tw) break;
        // Stand off the tower, slightly outside and above its top, drifting round it.
        const a = tw.angle + 0.5 + t * 0.05;
        const r = tw.radius + 2.6;
        world(Math.cos(a) * r, tw.height * 0.7 + 1.1, Math.sin(a) * r);
        target.copy(aim);
        world(Math.cos(tw.angle) * tw.radius, tw.height * 0.6, Math.sin(tw.angle) * tw.radius);
        break;
      }
      case 'persona': {
        const p = stops.personas.get(shot.personaId);
        if (!p) break;
        target.set(p.x + Math.sin(t * 0.12) * 2.2, p.y + 0.5, p.z + 3.4);
        aim.copy(p);
        break;
      }
      case 'ring': {
        // Skim low along the year of GitHub, looking ahead.
        const a = -Math.PI / 2 + 0.3 + t * 0.06;
        world(Math.cos(a) * 6.9, 0.85, Math.sin(a) * 6.9);
        target.copy(aim);
        world(Math.cos(a + 0.55) * 6.1, 0.25, Math.sin(a + 0.55) * 6.1);
        break;
      }
      case 'activity': {
        // Low and slow across the city, towers against the sky.
        const a = 4 + t * 0.06;
        target.set(Math.cos(a) * 11 * far, 2.6 * far, Math.sin(a) * 11 * far);
        aim.set(0, 1.4, 0);
        break;
      }
      case 'graph': {
        const a = 2.2 + t * 0.05;
        target.set(Math.cos(a) * 17 * far, 9 * far, Math.sin(a) * 17 * far);
        aim.set(0, 1.5, 0);
        break;
      }
      case 'stars': {
        // Face the star well from just below and in front, drifting sideways.
        const st = stops.stars[0];
        if (!st) break;
        target.set(st.x + Math.sin(t * 0.12) * 2.2, st.y - 0.8, st.z + 5.2);
        aim.copy(st);
        break;
      }
      case 'above': {
        const a = t * 0.04;
        target.set(Math.sin(a) * 2.5, 19 * far, Math.cos(a) * 2.5);
        aim.set(0, 0, 0);
        break;
      }
    }
    camera.position.lerp(target, ease(0.018));
    look.current.lerp(aim, ease(0.03));
    camera.lookAt(look.current);
  });
  return null;
}

export function Scene({ data, onPick, onClear, selected, visible, shot = null }: { data: Dashboard; onPick: (p: PostView) => void; onClear: () => void; selected: PostView | null; visible: Set<SeriesKey>; shot?: Shot | null }) {
  const drag = useRef({ dx: 0, active: false, x: 0, downX: 0, downY: 0 });
  // Camera distance multiplier: below 1 is closer. Wheel, trackpad pinch and two-finger pinch.
  const zoom = useRef(1);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const zoomBy = (f: number) => {
    zoom.current = THREE.MathUtils.clamp(zoom.current * f, MIN_ZOOM, 3);
  };
  // Native and non-passive, so a trackpad pinch (a wheel event with ctrlKey) zooms the scene
  // instead of the whole page.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof HTMLCanvasElement) || !e.target.closest('.scene')) return;
      e.preventDefault();
      zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
  const from = Date.parse(data.range.from);
  const span = Date.now() - from;
  // Only what the score tile shows: switching a series off clears its towers, crowd and moon.
  const posts = useMemo(
    () => data.posts.filter((p) => Date.parse(p.postedAt) >= from && platformVisible(visible, p.platform)),
    [data.posts, from, visible],
  );
  const showGithub = platformVisible(visible, 'github');
  const momentum = data.totals.momentum ?? 0;
  const maxScore = useMemo(() => Math.max(1, ...posts.map((p) => p.score)), [posts]);
  const placed = useMemo(() => placeTowers(posts, from, span, maxScore), [posts, from, span, maxScore]);

  // One persona sits in the middle at full size; a group floats as a ring of smaller systems.
  const many = data.personas.length > 1;
  const personaScale = many ? Math.max(0.4, 1.1 - data.personas.length * 0.09) : 1;
  const ringR = many ? 1.2 + data.personas.length * 0.4 : 0;
  const personas = data.personas.map((p, i, all) => {
    const a = (i / all.length) * TAU - Math.PI / 2;
    return {
      ...p,
      scale: personaScale,
      position: [Math.cos(a) * ringR, many ? 3.2 : 2.6, Math.sin(a) * ringR] as [number, number, number],
      moons: p.accounts.filter((acc) => platformVisible(visible, acc.platform)).map((acc) => ({ platform: acc.platform, followers: acc.followers, d7: acc.delta.d7 })),
      growth: momentum,
    };
  });

  // A star well per tracked repository, floating above the city, side by side.
  const repos = visible.has('stars') ? data.github.repos.filter((r) => r.totals) : [];
  const wells = repos.map((r, i) => ({ r, position: [(i - (repos.length - 1) / 2) * 4.5, 5.3, -3.5] as [number, number, number] }));

  // Where the attract-mode tour can stop: each tower (stage-local), persona and star well (world).
  const stops: Stops = {
    towers: new Map(placed.map((rp) => [rp.post.id, { angle: rp.angle, radius: rp.radius, height: rp.height }])),
    personas: new Map(personas.map((p) => [p.id, new THREE.Vector3(...p.position)])),
    stars: wells.map((w) => new THREE.Vector3(...w.position)),
  };

  return (
    <Canvas
      className="scene"
      dpr={0.5}
      frameloop="demand"
      gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}
      camera={{ position: [0, 8.4, 15.5], fov: 40, far: 400 }}
      onPointerDown={(e) => {
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        drag.current.active = touches.current.size === 1;
        drag.current.x = drag.current.downX = e.clientX;
        drag.current.downY = e.clientY;
        pinch.current = 0;
      }}
      onPointerMove={(e) => {
        if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.current.size === 2) {
          const [a, b] = [...touches.current.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch.current) zoomBy(pinch.current / d);
          pinch.current = d;
          return;
        }
        if (!drag.current.active) return;
        drag.current.dx += (e.clientX - drag.current.x) * 0.006;
        drag.current.x = e.clientX;
      }}
      onPointerUp={(e) => {
        touches.current.delete(e.pointerId);
        drag.current.active = false;
      }}
      onPointerCancel={(e) => touches.current.delete(e.pointerId)}
      // A click on empty space (not the end of a drag) clears the selection.
      onPointerMissed={(e) => {
        if (Math.hypot(e.clientX - drag.current.downX, e.clientY - drag.current.downY) < 6) onClear();
      }}
      onPointerLeave={(e) => {
        touches.current.delete(e.pointerId);
        drag.current.active = false;
      }}
    >
      <ambientLight intensity={1.6} />
      <directionalLight position={[5, 8, 4]} intensity={2.2} />
      <FrameCap />
      <Rig dragging={drag} paused={selected !== null} zoom={zoom} shot={shot} stops={stops} focusY={many ? 3.2 : 2.6} />
      {personas.map((p) => (
        <PersonaSystem key={p.id} name={p.name} avatar={p.avatar} moons={p.moons} position={p.position} growth={p.growth} scale={p.scale} />
      ))}
      {wells.map(({ r, position }) => (
        <group key={r.repo}>
          <StarWell position={position} gained={r.gained.stars} today={r.starsToday} />
          <Label text={`${fmt(r.totals!.stars)} STARS`} color={C.yellow} height={0.32} position={[position[0], position[1] - 1.55, position[2]]} />
          <Label text={`${signed(r.gained.stars)} IN ${data.range.days}D`} color={C.fg} height={0.2} position={[position[0], position[1] - 1.95, position[2]]} />
        </group>
      ))}
      <group name="stage">
        <Floor />
        <NowMarker />
        {showGithub && <YearRing days={data.github.days} />}
        {shot?.kind === 'tower' &&
          placed
            .filter((rp) => rp.post.id === shot.postId)
            .map((rp) => (
              <Spotlight
                key={`spot-${rp.post.id}`}
                position={[Math.cos(rp.angle) * rp.radius, 0, Math.sin(rp.angle) * rp.radius]}
                height={rp.height}
                color={rp.post.rating === 'hot' ? '#ffb31a' : '#ffffff'}
              />
            ))}
        {placed.map((rp) => (
          <Tower key={rp.post.id} post={rp.post} angle={rp.angle} radius={rp.radius} height={rp.height} onPick={onPick} active={selected?.id === rp.post.id} />
        ))}
      </group>
    </Canvas>
  );
}
