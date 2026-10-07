import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, ROOT, tx, type Platform } from './db.ts';

interface Config {
  personas: {
    id: string;
    name: string;
    kind: 'person' | 'company';
    accounts: {
      platform: Platform;
      handle: string;
      url: string;
      /** Reddit only: usernames whose posts in the subreddit count. Anyone else's are ignored. */
      authors?: string[];
    }[];
  }[];
  groups: { id: string; name: string; members: string[] }[];
}

export const CONFIG_PATH = resolve(ROOT, process.env.CREATORIZZ_CONFIG ?? 'config.json');

/** The config file, or an empty one when it doesn't exist yet (a fresh install). */
function readConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return { personas: [], groups: [] };
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Config;
}

export const hasConfig = () => readConfig().personas.length > 0;

/** Per-account options from config.json that the database doesn't hold (read fresh each time). */
export function accountOptions(platform: Platform, handle: string): { authors: string[] } {
  const cfg = readConfig();
  const a = cfg.personas.flatMap((p) => p.accounts).find((x) => x.platform === platform && x.handle === handle);
  return { authors: (a?.authors ?? []).map((u) => u.toLowerCase()) };
}

/** Mirrors config.json into the db. Accounts dropped from the config are deactivated, never deleted. */
export function syncConfig() {
  const cfg = readConfig();
  if (!cfg.personas.length) console.warn(`[config] no one to track yet: create ${CONFIG_PATH} (see README, "Who is tracked")`);
  tx(() => {
    const keep = new Set<string>();
    for (const p of cfg.personas) {
      db.prepare(
        'INSERT INTO persona (id, name, kind) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind',
      ).run(p.id, p.name, p.kind);
      for (const a of p.accounts) {
        keep.add(`${a.platform}:${a.handle}`);
        db.prepare(
          `INSERT INTO account (persona_id, platform, handle, url) VALUES (?, ?, ?, ?)
           ON CONFLICT (platform, handle) DO UPDATE SET persona_id = excluded.persona_id, url = excluded.url, active = 1`,
        ).run(p.id, a.platform, a.handle, a.url);
      }
    }
    for (const a of db.prepare('SELECT id, platform, handle FROM account').all() as { id: number; platform: string; handle: string }[]) {
      if (!keep.has(`${a.platform}:${a.handle}`)) db.prepare('UPDATE account SET active = 0 WHERE id = ?').run(a.id);
    }
    db.exec('DELETE FROM grp_member');
    db.exec('DELETE FROM grp');
    for (const g of cfg.groups) {
      db.prepare('INSERT INTO grp (id, name) VALUES (?, ?)').run(g.id, g.name);
      for (const m of g.members) db.prepare('INSERT INTO grp_member (group_id, persona_id) VALUES (?, ?)').run(g.id, m);
    }
  });
}
