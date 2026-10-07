// Where things stand in the city. Pure functions, so they can be tested without three.js.
import type { Platform, PostView } from './data.ts';

/** Post towers sweep this much of the circle from the start of the range to now; the gap marks "now". */
export const SWEEP = Math.PI * 2 * 0.88;

/** Each platform's posts stand on their own ring of the city. */
export const LANE: Record<Platform, number> = { linkedin: 2.6, x: 3.05, instagram: 3.5, tiktok: 3.95, youtube: 4.4, reddit: 4.85, github: 5.2 };

/**
 * Height is proportional to engagement: the biggest post in view stands TALLEST high and the rest
 * scale linearly from there, so 300 likes really is a hundred times 3. A small floor keeps
 * posts with almost no engagement visible and hoverable.
 */
export const TALLEST = 3.2;
export function towerHeight(score: number, maxScore: number) {
  return Math.max(0.12, (score / Math.max(maxScore, 1)) * TALLEST);
}

/** Towers closer than this (centre to centre) would overlap; footprint is 0.26 plus a gap. */
export const TOWER_GAP = 0.38;
/** Radial steps tried when a spot is taken: its own ring first, then just outside and inside. */
const RADIAL_STEPS = [0, 0.38, -0.38, 0.76, -0.76];

/**
 * Where each post's tower stands: its angle is its date, its ring its platform. Posts that went
 * out close together would stand on the same spot, so a tower whose spot is taken steps just
 * off its ring, and failing that, a little further along it, until it is clear of every other.
 */
export function placeTowers(posts: PostView[], from: number, span: number, maxScore: number) {
  const out: { post: PostView; angle: number; radius: number; height: number }[] = [];
  const clear = (a: number, r: number) =>
    out.every((o) => Math.hypot(Math.cos(a) * r - Math.cos(o.angle) * o.radius, Math.sin(a) * r - Math.sin(o.angle) * o.radius) >= TOWER_GAP);
  // Oldest first, so the newest posts are the ones nudged and long-standing towers stay put.
  for (const p of [...posts].sort((a, b) => a.postedAt.localeCompare(b.postedAt))) {
    const base = -Math.PI / 2 + ((Date.parse(p.postedAt) - from) / span) * SWEEP;
    const lane = LANE[p.platform];
    let spot = { angle: base, radius: lane };
    search: for (let shift = 0; shift < 12; shift++) {
      const a = base + (shift * TOWER_GAP) / lane;
      for (const dr of RADIAL_STEPS) {
        if (clear(a, lane + dr)) {
          spot = { angle: a, radius: lane + dr };
          break search;
        }
      }
    }
    out.push({ post: p, ...spot, height: towerHeight(p.score, maxScore) });
  }
  return out;
}
