// Content-visualizer's `apple` retro palette, so the dashboard reads like the post visuals.
export const C = {
  bg: '#000000',
  fg: '#ffffff',
  green: '#45d23f',
  blue: '#2b3cf6',
  red: '#e8381e',
  orange: '#ef5a1c',
  yellow: '#f4d23a',
  gray: '#7a7a7a',
  dim: '#2a2a2a',
};

export type Platform = 'linkedin' | 'x' | 'github' | 'instagram' | 'tiktok' | 'youtube' | 'reddit';
/** Revisit tier: how often a post is re-read. */
export type Tier = 'active' | 'warm' | 'cooling' | 'stale';
/** How a post does against the same account's earlier posts. */
export type Rating = 'hot' | 'good' | 'meh' | 'shit';

// Platform colours: the apple palette where it fits, plus magenta, cyan and Reddit's orange-red.
export const PLATFORM_COLOR: Record<Platform, string> = {
  linkedin: C.blue,
  x: C.fg,
  github: C.green,
  instagram: '#d63fd6',
  tiktok: '#3fe0d0',
  youtube: C.red,
  reddit: '#ff6a1f',
};
export const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: 'LINKEDIN',
  x: 'X',
  github: 'GITHUB',
  instagram: 'INSTAGRAM',
  tiktok: 'TIKTOK',
  youtube: 'YOUTUBE',
  reddit: 'REDDIT',
};
/** A colour that reads as text on black (LinkedIn's blue is lifted). */
export const platformText = (p: Platform) => (p === 'linkedin' ? '#6f7cff' : PLATFORM_COLOR[p]);

export type SeriesKey = 'linkedin' | 'x' | 'instagram' | 'tiktok' | 'youtube' | 'reddit' | 'build' | 'maintain' | 'stars' | 'followers';
export const SERIES_KEYS: SeriesKey[] = ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'reddit', 'build', 'maintain', 'stars', 'followers'];

/**
 * Which platforms the scene draws for a set of visible series. GitHub stands for BUILD,
 * MAINTAIN and STARS; FOLLOWERS has no platform of its own and never hides one.
 */
export const platformVisible = (visible: Set<SeriesKey>, platform: Platform) =>
  platform === 'github' ? visible.has('build') || visible.has('maintain') || visible.has('stars') : visible.has(platform);

// Series colours on the main graph.
export const SERIES_COLOR: Record<SeriesKey, string> = {
  linkedin: '#6f7cff',
  x: C.fg,
  instagram: PLATFORM_COLOR.instagram,
  tiktok: PLATFORM_COLOR.tiktok,
  youtube: PLATFORM_COLOR.youtube,
  reddit: PLATFORM_COLOR.reddit,
  build: C.green,
  maintain: C.orange,
  stars: C.yellow,
  followers: '#b8b8b8',
};
export const RATING_COLOR: Record<Rating, string> = { hot: C.orange, good: C.green, meh: '#9fe8ff', shit: C.gray };
/** For posts without enough earlier posts to compare against. */
export const UNRATED_COLOR = C.fg;

export interface AccountView {
  id: number;
  platform: Platform;
  handle: string;
  url: string;
  name: string | null;
  avatar: string | null;
  followers: number | null;
  delta: { d1: number | null; d7: number | null; d30: number | null };
  series: number[];
  extra: any;
  lastSeen: string | null;
  /** GitHub only: stars (a repository's, or across a person's own repositories) and their 7-day change. */
  stars: { total: number | null; d7: number | null } | null;
}

export interface PostView {
  id: number;
  platform: Platform;
  handle: string;
  persona: string;
  url: string | null;
  postedAt: string;
  kind: string;
  text: string | null;
  media: { type: string; url: string }[] | null;
  tier: Tier;
  /** Posted in the last 48 hours. */
  active: boolean;
  /** Null until the account has enough earlier posts to compare against. */
  rating: Rating | null;
  /** Projected lifetime engagement over the usual post's. */
  ratio: number | null;
  usual: number | null;
  projected: number;
  /** Rated mostly from projection: younger than its platform's engagement window. */
  early: boolean;
  likes: number;
  comments: number;
  shares: number;
  views: number | null;
  /** Unique people, where LinkedIn's export reports it. */
  reached: number | null;
  /** A local copy of the post's first image or video cover. */
  thumb: string | null;
  score: number;
  history: { t: string; score: number; views: number | null }[];
}

/** This period and the one before; `prev` is null when there is no complete data that far back. */
export interface Period {
  cur: number;
  prev: number | null;
}

/** "+12%" against the previous period, or null when it can't be said honestly. */
export const periodChange = (p: Period): { text: string; color: string } | null => {
  if (p.prev === null) return null;
  if (p.prev === 0) return p.cur > 0 ? { text: 'NEW', color: C.green } : { text: '0%', color: C.gray };
  const pct = Math.round(((p.cur - p.prev) / p.prev) * 100);
  return { text: (pct > 0 ? '+' : '') + pct + '%', color: pct > 0 ? C.green : pct < 0 ? C.red : C.gray };
};

export interface Dashboard {
  scope: { kind: 'persona' | 'group'; id: string; name: string };
  range: { days: number; from: string; labels: string[] };
  personas: { id: string; name: string; kind: string; avatar: string | null; accounts: AccountView[] }[];
  totals: {
    followers: number;
    delta: { d1: number | null; d7: number | null; d30: number | null };
    momentum: number | null;
    historyDays: number;
  };
  followerSeries: number[];
  activity: {
    posts: Period;
    /** Average engagement points per post published in the period. */
    perPost: Period;
    postsPerDay: { platform: Platform; values: number[] }[];
    perPlatform: { platform: Platform; posts: number; perPost: number }[];
    githubActions: Period | null;
  };
  impact: {
    labels: string[];
    series: ({ key: SeriesKey; label: string; values: number[] } & Period)[];
    total: Period;
    githubParts: ({ key: string; label: string; group: 'build' | 'maintain'; weight: number } & Period)[];
  };
  posts: PostView[];
  github: {
    days: { day: string; n: number; build: number; maintain: number }[];
    streak: number;
    repos: RepoSummary[];
  };
  budget: { spentUsd: number; capUsd: number };
  rules: {
    githubWeights: { key: string; label: string; group: 'build' | 'maintain'; weight: number }[];
    followerPoints: number;
    starPoints: number;
    ratingThresholds: [Rating, number][];
    engagementHours: Record<string, number>;
    dailyAt: string;
  };
  runs: { job: string; started_at: string; status: string; items: number | null; cost_usd: number; note: string | null }[];
  lastCollectedAt: string | null;
  collecting: boolean;
}

export interface RepoSummary {
  repo: string;
  url: string;
  avatar: string | null;
  totals: {
    stars: number;
    forks: number;
    watchers: number;
    issuesOpen: number;
    issuesClosed: number;
    prsOpen: number;
    prsMerged: number;
    discussions: number;
  } | null;
  release: { tagName: string; publishedAt: string } | null;
  gained: { stars: number; forks: number; issuesOpened: number; issuesClosed: number; prsOpened: number; prsMerged: number; discussions: number };
  starsSince: string | null;
  starsToday: number;
}

export interface Scopes {
  personas: { id: string; name: string; kind: string; avatar: string | null }[];
  groups: { id: string; name: string; members: string[] }[];
}

export interface Health {
  ok: boolean;
  collecting: boolean;
  lastCollectedAt: string | null;
  startedAt: string;
}

export async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    // The server says why when it can (e.g. no config yet); otherwise just the status.
    const body = await r.json().catch(() => null);
    throw new Error(body?.error ?? `${url}: ${r.status}`);
  }
  return r.json();
}

export const fmt = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '-';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString('en-US');
};

export const signed = (n: number | null | undefined): string => (n === null || n === undefined ? '-' : (n > 0 ? '+' : '') + fmt(n));

export const trendColor = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? C.gray : n > 0 ? C.green : C.red);

export const ago = (iso: string | null): string => {
  if (!iso) return 'NEVER';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${m}M AGO`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}H AGO`;
  return `${Math.round(h / 24)}D AGO`;
};
