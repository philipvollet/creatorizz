import { accounts, finishRun, lastOkRun, now, saveRaw, startRun, type Account } from './db.ts';
import { BudgetExceeded, reconcileCosts, runActor } from './apify.ts';
import * as linkedin from './collectors/linkedin.ts';
import * as x from './collectors/x.ts';
import * as github from './collectors/github.ts';
import { SWEEPS } from './collectors/social.ts';
import { cacheThumbs } from './thumbs.ts';
import { importExports } from './collectors/linkedin-export.ts';
import * as linkedinBrowser from './collectors/linkedin-browser.ts';

export type JobName =
  | 'github'
  | 'linkedin.profile'
  | 'linkedin.posts'
  | 'linkedin.import'
  | 'linkedin.browser'
  | 'x.sweep'
  | 'instagram.sweep'
  | 'tiktok.sweep'
  | 'youtube.sweep'
  | 'reddit.sweep';
// The LinkedIn impression jobs run after linkedin.posts so new posts are known.
export const JOBS: JobName[] = [
  'github',
  'linkedin.profile',
  'linkedin.posts',
  'linkedin.import',
  'linkedin.browser',
  'x.sweep',
  'instagram.sweep',
  'tiktok.sweep',
  'youtube.sweep',
  'reddit.sweep',
];
/** Optional, local jobs: they never make a day's collection look unfinished. */
export const OPTIONAL_JOBS: JobName[] = ['linkedin.import', 'linkedin.browser'];

const PLATFORM: Record<JobName, Account['platform']> = {
  github: 'github',
  'linkedin.profile': 'linkedin',
  'linkedin.posts': 'linkedin',
  'linkedin.import': 'linkedin',
  'linkedin.browser': 'linkedin',
  'x.sweep': 'x',
  'instagram.sweep': 'instagram',
  'tiktok.sweep': 'tiktok',
  'youtube.sweep': 'youtube',
  'reddit.sweep': 'reddit',
};

// A second press within this window is almost always a double click, not a wish to pay twice.
const DEBOUNCE_MS = 15 * 60_000;

export interface JobOutcome {
  job: JobName;
  account: string;
  status: 'ok' | 'error' | 'skipped';
  items?: number;
  costUsd?: number;
  note?: string;
}

async function runOne(job: JobName, account: Account, force: boolean): Promise<JobOutcome> {
  const label = `${account.platform}:${account.handle}`;
  const last = lastOkRun(job, account.id);
  if (!force && job !== 'github' && job !== 'linkedin.import' && last && Date.now() - Date.parse(last) < DEBOUNCE_MS) {
    return { job, account: label, status: 'skipped', note: `ran ${Math.round((Date.now() - Date.parse(last)) / 60_000)} min ago` };
  }

  const takenAt = now();
  if (job === 'github') {
    const id = startRun(job, account.id);
    try {
      const repo = github.isRepo(account);
      const body = repo ? await github.fetchRepo(account) : await github.fetchUser(account);
      saveRaw(id, body);
      const items = repo ? await github.ingestRepo(account, body, takenAt) : await github.ingestUser(account, body as any, takenAt);
      finishRun(id, { status: 'ok', items });
      return { job, account: label, status: 'ok', items, costUsd: 0 };
    } catch (e) {
      finishRun(id, { status: 'error', note: String(e) });
      return { job, account: label, status: 'error', note: String(e) };
    }
  }

  if (job === 'linkedin.browser') {
    if (!linkedinBrowser.enabled()) return { job, account: label, status: 'skipped', note: 'LINKEDIN_BROWSER is not on' };
    const id = startRun(job, account.id);
    try {
      const r = await linkedinBrowser.readImpressions(account, takenAt);
      finishRun(id, { status: 'ok', items: r.items, note: r.note });
      return { job, account: label, status: 'ok', items: r.items, costUsd: 0, note: r.note };
    } catch (e: any) {
      finishRun(id, { status: 'error', note: String(e.message ?? e) });
      return { job, account: label, status: 'error', note: String(e.message ?? e) };
    }
  }

  if (job === 'linkedin.import') {
    const id = startRun(job, account.id);
    try {
      const r = await importExports(account);
      finishRun(id, { status: 'ok', items: r.items, note: r.note });
      return { job, account: label, status: 'ok', items: r.items, costUsd: 0, note: r.note };
    } catch (e) {
      finishRun(id, { status: 'error', note: String(e) });
      return { job, account: label, status: 'error', note: String(e) };
    }
  }

  const social = job.endsWith('.sweep') && job !== 'x.sweep' ? SWEEPS[PLATFORM[job] as keyof typeof SWEEPS] : null;
  const spec =
    job === 'linkedin.profile'
      ? { actor: linkedin.profileActor(account), input: linkedin.profileInput(account), maxCharge: linkedin.profileMaxCharge }
      : job === 'linkedin.posts'
        ? linkedin.postsInput(account)
        : social
          ? { actor: social.actor, ...social.input(account) }
          : { actor: x.ACTOR, ...x.sweepInput(account) };

  const id = startRun(job, account.id, spec.actor);
  try {
    const res = await runActor(spec.actor, spec.input, spec.maxCharge);
    saveRaw(id, res.items);
    const items =
      job === 'linkedin.profile'
        ? await linkedin.ingestProfile(account, res.items, takenAt)
        : job === 'linkedin.posts'
          ? linkedin.ingestPosts(account, res.items, takenAt)
          : social
            ? await social.ingest(account, res.items, takenAt)
            : await x.ingestSweep(account, res.items, takenAt);
    finishRun(id, { status: 'ok', items, costUsd: res.costUsd, apifyRunId: res.apifyRunId });
    // Keep thumbnails while their URLs still work.
    if (job !== 'linkedin.profile') await cacheThumbs(account.id).catch(() => 0);
    return { job, account: label, status: 'ok', items, costUsd: res.costUsd };
  } catch (e: any) {
    const status = e instanceof BudgetExceeded ? 'skipped' : 'error';
    finishRun(id, { status, costUsd: e.costUsd ?? 0, note: String(e.message ?? e) });
    return { job, account: label, status, note: String(e.message ?? e) };
  }
}

let running: Promise<JobOutcome[]> | null = null;

export function isRunning() {
  return running !== null;
}

/**
 * Runs the given jobs (default: all) for every active account (or only those of the given
 * personas), one at a time. Only one
 * collection runs at once; a call while one is in flight joins it instead of starting another.
 */
export function collect(opts: { jobs?: JobName[]; force?: boolean; personas?: string[] } = {}): Promise<JobOutcome[]> {
  if (running) return running;
  const jobs = opts.jobs ?? JOBS;
  // Only these people's accounts, when given (a refresh from one person's view).
  const only = opts.personas ? new Set(opts.personas) : null;
  running = (async () => {
    // The budget check below needs true spend, not first estimates.
    await reconcileCosts();
    const out: JobOutcome[] = [];
    for (const job of jobs) {
      for (const account of accounts(PLATFORM[job])) {
        if (only && !only.has(account.persona_id)) continue;
        out.push(await runOne(job, account, !!opts.force));
      }
    }
    // And once more at the end, so the dashboard shows settled costs straight away.
    await reconcileCosts();
    return out;
  })().finally(() => {
    running = null;
  });
  return running;
}
