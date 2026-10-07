import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AVATAR_DIR, db, now, type Account } from './db.ts';

const WEEK = 7 * 24 * 3600_000;

/** Platform image URLs expire (LinkedIn's within weeks), so a local copy is kept and refreshed weekly. */
export async function refreshAvatar(account: Account, url: string | null | undefined, displayName?: string | null) {
  if (displayName) db.prepare('UPDATE account SET display_name = ? WHERE id = ?').run(displayName, account.id);
  if (!url) return;
  if (account.avatar_updated_at && Date.now() - Date.parse(account.avatar_updated_at) < WEEK) return;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    // Handles can hold slashes (GitHub repositories); keep the file name flat.
    const file = `${account.platform}-${account.handle.replace(/[^\w.-]/g, '_')}.jpg`;
    writeFileSync(resolve(AVATAR_DIR, file), Buffer.from(await res.arrayBuffer()));
    db.prepare('UPDATE account SET avatar_file = ?, avatar_updated_at = ? WHERE id = ?').run(file, now(), account.id);
  } catch {
    // An avatar is cosmetic; the next run tries again.
  }
}
