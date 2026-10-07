import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));

// CREATORIZZ_DATA points tests (or a second install) at another folder.
export const DATA_DIR = process.env.CREATORIZZ_DATA ? resolve(process.env.CREATORIZZ_DATA) : resolve(ROOT, 'data');
export const AVATAR_DIR = resolve(DATA_DIR, 'avatars');


mkdirSync(AVATAR_DIR, { recursive: true });

export const PLATFORMS = ['linkedin', 'x', 'github', 'instagram', 'tiktok', 'youtube', 'reddit'] as const;

export const db = new DatabaseSync(resolve(DATA_DIR, 'creatorizz.db'));
migrate();
db.exec(readFileSync(resolve(ROOT, 'server/schema.sql'), 'utf8'));
db.exec('PRAGMA busy_timeout = 5000');

/**
 * Schema changes SQLite can't make in place (CHECK constraints): the table is rebuilt once,
 * inside a transaction, with foreign keys paused so rows that point at it stay linked.
 */
function rebuild(table: string, fix: (sql: string) => string, select: string) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | undefined;
  if (!row || fix(row.sql) === row.sql) return;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(fix(row.sql).replace(/CREATE TABLE "?\w+"?/, `CREATE TABLE ${table}_new`));
    db.exec(`INSERT INTO ${table}_new SELECT ${select} FROM ${table}`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function migrate() {
  // The revisit tier 'hot' became 'active' once 'hot' started to mean a post doing well.
  rebuild(
    'post',
    (sql) => sql.replace(/'hot'/g, "'active'"),
    "id, account_id, platform_post_id, url, posted_at, kind, text, media, CASE tier WHEN 'hot' THEN 'active' ELSE tier END, next_check_at, last_checked_at",
  );
  // The platform list grows (Instagram, TikTok, YouTube, Reddit joined LinkedIn, X, GitHub).
  rebuild('account', (sql) => sql.replace(/platform IN \([^)]*\)/, `platform IN (${PLATFORMS.map((p) => `'${p}'`).join(', ')})`), '*');
}

export type Platform = (typeof PLATFORMS)[number];
/** Revisit tier: how often a post is re-read. Says nothing about how well it does. */
export type Tier = 'active' | 'warm' | 'cooling' | 'stale';

export interface Account {
  id: number;
  persona_id: string;
  platform: Platform;
  handle: string;
  url: string;
  display_name: string | null;
  avatar_file: string | null;
  avatar_updated_at: string | null;
}

export const now = () => new Date().toISOString();

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function accounts(platform?: Platform): Account[] {
  const sql = 'SELECT * FROM account WHERE active = 1' + (platform ? ' AND platform = ?' : '') + ' ORDER BY id';
  return (platform ? db.prepare(sql).all(platform) : db.prepare(sql).all()) as unknown as Account[];
}

export function startRun(job: string, accountId: number | null, actorId: string | null = null): number {
  const r = db
    .prepare('INSERT INTO run (job, account_id, started_at, actor_id) VALUES (?, ?, ?, ?)')
    .run(job, accountId, now(), actorId);
  return Number(r.lastInsertRowid);
}

export function finishRun(
  id: number,
  fields: { status: 'ok' | 'error' | 'skipped'; items?: number; costUsd?: number; apifyRunId?: string; note?: string },
) {
  db.prepare(
    'UPDATE run SET finished_at = ?, status = ?, items = ?, cost_usd = ?, apify_run_id = ?, note = ? WHERE id = ?',
  ).run(now(), fields.status, fields.items ?? null, fields.costUsd ?? 0, fields.apifyRunId ?? null, fields.note ?? null, id);
}

export function saveRaw(runId: number, body: unknown) {
  db.prepare('INSERT OR REPLACE INTO raw_payload (run_id, body) VALUES (?, ?)').run(
    runId,
    gzipSync(JSON.stringify(body)),
  );
}

export function lastOkRun(job: string, accountId: number): string | null {
  const r = db
    .prepare("SELECT max(started_at) AS t FROM run WHERE job = ? AND account_id = ? AND status = 'ok'")
    .get(job, accountId) as { t: string | null };
  return r.t;
}

export function addAccountSnapshot(
  accountId: number,
  takenAt: string,
  s: { followers?: number | null; following?: number | null; postsCount?: number | null; extra?: unknown },
) {
  db.prepare(
    'INSERT INTO account_snapshot (account_id, taken_at, followers, following, posts_count, extra) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(accountId, takenAt, s.followers ?? null, s.following ?? null, s.postsCount ?? null, s.extra ? JSON.stringify(s.extra) : null);
}
