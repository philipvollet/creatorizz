// Reads LinkedIn post impressions the way you would: a normal, visible Chrome window, logged in
// as you, opens each recent post's analytics page, the text on screen is read, and the window
// closes. It never clicks, types or scrolls, and it stops at the first login or security check.
//
// Off unless LINKEDIN_BROWSER=on. It uses its own Chrome profile under data/linkedin-browser/,
// which you sign into once by hand with `npm run linkedin:login`; creatorizz never sees your
// password, and the session stays on this machine. LinkedIn does not allow automated access,
// so this carries a small risk to the account; it runs at most once a day and only reads.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
import { DATA_DIR, db, tx, type Account } from '../db.ts';

const ROOT = resolve(DATA_DIR, 'linkedin-browser');
const profileDir = (account: Account) => resolve(ROOT, 'profiles', account.handle);

export class LoginNeeded extends Error {}

export const enabled = () => process.env.LINKEDIN_BROWSER === 'on';

function launch(account: Account): Promise<BrowserContext> {
  mkdirSync(profileDir(account), { recursive: true });
  // The installed Chrome, visible, with its own persistent profile.
  return chromium.launchPersistentContext(profileDir(account), {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
}

const signedOut = (url: string) => /\/(login|checkpoint|authwall|uas\/login)/.test(url);

/**
 * Opens LinkedIn's sign-in page in creatorizz's Chrome profile and waits for you to sign in
 * and close the window. Only checks that a session exists afterwards; never reads its value.
 */
export async function login(account: Account): Promise<boolean> {
  const ctx = await launch(account);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('https://www.linkedin.com/login');
  console.log('Sign in to LinkedIn in the Chrome window, then close it.');
  await new Promise<void>((done) => ctx.on('close', () => done()));
  const check = await launch(account);
  const ok = (await check.cookies('https://www.linkedin.com')).some((c) => c.name === 'li_at');
  await check.close();
  return ok;
}

const IMPRESSIONS = /^(impressions?|impressionen|impresiones|impressões|weergaven)$/i;
const REACHED = /^(members reached|erreichte mitglieder|miembros alcanzados|membros alcançados|bereikte leden)$/i;
const NUMBER = /^[\d][\d.,\s]*$/;

const toNumber = (s: string) => Number(s.replace(/[.,\s]/g, ''));

/**
 * Reads impressions and members reached from the page text. LinkedIn puts each number on the
 * line above its label, the line below, or the same line ("1,234 impressions"). Which one is
 * decided once per page, from the first label, so neighbouring metrics can't be mixed up.
 */
export function readMetrics(text: string): { impressions: number | null; reached: number | null } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const isLabel = (l: string) => IMPRESSIONS.test(l) || REACHED.test(l);
  const first = lines.findIndex(isLabel);
  const step = first > 0 && NUMBER.test(lines[first - 1]) ? -1 : 1;
  const read = (label: RegExp): number | null => {
    for (let i = 0; i < lines.length; i++) {
      if (label.test(lines[i]) && lines[i + step] && NUMBER.test(lines[i + step])) return toNumber(lines[i + step]);
      const inline = lines[i].match(/^([\d][\d.,]*)\s+(.+)$/);
      if (inline && label.test(inline[2])) return toNumber(inline[1]);
    }
    return null;
  };
  return { impressions: read(IMPRESSIONS), reached: read(REACHED) };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Posts worth a look: everything still followed, plus anything from the last 30 days. */
function postsToRead(accountId: number) {
  return db
    .prepare(
      `SELECT id, platform_post_id FROM post WHERE account_id = ? AND kind != 'repost'
       AND (tier != 'stale' OR posted_at >= ?) ORDER BY posted_at DESC LIMIT 15`,
    )
    .all(accountId, new Date(Date.now() - 30 * 24 * 3600_000).toISOString()) as { id: number; platform_post_id: string }[];
}

export async function readImpressions(account: Account, takenAt: string) {
  const posts = postsToRead(account.id);
  if (!posts.length) return { items: 0, note: 'no recent posts' };
  const dayDir = resolve(ROOT, 'pages', takenAt.slice(0, 10));
  mkdirSync(dayDir, { recursive: true });

  const ctx = await launch(account);
  const results: { postId: number; impressions: number; reached: number | null }[] = [];
  const unread: string[] = [];
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    for (const p of posts) {
      await page.goto(`https://www.linkedin.com/analytics/post-summary/urn:li:activity:${p.platform_post_id}/`, { waitUntil: 'domcontentloaded' });
      if (signedOut(page.url())) throw new LoginNeeded('LinkedIn asked to sign in; run `npm run linkedin:login`');
      // Wait for the numbers to render rather than for the network to go quiet.
      await page.waitForFunction(() => /\d/.test(document.body?.innerText ?? '') && document.body.innerText.length > 400, null, { timeout: 20_000 }).catch(() => {});
      const text = await page.evaluate(() => document.body.innerText);
      // Kept for a day-by-day record and to fix the reader if LinkedIn changes the page.
      writeFileSync(resolve(dayDir, `${p.platform_post_id}.txt`), text);
      const { impressions, reached } = readMetrics(text);
      if (impressions === null) unread.push(p.platform_post_id);
      else results.push({ postId: p.id, impressions, reached });
      // Read at a person's pace, not a crawler's.
      await pause(3000 + Math.random() * 4000);
    }
  } finally {
    await ctx.close();
  }

  tx(() => {
    const ins = db.prepare('INSERT OR REPLACE INTO post_impression (post_id, taken_at, impressions, members_reached, source) VALUES (?, ?, ?, ?, ?)');
    for (const r of results) ins.run(r.postId, takenAt, r.impressions, r.reached, 'browser');
  });
  const note = `${results.length} of ${posts.length} posts read` + (unread.length ? `; no impressions found on ${unread.join(', ')} (page text saved in ${dayDir})` : '');
  if (!results.length) throw new Error(note);
  return { items: results.length, note };
}
