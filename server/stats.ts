import { db, type Platform, type Tier } from './db.ts';
import { engagementScore } from './posts.ts';
import { monthlyCapUsd, spentThisMonthUsd } from './apify.ts';
import { isRunning } from './jobs.ts';
import { ratePosts, TAU_H, THRESHOLDS } from './rating.ts';
import { thumbUrl } from './thumbs.ts';
import { GITHUB_WEIGHTS, githubPartsByDay, githubScoresByDay, windowSum, type ByDay } from './score.ts';

const DAY = 24 * 3600_000;
const dayOf = (iso: string) => iso.slice(0, 10);

export interface Scope {
  kind: 'persona' | 'group';
  id: string;
}

/** People and companies still in config.json: those with at least one active account. */
const TRACKED = 'EXISTS (SELECT 1 FROM account a WHERE a.persona_id = persona.id AND a.active = 1)';

export function parseScope(s: string | null): Scope {
  const [kind, id] = (s ?? '').split(':');
  if ((kind === 'persona' || kind === 'group') && id) return { kind, id };
  const g = db.prepare('SELECT id FROM grp ORDER BY id LIMIT 1').get() as { id: string } | undefined;
  if (g) return { kind: 'group', id: g.id };
  const p = db.prepare(`SELECT id FROM persona WHERE ${TRACKED} ORDER BY name LIMIT 1`).get() as { id: string } | undefined;
  return { kind: 'persona', id: p?.id ?? '' };
}

export function personaIds(scope: Scope): string[] {
  if (scope.kind === 'persona') return [scope.id];
  return (db.prepare('SELECT persona_id FROM grp_member WHERE group_id = ?').all(scope.id) as { persona_id: string }[]).map((r) => r.persona_id);
}

const avatarUrl = (file: string | null) => (file ? `/avatars/${file}` : null);

export function scopes() {
  const personas = db.prepare(`SELECT * FROM persona WHERE ${TRACKED} ORDER BY name`).all() as { id: string; name: string; kind: string }[];
  const groups = db.prepare('SELECT * FROM grp ORDER BY name').all() as { id: string; name: string }[];
  return {
    personas: personas.map((p) => ({ ...p, avatar: personaAvatar(p.id) })),
    groups: groups.map((g) => ({
      ...g,
      members: (db.prepare('SELECT persona_id FROM grp_member WHERE group_id = ?').all(g.id) as { persona_id: string }[]).map((m) => m.persona_id),
    })),
  };
}

/** LinkedIn photo first (the most current one, usually), then X, then GitHub. */
function personaAvatar(personaId: string): string | null {
  const r = db
    .prepare(
      `SELECT avatar_file FROM account WHERE persona_id = ? AND active = 1 AND avatar_file IS NOT NULL
       ORDER BY CASE platform WHEN 'linkedin' THEN 0 WHEN 'x' THEN 1 ELSE 2 END LIMIT 1`,
    )
    .get(personaId) as { avatar_file: string } | undefined;
  return avatarUrl(r?.avatar_file ?? null);
}

/** Last value per UTC day, carried forward over gaps and backward before the first reading. */
function dailySeries(points: { t: string; v: number }[], days: string[]): number[] {
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(dayOf(p.t), p.v);
  let cur = points.length ? points[0].v : 0;
  return days.map((d) => {
    if (byDay.has(d)) cur = byDay.get(d)!;
    return cur;
  });
}

function dayRange(n: number): string[] {
  const end = Date.now();
  return Array.from({ length: n }, (_, i) => dayOf(new Date(end - (n - 1 - i) * DAY).toISOString()));
}

/** Change over `days`, or null when there is no reading that old yet. */
function deltaOver(points: { t: string; v: number }[], days: number): number | null {
  if (!points.length) return null;
  const cutoff = new Date(Date.now() - days * DAY).toISOString();
  const before = points.filter((p) => p.t <= cutoff).at(-1);
  if (!before) return null;
  return points.at(-1)!.v - before.v;
}

/** Platforms whose posts earn engagement points, in graph order. */
const SOCIAL: [string, string][] = [
  ['linkedin', 'LINKEDIN'],
  ['x', 'X'],
  ['instagram', 'INSTAGRAM'],
  ['tiktok', 'TIKTOK'],
  ['youtube', 'YOUTUBE'],
  ['reddit', 'REDDIT'],
];

/** One point per new follower and per new star, the same as a like, so these rows read as plain counts. */
export const FOLLOWER_POINTS = 1;
export const STAR_POINTS = 1;

/**
 * Stars for a GitHub account, shown in place of followers: a repository's stars and its exact
 * new stars in 7 days, or a person's stars across their own repositories and the change since
 * a reading at least 7 days old.
 */
function githubStars(accountId: number, repo: boolean): { total: number | null; d7: number | null } {
  const snaps = db
    .prepare('SELECT taken_at, extra FROM account_snapshot WHERE account_id = ? AND extra IS NOT NULL ORDER BY taken_at')
    .all(accountId) as { taken_at: string; extra: string }[];
  const starsOf = (extra: string): number | null => {
    const x = JSON.parse(extra);
    return repo ? (x?.totals?.stars ?? null) : (x?.stars ?? null);
  };
  const total = snaps.length ? starsOf(snaps.at(-1)!.extra) : null;
  if (repo) return { total, d7: windowSum(repoDays([accountId], 'stars'), 0, 7) };
  const cutoff = new Date(Date.now() - 7 * DAY).toISOString();
  const base = snaps.filter((x) => x.taken_at <= cutoff).at(-1);
  const before = base ? starsOf(base.extra) : null;
  return { total, d7: total !== null && before !== null ? total - before : null };
}

/** One kind of per-day repository count, as points. */
function repoDays(accountIds: number[], kind: string, weight = 1): ByDay {
  const out: ByDay = new Map();
  if (!accountIds.length) return out;
  const rows = db
    .prepare(`SELECT day, sum(n) AS n FROM github_repo_day WHERE kind = ? AND account_id IN (${accountIds.map(() => '?').join(',')}) GROUP BY day`)
    .all(kind, ...accountIds) as { day: string; n: number }[];
  for (const r of rows) out.set(r.day, r.n * weight);
  return out;
}

/** Each tracked repository: current totals and what changed in the range, for the details view. */
function repoSummary(accountIds: number[], rangeDays: number) {
  return accountIds.map((id) => {
    const a = db.prepare('SELECT handle, url, avatar_file FROM account WHERE id = ?').get(id) as { handle: string; url: string; avatar_file: string | null };
    const latest = db.prepare('SELECT extra FROM account_snapshot WHERE account_id = ? AND extra IS NOT NULL ORDER BY taken_at DESC LIMIT 1').get(id) as { extra: string } | undefined;
    const x = latest ? JSON.parse(latest.extra) : null;
    const inRange = (kind: string) => windowSum(repoDays([id], kind), 0, rangeDays);
    const starSeries = repoDays([id], 'stars');
    return {
      repo: a.handle,
      url: a.url,
      avatar: avatarUrl(a.avatar_file),
      totals: x?.totals ?? null,
      release: x?.release ?? null,
      gained: {
        stars: inRange('stars'),
        forks: inRange('forks'),
        issuesOpened: inRange('issues_opened'),
        issuesClosed: inRange('issues_closed'),
        prsOpened: inRange('prs_opened'),
        prsMerged: inRange('prs_merged'),
        discussions: inRange('discussions'),
      },
      starsSince: [...starSeries.keys()].sort()[0] ?? null,
      starsToday: windowSum(starSeries, 0, 1),
    };
  });
}

/**
 * Follower gains per day: each rise between two readings of an account counts on the day of
 * the later one. Losses count as zero rather than taking points away, so one platform's
 * unfollows don't hide another's growth on the stacked graph.
 */
function followerPoints(accountIds: number[]): ByDay {
  const out: ByDay = new Map();
  for (const id of accountIds) {
    const snaps = db.prepare('SELECT taken_at, followers FROM account_snapshot WHERE account_id = ? AND followers IS NOT NULL ORDER BY taken_at').all(id) as { taken_at: string; followers: number }[];
    for (let i = 1; i < snaps.length; i++) {
      const gain = snaps[i].followers - snaps[i - 1].followers;
      if (gain > 0) {
        const d = dayOf(snaps[i].taken_at);
        out.set(d, (out.get(d) ?? 0) + gain * FOLLOWER_POINTS);
      }
    }
  }
  return out;
}

/** First day (YYYY-MM-DD) each main-graph series has complete data for. */
function seriesCoverage(accountRows: { id: number; platform: string }[]): Record<string, string | undefined> {
  const ids = (p: string) => accountRows.filter((a) => a.platform === p).map((a) => a.id);
  const firstRun = (job: string, accIds: number[]) =>
    accIds.length
      ? (db.prepare(`SELECT min(started_at) AS t FROM run WHERE job = ? AND status = 'ok' AND account_id IN (${accIds.map(() => '?').join(',')})`).get(job, ...accIds) as { t: string | null }).t
      : null;
  const minus = (iso: string | null, days: number) => (iso ? new Date(Date.parse(iso) - days * DAY).toISOString().slice(0, 10) : undefined);
  const li = ids('linkedin'), x = ids('x'), gh = ids('github');
  const oldestPost = (accIds: number[]) =>
    accIds.length
      ? (db.prepare(`SELECT min(posted_at) AS t FROM post WHERE account_id IN (${accIds.map(() => '?').join(',')})`).get(...accIds) as { t: string | null }).t
      : null;
  const all = accountRows.map((a) => a.id);
  const firstReading = all.length
    ? (db.prepare(`SELECT min(taken_at) AS t FROM account_snapshot WHERE account_id IN (${all.map(() => '?').join(',')})`).get(...all) as { t: string | null }).t
    : null;
  const oldestEvent = gh.length
    ? (db.prepare(`SELECT min(created_at) AS t FROM github_event WHERE account_id IN (${gh.map(() => '?').join(',')})`).get(...gh) as { t: string | null }).t
    : null;
  return {
    // LinkedIn posts are read with a one-month lookback.
    linkedin: minus(firstRun('linkedin.posts', li), 30),
    // Timeline scrapes reach back as far as the oldest post they returned.
    x: oldestPost(x)?.slice(0, 10),
    instagram: oldestPost(ids('instagram'))?.slice(0, 10),
    tiktok: oldestPost(ids('tiktok'))?.slice(0, 10),
    youtube: oldestPost(ids('youtube'))?.slice(0, 10),
    // Follower gains need two readings, so they start the day after the first one.
    followers: minus(firstReading, -1),
    // Contributions cover the year before the first read.
    build: minus(firstRun('github', gh), 365),
    // Stars per day reach back to the oldest complete day in the first read.
    stars: gh.length ? (db.prepare(`SELECT min(day) AS t FROM github_repo_day WHERE kind = 'stars' AND account_id IN (${gh.map(() => '?').join(',')})`).get(...gh) as { t: string | null }).t ?? undefined : undefined,
    // Maintenance leans on the events feed, which reaches back only so far.
    maintain: oldestEvent?.slice(0, 10),
  };
}

/** Squashes a ratio of this period to the last into -1..1, so 2x and 0.5x land at the same distance from 0. */
function momentumOf(pairs: [number, number][]): number | null {
  const valid = pairs.filter(([c, p]) => c + p > 0);
  if (!valid.length) return null;
  const mean = valid.reduce((s, [c, p]) => s + Math.log((c + 1) / (p + 1)), 0) / valid.length;
  return Math.tanh(mean);
}

export function dashboard(scope: Scope, rangeDays: number) {
  const ids = personaIds(scope);
  const ph = ids.map(() => '?').join(',');
  const scopeName =
    scope.kind === 'persona'
      ? (db.prepare('SELECT name FROM persona WHERE id = ?').get(scope.id) as { name: string } | undefined)?.name
      : (db.prepare('SELECT name FROM grp WHERE id = ?').get(scope.id) as { name: string } | undefined)?.name;

  const days = dayRange(rangeDays);
  const accountRows = db
    .prepare(`SELECT * FROM account WHERE active = 1 AND persona_id IN (${ph}) ORDER BY persona_id, platform`)
    .all(...ids) as any[];

  const personas = (db.prepare(`SELECT * FROM persona WHERE id IN (${ph}) ORDER BY name`).all(...ids) as any[]).map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    avatar: personaAvatar(p.id),
    accounts: [] as any[],
  }));

  let followerSeries = days.map(() => 0);
  const followerPairs: [number, number][] = [];
  const totals = { followers: 0, d1: 0, d7: 0, d30: 0, hasD1: false, hasD7: false, hasD30: false };

  for (const a of accountRows) {
    const pts = (db.prepare('SELECT taken_at AS t, followers AS v FROM account_snapshot WHERE account_id = ? AND followers IS NOT NULL ORDER BY taken_at').all(a.id) as { t: string; v: number }[]);
    const latest = db.prepare('SELECT extra, taken_at FROM account_snapshot WHERE account_id = ? ORDER BY taken_at DESC LIMIT 1').get(a.id) as { extra: string | null; taken_at: string } | undefined;
    const series = dailySeries(pts, days);
    followerSeries = followerSeries.map((v, i) => v + series[i]);
    const d1 = deltaOver(pts, 1), d7 = deltaOver(pts, 7), d30 = deltaOver(pts, 30), d14 = deltaOver(pts, 14);
    const followers = pts.at(-1)?.v ?? null;
    if (followers !== null) totals.followers += followers;
    if (d1 !== null) { totals.d1 += d1; totals.hasD1 = true; }
    if (d7 !== null) { totals.d7 += d7; totals.hasD7 = true; }
    if (d30 !== null) { totals.d30 += d30; totals.hasD30 = true; }
    if (d7 !== null && d14 !== null) followerPairs.push([Math.max(d7, 0), Math.max(d14 - d7, 0)]);
    personas.find((p) => p.id === a.persona_id)!.accounts.push({
      id: a.id,
      platform: a.platform as Platform,
      handle: a.handle,
      url: a.url,
      name: a.display_name,
      avatar: avatarUrl(a.avatar_file),
      followers,
      delta: { d1, d7, d30 },
      series,
      extra: latest?.extra ? JSON.parse(latest.extra) : null,
      lastSeen: latest?.taken_at ?? null,
      stars: a.platform === 'github' ? githubStars(a.id, a.handle.includes('/')) : null,
    });
  }

  // Posts, with their full snapshot history for velocity curves.
  const postRows = db
    .prepare(
      `SELECT p.*, a.platform, a.handle, a.persona_id FROM post p JOIN account a ON a.id = p.account_id
       WHERE a.active = 1 AND a.persona_id IN (${ph}) AND p.kind != 'reply' ORDER BY p.posted_at DESC`,
    )
    .all(...ids) as any[];
  const snaps = db.prepare('SELECT taken_at, likes, comments, shares, views FROM post_snapshot WHERE post_id = ? ORDER BY taken_at');
  // LinkedIn impressions come from imported analytics exports, not from the scraper.
  const imported = db.prepare('SELECT impressions, members_reached FROM post_impression WHERE post_id = ? ORDER BY taken_at DESC LIMIT 1');

  const gainedByPlatform: Record<string, ByDay> = Object.fromEntries(SOCIAL.map(([k]) => [k, new Map()]));
  const unrated = postRows.map((p) => {
    const s = snaps.all(p.id) as { taken_at: string; likes: number; comments: number; shares: number; views: number | null }[];
    let prev = 0;
    s.forEach((x, i) => {
      const score = engagementScore(x);
      // The first reading of a post is credited to the day it went out; later growth to the day it was seen.
      const day = i === 0 ? dayOf(p.posted_at) : dayOf(x.taken_at);
      const gain = Math.max(score - prev, 0);
      const pm = gainedByPlatform[p.platform];
      if (pm) pm.set(day, (pm.get(day) ?? 0) + gain);
      prev = score;
    });
    const last = s.at(-1);
    const imp = imported.get(p.id) as { impressions: number; members_reached: number | null } | undefined;
    return {
      id: p.id,
      platform: p.platform as Platform,
      handle: p.handle,
      persona: p.persona_id,
      url: p.url,
      postedAt: p.posted_at,
      kind: p.kind,
      text: p.text,
      media: p.media ? JSON.parse(p.media) : null,
      tier: p.tier as Tier,
      likes: last?.likes ?? 0,
      comments: last?.comments ?? 0,
      shares: last?.shares ?? 0,
      views: last?.views ?? imp?.impressions ?? null,
      reached: imp?.members_reached ?? null,
      thumb: thumbUrl(p.id),
      score: last ? engagementScore(last) : 0,
      history: s.map((x) => ({ t: x.taken_at, score: engagementScore(x), views: x.views })),
      seenAt: last?.taken_at ?? null,
      // Posted in the last 48 hours: still collecting its first engagement.
      active: Date.now() - Date.parse(p.posted_at) < 48 * 3600_000,
    };
  });
  const ratings = ratePosts(unrated);
  const posts = unrated.map((p) => ({ ...p, ...ratings.get(p)! }));

  // GitHub contribution days for the last year.
  // Personal GitHub accounts score BUILD and MAINTAIN; repositories ("owner/name") score STARS.
  const ghIds = accountRows.filter((a) => a.platform === 'github' && !a.handle.includes('/')).map((a) => a.id);
  const repoIds = accountRows.filter((a) => a.platform === 'github' && a.handle.includes('/')).map((a) => a.id);
  const ghDays = ghIds.length
    ? (db
        .prepare(`SELECT day, sum(contributions) AS n FROM github_day WHERE account_id IN (${ghIds.map(() => '?').join(',')}) GROUP BY day ORDER BY day`)
        .all(...ghIds) as { day: string; n: number }[])
    : [];
  let streak = 0;
  for (let i = ghDays.length - 1; i >= 0; i--) {
    // Today may simply not have started yet.
    if (ghDays[i].n > 0) streak++;
    else if (i === ghDays.length - 1) continue;
    else break;
  }
  // The main graph: one stacked bar per day, in points. Social series are engagement gained;
  // GitHub is split into BUILD and MAINTAIN from weighted actions.
  const ghParts = githubPartsByDay(ghIds);
  const gh = githubScoresByDay(ghParts);
  const platforms = new Set(accountRows.map((a) => a.platform));
  const seriesMaps: { key: string; label: string; map: ByDay }[] = [
    ...SOCIAL.filter(([k]) => platforms.has(k)).map(([key, label]) => ({ key, label, map: gainedByPlatform[key] })),
    ...(ghIds.length ? [{ key: 'build', label: 'BUILD', map: gh.build }, { key: 'maintain', label: 'MAINTAIN', map: gh.maintain }] : []),
    ...(repoIds.length ? [{ key: 'stars', label: 'STARS', map: repoDays(repoIds, 'stars', STAR_POINTS) }] : []),
    { key: 'followers', label: 'FOLLOWERS', map: followerPoints(accountRows.map((a) => a.id)) },
  ];
  // How far back each series really has data. A previous period that starts before that is
  // reported as unknown, not as zero, so the first weeks don't show fake +1000% jumps.
  const prevStart = new Date(Date.now() - 2 * rangeDays * DAY).toISOString().slice(0, 10);
  const coverage = seriesCoverage(accountRows);
  const period = (m: ByDay, key: string) => ({
    cur: windowSum(m, 0, rangeDays),
    prev: (coverage[key] ?? '9999') <= prevStart ? windowSum(m, rangeDays, 2 * rangeDays) : null,
  });
  const series = seriesMaps.map(({ key, label, map }) => ({ key, label, values: days.map((d) => map.get(d) ?? 0), ...period(map, key) }));
  const impact = {
    labels: days,
    series,
    total: {
      cur: series.reduce((t, x) => t + x.cur, 0),
      prev: series.every((x) => x.prev !== null) ? series.reduce((t, x) => t + (x.prev ?? 0), 0) : null,
    },
    githubParts: ghIds.length
      ? GITHUB_WEIGHTS.map((w) => ({ ...w, ...period(ghParts[w.key], w.group) }))
      : [],
  };

  // Activity: how much went out, and how well it landed per post. Posts count by the day they
  // went out; "per post" is the average engagement of the posts published in the period.
  const ageDays = (iso: string) => (Date.now() - Date.parse(iso)) / DAY;
  const published = (from: number, to: number) => posts.filter((p) => ageDays(p.postedAt) >= from && ageDays(p.postedAt) < to);
  const curPosts = published(0, rangeDays);
  const prevPosts = published(rangeDays, 2 * rangeDays);
  // The previous period only counts when every social platform in view reaches back that far.
  const socialKeys = SOCIAL.map(([k]) => k).filter((k) => platforms.has(k));
  const postsCovered = socialKeys.length > 0 && socialKeys.every((k) => (coverage[k] ?? '9999') <= prevStart);
  const perPost = (list: typeof posts) => (list.length ? list.reduce((t, p) => t + p.score, 0) / list.length : 0);
  const ghActions: ByDay = new Map();
  for (const m of Object.values(ghParts)) for (const [d, n] of m) ghActions.set(d, (ghActions.get(d) ?? 0) + n);
  const activity = {
    posts: { cur: curPosts.length, prev: postsCovered ? prevPosts.length : null },
    perPost: { cur: Math.round(perPost(curPosts)), prev: postsCovered && prevPosts.length ? Math.round(perPost(prevPosts)) : null },
    postsPerDay: socialKeys
      .map((k) => ({ platform: k, values: days.map((d) => curPosts.filter((p) => p.platform === k && dayOf(p.postedAt) === d).length) }))
      .filter((x) => x.values.some((v) => v > 0)),
    perPlatform: socialKeys
      .map((k) => {
        const list = curPosts.filter((p) => p.platform === k);
        return { platform: k, posts: list.length, perPost: Math.round(perPost(list)) };
      })
      .filter((x) => x.posts > 0),
    githubActions: ghIds.length ? period(ghActions, 'maintain') : null,
  };

  // Week-over-week needs two weeks of readings; before that any trend is an artefact of the first scrape.
  const firstSnap = accountRows.length
    ? (db.prepare(`SELECT min(taken_at) AS t FROM account_snapshot WHERE account_id IN (${accountRows.map(() => '?').join(',')})`).get(...accountRows.map((a) => a.id)) as { t: string | null }).t
    : null;
  const historyDays = firstSnap ? (Date.now() - Date.parse(firstSnap)) / DAY : 0;
  const momentum = historyDays < 14 ? null : momentumOf([
    ...seriesMaps.map(({ map }) => [windowSum(map, 0, 7), windowSum(map, 7, 14)] as [number, number]),
    ...followerPairs,
  ]);

  const runs = db.prepare('SELECT job, started_at, finished_at, status, items, cost_usd, note FROM run ORDER BY id DESC LIMIT 12').all();

  return {
    scope: { ...scope, name: scopeName ?? scope.id },
    range: { days: rangeDays, from: days[0], labels: days },
    personas,
    totals: {
      followers: totals.followers,
      delta: { d1: totals.hasD1 ? totals.d1 : null, d7: totals.hasD7 ? totals.d7 : null, d30: totals.hasD30 ? totals.d30 : null },
      momentum,
      historyDays: Math.floor(historyDays),
    },
    followerSeries,
    impact,
    activity,
    posts,
    github: {
      // Each day's BUILD and MAINTAIN points, for the year ring.
      days: ghDays.slice(-371).map((d) => ({ ...d, build: gh.build.get(d.day) ?? 0, maintain: gh.maintain.get(d.day) ?? 0 })),
      streak,
      repos: repoSummary(repoIds, rangeDays),
    },
    budget: { spentUsd: spentThisMonthUsd(), capUsd: monthlyCapUsd() },
    // The rules behind the numbers, for the help page, straight from the code that applies them.
    rules: {
      githubWeights: GITHUB_WEIGHTS,
      followerPoints: FOLLOWER_POINTS,
      starPoints: STAR_POINTS,
      ratingThresholds: THRESHOLDS,
      engagementHours: TAU_H,
      dailyAt: process.env.DAILY_AT ?? '07:00',
    },
    runs,
    lastCollectedAt: lastCollectedAt(),
    collecting: isRunning(),
  };
}

/** When the newest successful collection job started; changes whenever new data has landed. */
export function lastCollectedAt(): string | null {
  return (db.prepare("SELECT max(started_at) AS t FROM run WHERE status = 'ok' AND job != 'daily'").get() as { t: string | null }).t;
}
