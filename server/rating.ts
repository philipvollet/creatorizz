// How well a post does against the same person's earlier posts on the same platform.
//
// Posts are compared at equal footing: a post's engagement so far is projected to its
// lifetime with a typical decay curve (most LinkedIn engagement lands in the first day, most of
// X's within hours), then set against the median lifetime engagement of the previous posts.

export type Rating = 'hot' | 'good' | 'meh' | 'shit';

const H = 3600_000;

/** Hours for engagement to reach ~63% of its lifetime total, per platform. */
export const TAU_H: Record<string, number> = { linkedin: 24, x: 6, instagram: 24, tiktok: 48, youtube: 72, reddit: 24 };

/** How many earlier posts form the baseline, and how many are needed before rating at all. */
const BASELINE_POSTS = 10;
const MIN_BASELINE = 3;

/** Multiples of the usual post. */
export const THRESHOLDS: [Rating, number][] = [
  ['hot', 2],
  ['good', 1.1],
  ['meh', 0.5],
];

export interface RatedInput {
  platform: string;
  handle: string;
  postedAt: string;
  score: number;
  /** When the latest score was read. */
  seenAt: string | null;
}

export interface PostRating {
  rating: Rating | null;
  /** This post's projected lifetime engagement over the usual post's. */
  ratio: number | null;
  /** The usual post's lifetime engagement (median of the baseline). */
  usual: number | null;
  /** This post's projected lifetime engagement. */
  projected: number;
  /** Younger than its platform's typical engagement window: the rating is mostly projection. */
  early: boolean;
}

/** Share of lifetime engagement a post has typically reached at this age. */
function reached(platform: string, ageH: number): number {
  const tau = TAU_H[platform] ?? 24;
  // Floor so a post minutes old isn't projected from almost nothing (at most 4x what it has).
  return Math.max(0.25, 1 - Math.exp(-Math.max(ageH, 0) / tau));
}

const ageHours = (p: RatedInput) => (p.seenAt ? (Date.parse(p.seenAt) - Date.parse(p.postedAt)) / H : 0);

export function projectLifetime(p: RatedInput): number {
  return p.seenAt ? p.score / reached(p.platform, ageHours(p)) : p.score;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Rates every post against the posts that came before it on the same account. */
export function ratePosts<T extends RatedInput>(posts: T[]): Map<T, PostRating> {
  const out = new Map<T, PostRating>();
  const byAccount = new Map<string, T[]>();
  for (const p of posts) {
    const k = `${p.platform}:${p.handle}`;
    byAccount.set(k, [...(byAccount.get(k) ?? []), p]);
  }
  for (const list of byAccount.values()) {
    const ordered = [...list].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
    const projected = ordered.map(projectLifetime);
    ordered.forEach((p, i) => {
      const before = projected.slice(Math.max(0, i - BASELINE_POSTS), i);
      const early = ageHours(p) < (TAU_H[p.platform] ?? 24);
      if (before.length < MIN_BASELINE) {
        out.set(p, { rating: null, ratio: null, usual: null, projected: projected[i], early });
        return;
      }
      const usual = median(before);
      const ratio = projected[i] / Math.max(usual, 1);
      const rating = THRESHOLDS.find(([, min]) => ratio >= min)?.[0] ?? 'shit';
      out.set(p, { rating, ratio, usual, projected: projected[i], early });
    });
  }
  return out;
}
