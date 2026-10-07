import { db, type Tier } from './db.ts';

const H = 3600_000;
// Growth of a cooling post is measured against a reading at least this old.
const GROWTH_WINDOW_H = 44;

export interface Metrics {
  likes: number;
  comments: number;
  shares: number;
  views?: number | null;
  bookmarks?: number | null;
  extra?: unknown;
}

export interface ScrapedPost {
  platformPostId: string;
  url: string | null;
  postedAt: string;
  kind: string;
  text: string | null;
  media?: unknown;
  metrics: Metrics;
}

/** One number per post. Comments and shares cost the reader more than a like, so they weigh more. */
export function engagementScore(m: { likes: number; comments: number; shares: number }): number {
  return m.likes + 2 * m.comments + 3 * m.shares;
}

/**
 * Revisit schedule, on top of the once-a-day run. Posts younger than a week are read every
 * day; older ones every third day and only while they keep growing; past 30 days a post is
 * stale and never re-read. Intervals are a few hours short of whole days so a daily run
 * that starts a little early still picks them up.
 *
 * `baseScore` is the score from at least two days earlier (null if there is no reading that
 * old yet), so a manual refresh minutes after the last one can't make a post look flat.
 */
export function nextTier(postedAt: string, takenAt: string, baseScore: number | null, score: number): { tier: Tier; next: string | null } {
  const t = Date.parse(takenAt);
  const age = t - Date.parse(postedAt);
  const at = (h: number) => new Date(t + h * H).toISOString();
  if (age < 48 * H) return { tier: 'active', next: at(20) };
  if (age < 7 * 24 * H) return { tier: 'warm', next: at(20) };
  if (age < 30 * 24 * H) {
    const growth = baseScore === null ? 1 : (score - baseScore) / Math.max(baseScore, 1);
    if (growth > 0.03) return { tier: 'cooling', next: at(68) };
  }
  return { tier: 'stale', next: null };
}

export function recordPost(accountId: number, p: ScrapedPost, takenAt: string) {
  db.prepare(
    `INSERT INTO post (account_id, platform_post_id, url, posted_at, kind, text, media)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (account_id, platform_post_id) DO UPDATE SET url = excluded.url, text = excluded.text, media = excluded.media`,
  ).run(accountId, p.platformPostId, p.url, p.postedAt, p.kind, p.text, p.media ? JSON.stringify(p.media) : null);
  const post = db
    .prepare('SELECT id, tier FROM post WHERE account_id = ? AND platform_post_id = ?')
    .get(accountId, p.platformPostId) as { id: number; tier: Tier };

  const baseCutoff = new Date(Date.parse(takenAt) - GROWTH_WINDOW_H * H).toISOString();
  const base = db
    .prepare('SELECT likes, comments, shares FROM post_snapshot WHERE post_id = ? AND taken_at <= ? ORDER BY taken_at DESC LIMIT 1')
    .get(post.id, baseCutoff) as { likes: number; comments: number; shares: number } | undefined;
  const m = p.metrics;
  db.prepare(
    'INSERT INTO post_snapshot (post_id, taken_at, likes, comments, shares, views, bookmarks, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(post.id, takenAt, m.likes, m.comments, m.shares, m.views ?? null, m.bookmarks ?? null, m.extra ? JSON.stringify(m.extra) : null);

  // A stale post that shows up again in a scrape we paid for anyway still gets its snapshot, but stays stale.
  if (post.tier === 'stale') return;
  const { tier, next } = nextTier(p.postedAt, takenAt, base ? engagementScore(base) : null, engagementScore(m));
  db.prepare('UPDATE post SET tier = ?, next_check_at = ?, last_checked_at = ? WHERE id = ?').run(tier, next, takenAt, post.id);
}

/** Marks posts that dropped out of every scrape window as stale, so they stop driving sweeps. */
export function expireOld(accountId: number, takenAt: string) {
  const cutoff = new Date(Date.parse(takenAt) - 30 * 24 * H).toISOString();
  db.prepare("UPDATE post SET tier = 'stale', next_check_at = NULL WHERE account_id = ? AND tier != 'stale' AND posted_at < ?").run(accountId, cutoff);
}

/**
 * How many of the newest posts a sweep must read so every followed post is in it: all posts
 * since the oldest followed one, plus a few slots for new ones. Stale posts older than that
 * fall outside the window and cost nothing.
 */
export function scrapeWindow(accountId: number, spare = 3): number {
  const oldest = (db.prepare("SELECT min(posted_at) AS t FROM post WHERE account_id = ? AND tier != 'stale'").get(accountId) as { t: string | null }).t;
  if (!oldest) return 5 + spare;
  const n = (db.prepare('SELECT count(*) AS n FROM post WHERE account_id = ? AND posted_at >= ?').get(accountId, oldest) as { n: number }).n;
  // Prolific accounts would otherwise pay for 30+ posts a day; past this, the oldest
  // followed posts simply stop being re-read.
  return Math.min(n + spare, MAX_WINDOW);
}

const MAX_WINDOW = 15;
