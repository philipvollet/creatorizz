import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Backdrop } from './components/Backdrop.tsx';
import { Scene } from './components/Scene.tsx';
import { Help } from './components/Help.tsx';
import { PixelImage } from './components/PixelImage.tsx';
import { PixelIcon } from './components/PixelIcon.tsx';
import { BuildGraph, CountUp } from './components/CinemaParts.tsx';
import type { IconName } from './lib/icons.ts';
import { PixelText } from './components/PixelText.tsx';
import { PixelChart, PixelStack } from './components/PixelChart.tsx';
import { peopleOf, reachOf } from './lib/reach.ts';
import { IDLE_SECONDS, SHOT_SECONDS, buildShots, type Shot } from './lib/cinema.ts';
import {
  C, PLATFORM_COLOR, PLATFORM_LABEL, RATING_COLOR, SERIES_COLOR, UNRATED_COLOR, ago, fmt, getJSON, periodChange, signed, trendColor,
  SERIES_KEYS, platformText, platformVisible, type Dashboard, type RepoSummary, type Period, type PostView, type Scopes, type SeriesKey,
} from './lib/data.ts';

const RANGES = [7, 30, 90];

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { scope: h.get('scope') ?? '', days: Number(h.get('days') ?? 7) };
}

function momentumLine(m: number | null, historyDays: number) {
  if (m === null) return { text: `CALIBRATING: DAY ${historyDays + 1} OF 14 FOR TRENDS`, color: C.gray };
  const pct = Math.round(m * 100);
  if (m > 0.05) return { text: `↑ TRENDING UP  MOMENTUM +${pct}`, color: C.green };
  if (m < -0.05) return { text: `↓ TRENDING DOWN  MOMENTUM ${pct}`, color: C.red };
  return { text: 'HOLDING STEADY', color: C.yellow };
}

function Tile({ kicker, icon, children }: { kicker: string; icon?: IconName; children: React.ReactNode }) {
  return (
    <section className="tile">
      <div className="kicker">
        {icon && <PixelIcon name={icon} px={2} color={C.green} />}
        <PixelText text={kicker} color={C.green} px={2} />
      </div>
      {children}
    </section>
  );
}

function Stat({ value, delta, deltaColor, note }: { value: string; delta?: string; deltaColor?: string; note?: string }) {
  return (
    <div className="stat">
      <PixelText text={value} px={5} scan />
      <div className="stat-side">
        {delta && <PixelText text={delta} px={2} color={deltaColor ?? C.gray} />}
        {note && <PixelText text={note} px={2} color={C.gray} />}
      </div>
    </div>
  );
}

const ratingColor = (p: PostView) => (p.rating ? RATING_COLOR[p.rating] : UNRATED_COLOR);

/** "HOT 3.2X USUAL", with EARLY while the rating is mostly projection. */
function ratingText(p: PostView) {
  if (!p.rating || p.ratio === null) return 'NOT RATED YET';
  return `${p.rating} ${p.ratio >= 10 ? Math.round(p.ratio) : p.ratio.toFixed(1)}X USUAL${p.early ? ' EARLY' : ''}`;
}

function PostCard({ post }: { post: PostView }) {
  return (
    <div className="post-card">
      <div className="row">
        <PixelText text={PLATFORM_LABEL[post.platform]} color={platformText(post.platform)} px={2} />
        <PixelText text={ratingText(post)} color={ratingColor(post)} px={2} />
        {post.active && <PixelText text="ACTIVE" color={C.yellow} px={2} />}
        <PixelText text={ago(post.postedAt)} color={C.gray} px={2} />
      </div>
      {post.thumb && <PixelImage src={post.thumb} width={340} grid={85} className="post-thumb" />}
      <PixelText text={(post.text ?? '').replace(/\s+/g, ' ')} px={2} maxWidth={350} maxLines={6} color={C.fg} />
      <div className="row metrics">
        <Metric icon="heart" value={post.likes} title="Likes and reactions" />
        <Metric icon="comment" value={post.comments} title="Comments and replies" />
        <Metric icon="share" value={post.shares} title="Shares and reposts" />
        {post.views !== null && <Metric icon="eye" value={post.views} title="Views" color={C.gray} />}
      </div>
      {post.history.length > 1 && (
        <PixelChart values={post.history.map((h) => h.score)} color={ratingColor(post)} w={150} h={22} px={2} />
      )}
    </div>
  );
}

/** What kind of number a series is: engagement for posts, then GitHub, stars and followers. */
/** Mixing-desk modes per series; a series that isn't listed is normal. */
type Mix = Partial<Record<SeriesKey, 'solo' | 'mute'>>;

const SERIES_ICON: Record<SeriesKey, IconName> = {
  linkedin: 'heart',
  x: 'heart',
  instagram: 'heart',
  tiktok: 'heart',
  youtube: 'heart',
  reddit: 'heart',
  build: 'build',
  maintain: 'maintain',
  stars: 'star',
  followers: 'followers',
};

const PART_ICON: Record<string, IconName> = {
  commits: 'commit',
  prs_opened: 'pr',
  prs_merged: 'pr',
  releases: 'tag',
  reviews: 'check',
  issues_closed: 'check',
  issues_opened: 'issue',
  comments: 'comment',
  discussion_comments: 'comment',
  answers: 'check',
};

/** An icon and its number, e.g. a heart and the like count. */
function Metric({ icon, value, title, color = C.fg }: { icon: IconName; value: number; title: string; color?: string }) {
  return (
    <span className="metric" title={title}>
      <PixelIcon name={icon} px={2} color={color} />
      <PixelText text={fmt(value)} px={2} color={color} />
    </span>
  );
}

const SERIES_HINT: Record<SeriesKey, string> = {
  linkedin: 'LinkedIn engagement gained: like 1, comment 2, share 3',
  x: 'X engagement gained: like 1, reply 2, repost 3',
  instagram: 'Instagram engagement gained: like 1, comment 2',
  tiktok: 'TikTok engagement gained: like 1, comment 2, share 3',
  youtube: 'YouTube engagement gained: like 1, comment 2',
  reddit: 'Reddit activity: upvote 1, comment 2, crosspost 3',
  build: 'GitHub BUILD: commits, PRs opened and merged, releases',
  maintain: 'GitHub MAINTAIN: reviews, issues, comments, discussion replies, answers',
  stars: 'New stars on tracked repositories',
  followers: 'New followers on every platform',
};

/** Change against the previous period; a dash when that period has no complete data yet. */
function Change({ p, px = 2 }: { p: Period; px?: number }) {
  const c = periodChange(p);
  return <PixelText text={c ? c.text : '-'} px={px} color={c ? c.color : C.gray} />;
}

/**
 * The one graph: daily points from every platform, stacked, with each series' total and change.
 * Each series can be soloed (S: only soloed series show) or muted (M: hidden); clicking the
 * same button again returns it to normal.
 * The total, the bars and the scene all follow what is visible.
 */
function ScoreTile({ data, visible, mix, onMode, onReset, cumulative, onCumulative }: {
  data: Dashboard;
  visible: Set<SeriesKey>;
  mix: Mix;
  onMode: (k: SeriesKey, mode: 'solo' | 'mute') => void;
  onReset: () => void;
  cumulative: boolean;
  onCumulative: (on: boolean) => void;
}) {
  const im = data.impact;
  const shown = im.series.filter((x) => visible.has(x.key));
  // Cumulative turns each series into a running total, so the last bar is the range's score.
  const stack = useMemo(
    () =>
      shown.map((x) => {
        let run = 0;
        return { values: cumulative ? x.values.map((v) => (run += v)) : x.values, color: SERIES_COLOR[x.key] };
      }),
    [im, visible, cumulative],
  );
  const total = {
    cur: shown.reduce((t, x) => t + x.cur, 0),
    prev: shown.length && shown.every((x) => x.prev !== null) ? shown.reduce((t, x) => t + (x.prev ?? 0), 0) : null,
  };
  return (
    <Tile kicker={`SCORE ${data.range.days}D${shown.length === im.series.length ? '' : shown.length === 1 ? `  ${shown[0].label}` : `  ${shown.length} OF ${im.series.length}`}`}>
      <div className="stat">
        <PixelText text={fmt(total.cur)} px={6} scan />
        <div className="stat-side">
          {total.prev === null ? (
            <span title="The period before this one has no complete data yet, so there's nothing honest to compare against"><PixelText text="NO BASELINE YET" px={2} color={C.gray} /></span>
          ) : (
            <>
              <Change p={total} />
              <PixelText text={`VS ${fmt(total.prev)}`} px={2} color={C.gray} />
            </>
          )}
        </div>
      </div>
      <div className="seg seg-small">
        {([false, true] as const).map((on) => (
          <button key={String(on)} className={cumulative === on ? 'on' : ''} onClick={() => onCumulative(on)} aria-pressed={cumulative === on}>
            <PixelText text={on ? 'TOTAL' : 'DAILY'} px={2} color={cumulative === on ? C.bg : C.fg} />
          </button>
        ))}
      </div>
      <PixelStack series={stack.length ? stack : [{ values: im.labels.map(() => 0), color: C.gray }]} h={56} maxW={170} />
      <ul className="series">
        {im.series.map((x) => {
          const off = !visible.has(x.key);
          const mode = mix[x.key];
          return (
            <li key={x.key} className={off ? 'off' : ''} title={SERIES_HINT[x.key]}>
              <PixelIcon name={SERIES_ICON[x.key]} px={2} color={off ? C.gray : SERIES_COLOR[x.key]} />
              <PixelText text={x.label} px={2} color={off ? C.gray : SERIES_COLOR[x.key]} />
              <span className="grow" />
              <PixelText text={fmt(x.cur)} px={2} color={off ? C.gray : C.fg} />
              <span className="chg">{off ? <PixelText text="OFF" px={2} color={C.gray} /> : <Change p={x} />}</span>
              <span className="mixer">
                {(['solo', 'mute'] as const).map((m) => (
                  <button
                    key={m}
                    className={`mix-${m} ${mode === m ? 'on' : ''}`}
                    aria-pressed={mode === m}
                    onClick={() => onMode(x.key, m)}
                    title={mode === m ? `Back to normal` : m === 'solo' ? `Solo: show only ${x.label} (and other soloed series)` : `Mute: hide ${x.label}`}
                  >
                    <PixelText text={m === 'solo' ? 'S' : 'M'} px={2} color={mode === m ? C.bg : C.gray} />
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      {Object.keys(mix).length > 0 && (
        <button className="mix-reset" onClick={onReset} title="Every series back to normal">
          <PixelText text="RESET" px={2} color={C.gray} />
        </button>
      )}
    </Tile>
  );
}

/**
 * How much went out and how well it landed: posts in the range (per day, by platform), the
 * average engagement per post, and GitHub actions. Follows the solo and mute settings.
 */
function ActivityTile({ data, visible }: { data: Dashboard; visible: Set<SeriesKey> }) {
  const a = data.activity;
  const shown = a.postsPerDay.filter((x) => visible.has(x.platform as SeriesKey));
  const platforms = a.perPlatform.filter((x) => visible.has(x.platform as SeriesKey));
  const posts = platforms.reduce((t, x) => t + x.posts, 0);
  const allShown = platforms.length === a.perPlatform.length;
  // With platforms muted, the period comparison and the overall average no longer apply.
  const postsPeriod: Period = allShown ? a.posts : { cur: posts, prev: null };
  const perPost = allShown ? a.perPost : { cur: posts ? Math.round(platforms.reduce((t, x) => t + x.perPost * x.posts, 0) / posts) : 0, prev: null };
  const gh = a.githubActions && (visible.has('build') || visible.has('maintain')) ? a.githubActions : null;
  if (!posts && !gh) return null;
  return (
    <Tile kicker={`ACTIVITY ${data.range.days}D`} icon="post">
      {posts > 0 && (
        <>
          <div className="stat" title="Posts published in the range">
            <PixelText text={fmt(posts)} px={5} scan />
            <div className="stat-side">
              <PixelText text="POSTS" px={2} color={C.gray} />
              <Change p={postsPeriod} />
            </div>
          </div>
          <PixelStack series={shown.map((x) => ({ values: x.values, color: platformText(x.platform) }))} h={22} maxW={170} />
          <div className="row-between" title={`Average engagement per post: ${platforms.map((x) => `${PLATFORM_LABEL[x.platform]} ${fmt(x.perPost)}`).join(', ')}`}>
            <span className="metric">
              <PixelIcon name="heart" px={2} color={C.fg} />
              <PixelText text={`${fmt(perPost.cur)} PER POST`} px={2} />
            </span>
            <Change p={perPost} />
          </div>
          <div className="platform-split">
            {platforms.map((x) => (
              <span key={x.platform} className="metric" title={`${PLATFORM_LABEL[x.platform]}: ${x.posts} posts, ${fmt(x.perPost)} engagement per post`}>
                <i style={{ background: platformText(x.platform) }} />
                <PixelText text={`${x.posts}× ${fmt(x.perPost)}`} px={2} color={platformText(x.platform)} />
              </span>
            ))}
          </div>
        </>
      )}
      {gh && (
        <div className="row-between" title="GitHub actions: commits, PRs, reviews, issues, comments, discussion replies and answers">
          <span className="metric">
            <PixelIcon name="commit" px={2} color={C.green} />
            <PixelText text={`${fmt(gh.cur)} GITHUB ACTIONS`} px={2} />
          </span>
          <Change p={gh} />
        </div>
      )}
    </Tile>
  );
}

/** What the pixel crowd in the scene stands for. */
function ReachTile({ data }: { data: Dashboard }) {
  const from = Date.parse(data.range.from);
  const posts = data.posts.filter((p) => Date.parse(p.postedAt) >= from);
  const people = reachOf(posts);
  const sum = (platform: string, f: (p: PostView) => number) => posts.filter((p) => p.platform === platform).reduce((s, p) => s + f(p), 0);
  const liImported = posts.some((p) => p.platform === 'linkedin' && p.views !== null);
  // One row per platform with posts in range; LinkedIn shows "-" until its views are imported.
  const present = [...new Set(posts.map((p) => p.platform))];
  const rows: [string, string, string][] = present.map((pl) => [
    PLATFORM_LABEL[pl],
    pl === 'linkedin' && !liImported ? '-' : fmt(sum(pl, (p) => p.views ?? 0)),
    fmt(sum(pl, (p) => peopleOf(p).engaged)),
  ]);
  return (
    <Tile kicker={`REACH ${data.range.days}D`} icon="eye">
      <div className="stat">
        <PixelText text={fmt(people)} px={5} scan />
        <div className="stat-side">
          <PixelText text="PEOPLE" px={2} color={C.gray} />
        </div>
      </div>
      <table className="parts">
        <tbody>
          {rows.map(([k, v, e]) => (
            <tr key={k} title={k === 'LINKEDIN' && v === '-' ? 'LinkedIn shows impressions only to the author: import an analytics export or turn on the browser reader' : `${k}: views, and people who liked, commented or shared`}>
              <td><PixelText text={k} px={2} color={C.gray} /></td>
              <td><span className="metric" title="Views"><PixelIcon name="eye" px={2} color={C.fg} /><PixelText text={v} px={2} /></span></td>
              <td><span className="metric" title="People who liked, commented or shared"><PixelIcon name="heart" px={2} color={C.gray} /><PixelText text={e} px={2} color={C.gray} /></span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Tile>
  );
}

/** A tracked repository: stars first, then the rest of its activity in the range. */
function RepoTile({ r, days }: { r: RepoSummary; days: number }) {
  const t = r.totals;
  const rows: [string, number | null, number, IconName][] = [
    ['FORKS', t?.forks ?? null, r.gained.forks, 'fork'],
    ['ISSUES OPEN', t?.issuesOpen ?? null, r.gained.issuesOpened, 'issue'],
    ['ISSUES CLOSED', t?.issuesClosed ?? null, r.gained.issuesClosed, 'check'],
    ['PRS OPEN', t?.prsOpen ?? null, r.gained.prsOpened, 'pr'],
    ['PRS MERGED', t?.prsMerged ?? null, r.gained.prsMerged, 'pr'],
    ['DISCUSSIONS', t?.discussions ?? null, r.gained.discussions, 'comment'],
  ];
  return (
    <Tile kicker={`${r.repo.toUpperCase()} ${days}D`} icon="star">
      <a className="stat" href={r.url} target="_blank" rel="noreferrer" title="Stars now, and new stars in the range (exact per day)">
        <PixelText text={fmt(t?.stars ?? null)} px={5} scan />
        <div className="stat-side">
          <span className="metric"><PixelIcon name="star" px={2} color={r.gained.stars ? C.yellow : C.gray} /><PixelText text={`${signed(r.gained.stars)} STARS`} px={2} color={r.gained.stars ? C.yellow : C.gray} /></span>
          {r.release && <PixelText text={`LATEST ${r.release.tagName}`} px={2} color={C.gray} />}
        </div>
      </a>
      <table className="parts">
        <tbody>
          {rows.map(([label, total, gained, icon]) => (
            <tr key={label} title={`${label.toLowerCase()}: total now, and the change in ${days} days (counted from the first daily reading)`}>
              <td><PixelIcon name={icon} px={2} color={C.gray} /></td>
              <td><PixelText text={label} px={2} color={C.gray} /></td>
              <td><PixelText text={fmt(total)} px={2} /></td>
              <td><PixelText text={gained ? signed(gained) : '-'} px={2} color={gained ? C.green : C.gray} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Tile>
  );
}

function GithubScoreTile({ data }: { data: Dashboard }) {
  const im = data.impact;
  const group = (g: 'build' | 'maintain') => im.series.find((x) => x.key === g);
  const gh = data.personas.flatMap((p) => p.accounts).find((a) => a.platform === 'github');
  return (
    <Tile kicker={`GITHUB ${data.range.days}D`} icon="commit">
      <div className="pair">
        {(['build', 'maintain'] as const).map((g) => {
          const x = group(g);
          return x ? (
            <div key={g} className="counter">
              <PixelText text={x.label} px={2} color={SERIES_COLOR[g]} />
              <PixelText text={fmt(x.cur)} px={4} scan />
              <Change p={x} />
            </div>
          ) : null;
        })}
      </div>
      <table className="parts">
        <tbody>
          {im.githubParts.map((p) => (
            <tr key={p.key} title={`${p.label.toLowerCase()}: ${fmt(p.cur)} × ${p.weight} points = ${fmt(p.cur * p.weight)}`}>
              <td><PixelIcon name={PART_ICON[p.key] ?? 'commit'} px={2} color={SERIES_COLOR[p.group]} /></td>
              <td><PixelText text={p.label} px={2} color={C.gray} /></td>
              <td><PixelText text={fmt(p.cur)} px={2} /></td>
              <td><PixelText text={fmt(p.cur * p.weight)} px={2} color={SERIES_COLOR[p.group]} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <PixelText text={`${data.github.streak}D STREAK  ${fmt(gh?.extra?.stars)} STARS`} px={2} color={C.gray} />
    </Tile>
  );
}

/** Who to look at: groups first, then each person or company, in one pixel dropdown. */
function ScopePicker({ scopes, current, currentName, onPick }: { scopes: Scopes | null; current: string; currentName: string; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const pick = (key: string) => {
    onPick(key);
    setOpen(false);
  };
  const item = (key: string, label: string, sub: string, avatar?: string | null) => (
    <li key={key}>
      <button role="option" aria-selected={key === current} className={key === current ? 'on' : ''} onClick={() => pick(key)}>
        {avatar !== undefined && (avatar ? <img src={avatar} alt="" /> : <span className="noav" />)}
        <PixelText text={label} px={2} color={key === current ? C.bg : C.fg} />
        <span className="grow" />
        <PixelText text={sub} px={2} color={key === current ? C.bg : C.gray} />
      </button>
    </li>
  );
  return (
    <div className="picker" ref={root}>
      <button className="picker-title" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Choose who to look at">
        <PixelText text={currentName} px={6} scan />
        <PixelText text={open ? '↑' : '↓'} px={3} color={C.gray} />
      </button>
      {open && scopes && (
        <ul className="picker-list" role="listbox">
          {scopes.groups.map((g) => item(`group:${g.id}`, g.name, `${g.members.length}`))}
          <li className="picker-rule" aria-hidden />
          {scopes.personas.map((p) => item(`persona:${p.id}`, p.name, p.kind === 'company' ? 'COMPANY' : '', p.avatar))}
        </ul>
      )}
    </div>
  );
}

/** The attract-mode caption: one big stat per shot, and the "move to return" prompt. */
function CinemaOverlay({ shot, step, index, total, scopeName, data, visible }: { shot: Shot; step: number; index: number; total: number; scopeName: string; data: Dashboard; visible: Set<SeriesKey> }) {
  const c = shot.card;
  return (
    <div className="cinema-overlay" aria-live="polite">
      {/* Keyed by the running step, so every shot (and every loop) replays its animations. */}
      <div className="cinema-card" key={step}>
        {c.image && <PixelImage src={c.image} width={360} grid={72} className="cinema-thumb" />}
        <PixelText text={c.kicker} px={3} color={C.green} />
        {c.count ? <CountUp to={c.count.to} format={c.count.format} px={10} color={c.color ?? C.fg} /> : <PixelText text={c.value} px={10} scan color={c.color ?? C.fg} />}
        {c.lines && (
          <ul className="cinema-lines">
            {c.lines.map((l) => (
              <li key={l.text}>
                <PixelIcon name={l.icon} px={3} color={l.color} />
                <span className="cinema-num"><CountUp to={l.to} format={fmt} px={3} color={l.color} /></span>
                <PixelText text={l.text} px={2} color={C.fg} maxWidth={Math.min(window.innerWidth - 260, 760)} maxLines={1} />
              </li>
            ))}
          </ul>
        )}
        {shot.kind === 'graph' && <BuildGraph data={data} visible={visible} />}
        {c.sub && <PixelText text={c.sub} px={3} color={C.fg} maxWidth={Math.min(window.innerWidth - 48, 900)} maxLines={2} />}
      </div>
      <div className="cinema-foot">
        <PixelText text={`CREATORIZZ  ${scopeName}  ${index + 1}/${total}`} px={2} color={C.gray} />
        <span className="blink"><PixelText text="MOVE TO RETURN" px={3} color={C.fg} /></span>
      </div>
    </div>
  );
}

export function App() {
  const [{ scope, days }, setView] = useState(readHash);
  const [scopes, setScopes] = useState<Scopes | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [hovered, setHovered] = useState<PostView | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each series is normal, solo or muted, like a mixing desk; remembered per browser.
  // (Series hidden before solo/mute existed come back as muted.)
  const [mix, setMixState] = useState<Mix>(() => {
    try {
      const saved = localStorage.getItem('creatorizz.mix');
      if (saved) return JSON.parse(saved);
      return Object.fromEntries((JSON.parse(localStorage.getItem('creatorizz.hidden') ?? '[]') as SeriesKey[]).map((k) => [k, 'mute']));
    } catch {
      return {};
    }
  });
  const setMix = (next: Mix) => {
    setMixState(next);
    try {
      localStorage.setItem('creatorizz.mix', JSON.stringify(next));
    } catch {
      // Only a convenience.
    }
  };
  /** Clicking a series' S or M: switches that mode on, or back to normal if it was on. */
  const setMode = (k: SeriesKey, mode: 'solo' | 'mute') => {
    const next = { ...mix };
    if (next[k] === mode) delete next[k];
    else next[k] = mode;
    setMix(next);
  };
  const [cumulative, setCumulativeState] = useState(() => {
    try {
      return localStorage.getItem('creatorizz.cumulative') === '1';
    } catch {
      return false;
    }
  });
  const setCumulative = (on: boolean) => {
    setCumulativeState(on);
    try {
      localStorage.setItem('creatorizz.cumulative', on ? '1' : '0');
    } catch {
      // Only a convenience.
    }
  };
  // Any solo wins: only soloed series show. Otherwise everything that isn't muted.
  const visible = useMemo(() => {
    const solos = SERIES_KEYS.filter((k) => mix[k] === 'solo');
    return new Set(solos.length ? solos : SERIES_KEYS.filter((k) => mix[k] !== 'mute'));
  }, [mix]);

  // Attract mode: starts after IDLE_SECONDS without input, or from the CINEMA button, and ends
  // on any key, click or scroll, or once the mouse really moves (a twitch doesn't count).
  const [cinema, setCinema] = useState(false);
  const [help, setHelp] = useState(false);
  const [shotIndex, setShotIndex] = useState(0);
  const lastInput = useRef(Date.now());
  const grace = useRef({ until: 0, x: 0, y: 0, armed: false });
  const startCinema = (manual: boolean) => {
    grace.current = { until: manual ? Date.now() + 1200 : 0, x: 0, y: 0, armed: false };
    setShotIndex(0);
    setCinema(true);
  };
  useEffect(() => {
    const active = (e: Event) => {
      lastInput.current = Date.now();
      if (!cinemaRef.current) return;
      if (Date.now() < grace.current.until) return;
      if (e instanceof PointerEvent && e.type === 'pointermove') {
        // Measure from where the pointer was when the tour began.
        if (!grace.current.armed) {
          grace.current = { ...grace.current, x: e.clientX, y: e.clientY, armed: true };
          return;
        }
        if (Math.hypot(e.clientX - grace.current.x, e.clientY - grace.current.y) < 24) return;
      }
      setCinema(false);
    };
    const kinds = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
    kinds.forEach((k) => window.addEventListener(k, active, { passive: true }));
    const timer = setInterval(() => {
      if (!cinemaRef.current && Date.now() - lastInput.current > IDLE_SECONDS * 1000) startCinema(false);
    }, 1000);
    return () => {
      kinds.forEach((k) => window.removeEventListener(k, active));
      clearInterval(timer);
    };
  }, []);
  const cinemaRef = useRef(false);
  cinemaRef.current = cinema;
  useEffect(() => {
    document.body.classList.toggle('cinema', cinema);
    if (!cinema) return;
    const t = setInterval(() => setShotIndex((i) => i + 1), SHOT_SECONDS * 1000);
    return () => clearInterval(t);
  }, [cinema]);
  const [details, setDetails] = useState(() => {
    try {
      return localStorage.getItem('creatorizz.details') === '1';
    } catch {
      return false;
    }
  });
  const toggleDetails = () => {
    setDetails((d) => {
      try {
        localStorage.setItem('creatorizz.details', d ? '0' : '1');
      } catch {
        // Only a convenience.
      }
      return !d;
    });
  };

  const load = useCallback(() => {
    getJSON<Dashboard>(`/api/dashboard?scope=${encodeURIComponent(scope)}&days=${days}`)
      .then((d) => {
        setData(d);
        setCollecting(d.collecting);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [scope, days]);

  useEffect(() => {
    getJSON<Scopes>('/api/scopes').then(setScopes).catch(() => {});
  }, []);
  useEffect(() => {
    location.hash = `scope=${scope}&days=${days}`;
    load();
  }, [scope, days, load]);

  // While a collection runs, poll until it ends, then reload.
  useEffect(() => {
    if (!collecting) return;
    const t = setInterval(async () => {
      const h = await getJSON<{ collecting: boolean }>('/api/health').catch(() => ({ collecting: false }));
      if (!h.collecting) {
        setCollecting(false);
        load();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [collecting, load]);

  const refresh = async () => {
    setCollecting(true);
    // Only who is on screen: one person, one company, or the group in view.
    const r = await fetch(`/api/collect?force=1&scope=${encodeURIComponent(`${data!.scope.kind}:${data!.scope.id}`)}`, { method: 'POST' });
    if (!r.ok && r.status !== 409) {
      setCollecting(false);
      setError(`refresh failed: ${r.status}`);
    }
  };

  const top = useMemo(() => {
    if (!data) return [];
    const from = Date.parse(data.range.from);
    return data.posts.filter((p) => Date.parse(p.postedAt) >= from).sort((a, b) => b.score - a.score).slice(0, 6);
  }, [data]);

  if (!data) {
    return (
      <div className="boot">
        <PixelText text={error ? 'NO SIGNAL' : 'LOADING...'} px={4} color={error ? C.red : C.green} scan />
        {error && <PixelText text={error} px={1} color={C.gray} />}
      </div>
    );
  }

  const t = data.totals;
  // The tour for what is on screen (cheap enough to rebuild each render).
  const inRange = data.posts.filter((p) => Date.parse(p.postedAt) >= Date.parse(data.range.from) && platformVisible(visible, p.platform));
  const shots = buildShots(data, visible, inRange);
  const shot = cinema && shots.length ? shots[shotIndex % shots.length] : null;
  const mline = momentumLine(t.momentum, t.historyDays);
  const accounts = data.personas.flatMap((p) => p.accounts);
  const scopeKey = `${data.scope.kind}:${data.scope.id}`;

  return (
    <>
      <Backdrop momentum={t.momentum} />
      <Scene data={data} onHover={setHovered} hovered={hovered} visible={visible} shot={shot} />
      {help && <Help data={data} onClose={() => setHelp(false)} />}
      {shot && <CinemaOverlay shot={shot} step={shotIndex} index={shotIndex % shots.length} total={shots.length} scopeName={data.scope.name} data={data} visible={visible} />}
      <div className="scanlines" />

      <header className="top">
        <div className="title">
          <ScopePicker scopes={scopes} current={scopeKey} currentName={data.scope.name} onPick={(k) => setView({ scope: k, days })} />
          {details && <PixelText text={mline.text} color={mline.color} px={2} maxWidth={Math.min(window.innerWidth - 32, 900)} />}
        </div>
        <nav className="controls">
          {details && (
          <>
          <div className="seg">
            {RANGES.map((r) => (
              <button key={r} className={r === days ? 'on' : ''} onClick={() => setView({ scope, days: r })}>
                <PixelText text={`${r}D`} px={2} color={r === days ? C.bg : C.fg} />
              </button>
            ))}
          </div>
          <button className="refresh" disabled={collecting} onClick={refresh} title="Collect fresh numbers for who is on screen now (a few cents of Apify per person)">
            <PixelText text={collecting ? 'COLLECTING...' : `REFRESH ${data.scope.name.split(' ')[0]}`} px={2} color={collecting ? C.yellow : C.green} />
          </button>
          </>
          )}
          <button className="toggle" onClick={() => setHelp(true)} title="How it works">
            <PixelText text="?" px={2} />
          </button>
          <button className="toggle" onClick={() => startCinema(true)} title="Let the camera tour the stats; move the mouse to return">
            <PixelText text="CINEMA" px={2} />
          </button>
          <button className={`toggle ${details ? 'on' : ''}`} onClick={toggleDetails} title="Controls, breakdowns and collection status">
            <PixelText text={details ? 'DETAILS ON' : 'DETAILS'} px={2} color={details ? C.bg : C.fg} />
          </button>
        </nav>
      </header>

      <aside className="left">
        <ScoreTile data={data} visible={visible} mix={mix} onMode={setMode} onReset={() => setMix({})} cumulative={cumulative} onCumulative={setCumulative} />
        <Tile kicker="FOLLOWERS" icon="followers">
          <Stat value={fmt(t.followers)} delta={`${signed(t.delta.d7)} 7D`} deltaColor={trendColor(t.delta.d7)} note={`${signed(t.delta.d1)} 1D  ${signed(t.delta.d30)} 30D`} />
          <PixelChart values={data.followerSeries} color={C.green} w={170} h={26} />
          {details && (
            <ul className="accounts">
              {accounts.map((a) => (
                <li key={a.id}>
                  <a href={a.url} target="_blank" rel="noreferrer">
                    {a.avatar ? <img src={a.avatar} alt="" /> : <span className="noav" />}
                    <PixelText text={PLATFORM_LABEL[a.platform]} px={2} color={platformText(a.platform)} />
                    <span className="grow" />
                    {a.stars ? (
                      // GitHub: stars, not followers.
                      <span className="metric" title={a.handle.includes('/') ? 'Stars on this repository, and new stars in 7 days' : 'Stars across their own repositories, and the change in 7 days'}>
                        <PixelIcon name="star" px={2} color={C.yellow} />
                        <PixelText text={fmt(a.stars.total)} px={2} />
                      </span>
                    ) : (
                      <span className="metric" title="Followers, and the change in 7 days">
                        <PixelIcon name="followers" px={2} color={C.gray} />
                        <PixelText text={fmt(a.followers)} px={2} />
                      </span>
                    )}
                    <PixelText text={signed(a.stars ? a.stars.d7 : a.delta.d7)} px={2} color={trendColor(a.stars ? a.stars.d7 : a.delta.d7)} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Tile>
      </aside>

      <aside className="right">
        <ActivityTile data={data} visible={visible} />
        {details && (
        <Tile kicker={`TOP POSTS ${days}D`}>
          <ol className="top-posts">
              {top.map((p, i) => (
                <li key={p.id} onMouseEnter={() => setHovered(p)} onMouseLeave={() => setHovered(null)}>
                  <a href={p.url ?? undefined} target="_blank" rel="noreferrer">
                    <PixelText text={String(i + 1)} px={2} color={C.gray} />
                    <span className="sw" style={{ background: PLATFORM_COLOR[p.platform] }} />
                    <PixelText text={(p.text ?? '').replace(/\s+/g, ' ').slice(0, 20)} px={2} />
                    <span className="grow" />
                    <PixelText text={fmt(p.score)} px={2} color={ratingColor(p)} />
                  </a>
                </li>
              ))}
              {!top.length && <PixelText text="NO POSTS IN RANGE" px={2} color={C.gray} />}
          </ol>
        </Tile>
        )}
        {hovered && (
          <Tile kicker="POST">
            <PostCard post={hovered} />
          </Tile>
        )}
        {details && <ReachTile data={data} />}
        {details && data.github.repos.map((r) => <RepoTile key={r.repo} r={r} days={days} />)}
        {details && data.impact.githubParts.length > 0 && <GithubScoreTile data={data} />}
      </aside>

      {details && (
      <footer className="bottom">
        <PixelText text="CREATORIZZ" px={2} color={C.gray} />
        <PixelText text={`LAST RUN ${ago(data.lastCollectedAt)}  .  DAILY 07:00`} px={2} color={C.gray} />
        <PixelText
          text={`APIFY $${data.budget.spentUsd.toFixed(2)} / $${data.budget.capUsd}`}
          px={2}
          color={data.budget.spentUsd > data.budget.capUsd * 0.8 ? C.red : C.gray}
        />
      </footer>
      )}
      {error && <div className="err"><PixelText text={error} px={1} color={C.red} /></div>}
    </>
  );
}
