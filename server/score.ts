import { db } from './db.ts';

const DAY = 24 * 3600_000;

/**
 * Points per GitHub action. BUILD is making things (code, PRs, releases); MAINTAIN is
 * looking after them and the people around them (reviews, triage, answers). Merges and
 * reviews weigh more than a single commit or comment because each one closes a loop.
 */
export const GITHUB_WEIGHTS = [
  { key: 'commits', label: 'COMMITS', group: 'build', weight: 1 },
  { key: 'prs_opened', label: 'PRS OPENED', group: 'build', weight: 3 },
  { key: 'prs_merged', label: 'PRS MERGED', group: 'build', weight: 4 },
  { key: 'releases', label: 'RELEASES', group: 'build', weight: 5 },
  { key: 'reviews', label: 'REVIEWS', group: 'maintain', weight: 3 },
  { key: 'issues_closed', label: 'ISSUES CLOSED', group: 'maintain', weight: 2 },
  { key: 'issues_opened', label: 'ISSUES FILED', group: 'maintain', weight: 1 },
  { key: 'comments', label: 'COMMENTS', group: 'maintain', weight: 1 },
  { key: 'discussion_comments', label: 'DISC REPLIES', group: 'maintain', weight: 1 },
  { key: 'answers', label: 'ANSWERS', group: 'maintain', weight: 5 },
] as const;

export type GithubPart = (typeof GITHUB_WEIGHTS)[number]['key'];
export type ByDay = Map<string, number>;

function bump(m: ByDay, day: string, n: number) {
  if (n) m.set(day, (m.get(day) ?? 0) + n);
}

/** Raw per-day counts of every GitHub action, from contributions, the events feed and lifetime totals. */
export function githubPartsByDay(accountIds: number[]): Record<GithubPart, ByDay> {
  const out = Object.fromEntries(GITHUB_WEIGHTS.map((w) => [w.key, new Map()])) as Record<GithubPart, ByDay>;
  if (!accountIds.length) return out;
  const ph = accountIds.map(() => '?').join(',');

  for (const r of db.prepare(`SELECT day, kind, n FROM github_activity_day WHERE account_id IN (${ph})`).all(...accountIds) as { day: string; kind: GithubPart; n: number }[]) {
    bump(out[r.kind], r.day, r.n);
  }

  const events = db.prepare(`SELECT type, action, substr(created_at, 1, 10) AS day FROM github_event WHERE account_id IN (${ph})`).all(...accountIds) as { type: string; action: string | null; day: string }[];
  for (const e of events) {
    if (e.type === 'IssuesEvent' && e.action === 'closed') bump(out.issues_closed, e.day, 1);
    else if (['IssueCommentEvent', 'PullRequestReviewCommentEvent', 'CommitCommentEvent'].includes(e.type)) bump(out.comments, e.day, 1);
    else if (e.type === 'ReleaseEvent' && e.action === 'published') bump(out.releases, e.day, 1);
  }

  // Discussion replies and accepted answers only exist as lifetime totals: each rise
  // between two readings is credited to the day of the later one.
  for (const id of accountIds) {
    const snaps = db.prepare('SELECT taken_at, extra FROM account_snapshot WHERE account_id = ? AND extra IS NOT NULL ORDER BY taken_at').all(id) as { taken_at: string; extra: string }[];
    let prev: any = null;
    for (const s of snaps) {
      const t = JSON.parse(s.extra)?.totals;
      if (!t) continue;
      if (prev) {
        bump(out.discussion_comments, s.taken_at.slice(0, 10), Math.max(0, t.discussionComments - prev.discussionComments));
        bump(out.answers, s.taken_at.slice(0, 10), Math.max(0, t.answers - prev.answers));
      }
      prev = t;
    }
  }
  return out;
}

export function githubScoresByDay(parts: Record<GithubPart, ByDay>): { build: ByDay; maintain: ByDay } {
  const build: ByDay = new Map();
  const maintain: ByDay = new Map();
  for (const w of GITHUB_WEIGHTS) {
    for (const [d, n] of parts[w.key]) bump(w.group === 'build' ? build : maintain, d, n * w.weight);
  }
  return { build, maintain };
}

/** Sum of a series over days `fromAge` (inclusive) to `toAge` (exclusive) days ago. */
export function windowSum(m: ByDay, fromAge: number, toAge: number): number {
  let s = 0;
  const now = Date.now();
  for (const [d, v] of m) {
    const age = (now - Date.parse(d)) / DAY;
    if (age >= fromAge && age < toAge) s += v;
  }
  return s;
}
