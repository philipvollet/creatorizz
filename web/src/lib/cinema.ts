// Attract mode, like an old game's title screen: after a while without input, the camera
// tours the scene on its own and each stop comes with one big stat. Any input ends it.
import { C, PLATFORM_LABEL, RATING_COLOR, SERIES_COLOR, fmt, periodChange, platformText, signed, type Dashboard, type PostView, type SeriesKey } from './data.ts';
import type { IconName } from './icons.ts';

/** Seconds without input before the tour starts (override with ?idle=<seconds> for testing). */
export const IDLE_SECONDS = Number(new URLSearchParams(location.search).get('idle')) || 30;
/** Seconds per shot. */
export const SHOT_SECONDS = 9;

export interface Card {
  kicker: string;
  value: string;
  sub?: string;
  color?: string;
  /** A post's thumbnail, for the tower shots. */
  image?: string | null;
  /** The value counts up from zero to this, formatted the same way, for drama. */
  count?: { to: number; format: (n: number) => string };
  /** A breakdown under the value: one line per part, each with its icon and its own count-up. */
  lines?: { icon: IconName; color: string; to: number; text: string }[];
}

export type Shot =
  | { kind: 'orbit'; card: Card }
  | { kind: 'graph'; card: Card }
  | { kind: 'activity'; card: Card }
  | { kind: 'tower'; postId: number; card: Card }
  | { kind: 'persona'; personaId: string; card: Card }
  | { kind: 'ring'; card: Card }
  | { kind: 'stars'; card: Card }
  | { kind: 'above'; card: Card };

const short = (text: string | null, n = 42) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 3) + '...' : t;
};

const SOCIAL_LABEL: Partial<Record<SeriesKey, string>> = {
  linkedin: 'LINKEDIN',
  x: 'X',
  instagram: 'INSTAGRAM',
  tiktok: 'TIKTOK',
  youtube: 'YOUTUBE',
  reddit: 'REDDIT',
};

/** Where the score comes from, biggest part first, in words. */
function scoreLines(data: Dashboard, keys: SeriesKey[]) {
  const parts = data.impact.githubParts;
  const top = (group: 'build' | 'maintain') =>
    parts
      .filter((p) => p.group === group && p.cur > 0)
      .sort((a, b) => b.cur * b.weight - a.cur * a.weight)
      .slice(0, 3)
      .map((p) => `${fmt(p.cur)} ${p.label}`)
      .join(', ');
  return data.impact.series
    .filter((x) => keys.includes(x.key) && x.cur > 0)
    .sort((a, b) => b.cur - a.cur)
    .slice(0, 5)
    .map((x) => {
      const social = SOCIAL_LABEL[x.key];
      const text = social
        ? `FROM ${social} LIKES, COMMENTS AND SHARES`
        : x.key === 'build'
          ? `FROM BUILDING ON GITHUB: ${top('build')}`
          : x.key === 'maintain'
            ? `FROM MAINTAINING ON GITHUB: ${top('maintain')}`
            : x.key === 'stars'
              ? 'NEW GITHUB STARS'
              : 'NEW FOLLOWERS';
      const icon: IconName = social ? 'heart' : x.key === 'build' ? 'build' : x.key === 'maintain' ? 'maintain' : x.key === 'stars' ? 'star' : 'followers';
      return { icon, color: SERIES_COLOR[x.key], to: x.cur, text };
    });
}

/** The tour for what is on screen: only shots that have something to show. */
export function buildShots(data: Dashboard, visible: Set<SeriesKey>, visiblePosts: PostView[]): Shot[] {
  const shots: Shot[] = [];
  const days = data.range.days;
  const shown = data.impact.series.filter((x) => visible.has(x.key));
  const total = { cur: shown.reduce((t, x) => t + x.cur, 0), prev: shown.every((x) => x.prev !== null) ? shown.reduce((t, x) => t + (x.prev ?? 0), 0) : null };
  const change = periodChange(total);
  shots.push({
    kind: 'orbit',
    card: {
      kicker: `${data.scope.name}  LAST ${days} DAYS`,
      value: `${fmt(total.cur)} POINTS`,
      count: { to: total.cur, format: (n) => `${fmt(n)} POINTS` },
      lines: scoreLines(data, shown.map((x) => x.key)),
      color: change?.color ?? C.fg,
    },
  });
  if (shown.length) {
    shots.push({
      kind: 'graph',
      card: { kicker: `${days} DAYS, DAY BY DAY`, value: fmt(total.cur), count: { to: total.cur, format: fmt }, sub: shown.map((x) => x.label).join('  '), color: C.green },
    });
  }

  // Activity: how much went out and how well it landed per post.
  const act = data.activity;
  const platforms = act.perPlatform.filter((x) => visible.has(x.platform as SeriesKey));
  const posted = platforms.reduce((t, x) => t + x.posts, 0);
  if (posted) {
    const perPost = Math.round(platforms.reduce((t, x) => t + x.perPost * x.posts, 0) / posted);
    const gh = act.githubActions && (visible.has('build') || visible.has('maintain')) ? act.githubActions.cur : 0;
    shots.push({
      kind: 'activity',
      card: {
        kicker: `ACTIVITY  LAST ${days} DAYS`,
        value: `${fmt(posted)} POSTS`,
        count: { to: posted, format: (n) => `${fmt(n)} POSTS` },
        lines: [
          { icon: 'heart' as IconName, color: C.fg, to: perPost, text: 'ENGAGEMENT PER POST ON AVERAGE' },
          ...platforms
            .sort((a, b) => b.posts - a.posts)
            .slice(0, 4)
            .map((x) => ({ icon: 'post' as IconName, color: platformText(x.platform), to: x.posts, text: `${PLATFORM_LABEL[x.platform]} POSTS, ${fmt(x.perPost)} ENGAGEMENT EACH` })),
          ...(gh ? [{ icon: 'commit' as IconName, color: C.green, to: gh, text: 'GITHUB ACTIONS' }] : []),
        ],
        color: C.fg,
      },
    });
  }

  const best = [...visiblePosts].sort((a, b) => b.score - a.score)[0];
  if (best) {
    shots.push({
      kind: 'tower',
      postId: best.id,
      card: { kicker: `TOP POST ${days}D  ${PLATFORM_LABEL[best.platform]}`, value: `${fmt(best.score)} PTS`, count: { to: best.score, format: (n) => `${fmt(n)} PTS` }, sub: short(best.text), color: platformText(best.platform), image: best.thumb },
    });
  }

  const people = data.personas.flatMap((p) => p.accounts.map((a) => ({ p, a })));
  const followers = data.totals.followers;
  const lead = [...data.personas].sort((a, b) => b.accounts.reduce((s, x) => s + (x.followers ?? 0), 0) - a.accounts.reduce((s, x) => s + (x.followers ?? 0), 0))[0];
  if (lead && people.length) {
    shots.push({
      kind: 'persona',
      personaId: lead.id,
      card: { kicker: 'FOLLOWERS', value: fmt(followers), count: { to: followers, format: fmt }, sub: data.totals.delta.d7 !== null ? `${signed(data.totals.delta.d7)} THIS WEEK` : `ACROSS ${people.length} ACCOUNTS`, color: C.fg },
    });
  }

  const repo = data.github.repos[0];
  const gh = data.impact.series.filter((x) => (x.key === 'build' || x.key === 'maintain') && visible.has(x.key));
  if (repo && visible.has('stars')) {
    shots.push({ kind: 'stars', card: { kicker: `${repo.repo.toUpperCase()}`, value: `${fmt(repo.totals?.stars ?? null)} STARS`, count: { to: repo.totals?.stars ?? 0, format: (n) => `${fmt(n)} STARS` }, sub: `${signed(repo.gained.stars)} IN ${days}D`, color: C.yellow } });
  }
  if (gh.length && data.github.days.length) {
    shots.push({ kind: 'ring', card: { kicker: `GITHUB ${days}D`, value: gh.map((x) => `${x.label} ${fmt(x.cur)}`).join('  '), sub: `${data.github.streak} DAY STREAK`, color: C.green } });
  }

  const hottest = visiblePosts.filter((p) => p.rating === 'hot' && p.id !== best?.id).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0];
  if (hottest) {
    shots.push({
      kind: 'tower',
      postId: hottest.id,
      card: { kicker: `ON FIRE  ${PLATFORM_LABEL[hottest.platform]}`, value: `${(hottest.ratio ?? 0).toFixed(1)}X USUAL`, count: { to: hottest.ratio ?? 0, format: (n) => `${n.toFixed(1)}X USUAL` }, sub: short(hottest.text), color: RATING_COLOR.hot, image: hottest.thumb },
    });
  }

  const reach = visiblePosts.reduce((s, p) => s + Math.max(p.views ?? 0, p.likes + p.comments + p.shares), 0);
  if (reach) shots.push({ kind: 'above', card: { kicker: `REACH ${days}D`, value: fmt(reach), count: { to: reach, format: fmt }, sub: 'PEOPLE WHO SAW A POST', color: C.fg } });

  return shots;
}
