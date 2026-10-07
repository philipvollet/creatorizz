// npm run collect                         every job, every account
// npm run collect -- github x.sweep       only these jobs
// npm run collect -- --force              ignore the 15-minute double-run guard
// npm run collect -- import <dir>         load saved actor outputs (li-profile, li-posts, x-tweets .json)
// npm run linkedin:login                  sign in once in creatorizz's own Chrome profile (for linkedin.browser)
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { accounts, finishRun, saveRaw, startRun } from './db.ts';
import { syncConfig } from './config.ts';
import { collect, JOBS, type JobName } from './jobs.ts';
import { spentThisMonthUsd, monthlyCapUsd } from './apify.ts';
import * as linkedin from './collectors/linkedin.ts';
import * as x from './collectors/x.ts';
import { login } from './collectors/linkedin-browser.ts';

syncConfig();
const args = process.argv.slice(2);

if (args[0] === 'linkedin-login') {
  for (const account of accounts('linkedin')) {
    console.log(`LinkedIn sign-in for ${account.handle}`);
    console.log((await login(account)) ? 'Signed in. Set LINKEDIN_BROWSER=on in .env to read impressions daily.' : 'No LinkedIn session found; run this again.');
  }
} else if (args[0] === 'import') {
  // Already paid for, so ingest instead of scraping again. Costs are the real ones from Apify.
  const dir = resolve(args[1] ?? 'data/discovery');
  const files: [string, JobName, string, number, (a: any, items: any[], t: string) => Promise<number> | number][] = [
    ['li-profile.json', 'linkedin.profile', linkedin.PROFILE_ACTOR, 0.004, linkedin.ingestProfile],
    ['li-posts.json', 'linkedin.posts', linkedin.POSTS_ACTOR, 0.01755, linkedin.ingestPosts],
    ['x-tweets.json', 'x.sweep', x.ACTOR, 0.006, x.ingestSweep],
  ];
  for (const [name, job, actor, cost, ingest] of files) {
    const path = resolve(dir, name);
    const items = JSON.parse(readFileSync(path, 'utf8'));
    const account = accounts(job.startsWith('x') ? 'x' : 'linkedin')[0];
    const takenAt = statSync(path).mtime.toISOString();
    const id = startRun(job, account.id, actor);
    saveRaw(id, items);
    const n = await ingest(account, items, takenAt);
    finishRun(id, { status: 'ok', items: n, costUsd: cost, note: `imported ${name}` });
    console.log(`${name}: ${n} rows`);
  }
} else {
  const jobs = args.filter((a) => JOBS.includes(a as JobName)) as JobName[];
  const out = await collect({ jobs: jobs.length ? jobs : undefined, force: args.includes('--force') });
  for (const o of out) {
    console.log(`${o.status.padEnd(7)} ${o.job.padEnd(17)} ${o.account.padEnd(28)} items=${o.items ?? '-'} $${(o.costUsd ?? 0).toFixed(4)}${o.note ? '  ' + o.note : ''}`);
  }
}
console.log(`apify this month: $${spentThisMonthUsd().toFixed(4)} of $${monthlyCapUsd()}`);
