import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { accounts, DATA_DIR, db, finishRun, lastOkRun, startRun } from './db.ts';
import { collect, isRunning, JOBS, OPTIONAL_JOBS } from './jobs.ts';

/** Local time of the daily collection, "HH:MM". */
const DAILY_AT = process.env.DAILY_AT ?? '07:00';
const TICK_MS = 10 * 60_000;

function todaysSlot(): Date {
  const [h, m] = DAILY_AT.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Checks every 10 minutes whether today's run has happened. A machine that slept through
 * the slot catches up on the first tick after it wakes, and never runs twice in one day.
 */
async function tick() {
  const slot = todaysSlot();
  if (Date.now() < slot.getTime() || isRunning()) return;
  const since = slot.toISOString();
  const done = db.prepare("SELECT 1 FROM run WHERE job = 'daily' AND started_at >= ? LIMIT 1").get(since);
  if (done) return;
  // A manual refresh after the slot already did today's work; don't pay for it twice.
  const fresh = accounts().every((a) =>
    JOBS.filter((j) => j.startsWith(a.platform) && !OPTIONAL_JOBS.includes(j)).every((j) => (lastOkRun(j, a.id) ?? '') >= since),
  );
  if (fresh) return;
  const id = startRun('daily', null);
  const out = await collect();
  const failed = out.filter((o) => o.status === 'error').length;
  finishRun(id, {
    status: failed ? 'error' : 'ok',
    items: out.length,
    note: out.map((o) => `${o.job} ${o.account} ${o.status}${o.note ? ` (${o.note})` : ''}`).join('; '),
  });
  console.log(`[daily] ${out.length} jobs, ${failed} failed`);
  backup();
}

const KEEP_BACKUPS = 14;

/**
 * A consistent copy of the database after each daily run (VACUUM INTO is safe while the app
 * is running), in data/backups/, keeping the last two weeks.
 */
function backup() {
  try {
    const dir = resolve(DATA_DIR, 'backups');
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `creatorizz-${new Date().toISOString().slice(0, 10)}.db`);
    if (!existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const old = readdirSync(dir).filter((f) => /^creatorizz-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -KEEP_BACKUPS);
    for (const f of old) rmSync(resolve(dir, f));
    console.log(`[backup] ${file}`);
  } catch (e) {
    console.error('[backup] failed', e);
  }
}

export function startScheduler() {
  const run = () => tick().catch((e) => console.error('[daily]', e));
  setTimeout(run, 5_000);
  setInterval(run, TICK_MS);
  console.log(`[daily] collection scheduled at ${DAILY_AT} local`);
}
