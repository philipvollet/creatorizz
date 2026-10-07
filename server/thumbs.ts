// Post thumbnails. Platform image URLs expire (LinkedIn, Instagram and TikTok within days or
// weeks), so the first image of each recent post is kept as a local file, like avatars.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, db } from './db.ts';

export const THUMB_DIR = resolve(DATA_DIR, 'thumbs');
mkdirSync(THUMB_DIR, { recursive: true });

const MAX_BYTES = 3_000_000;
const RECENT_DAYS = 90;

export const thumbFile = (postId: number) => resolve(THUMB_DIR, `${postId}.jpg`);
export const thumbUrl = (postId: number) => (existsSync(thumbFile(postId)) ? `/thumbs/${postId}.jpg` : null);

/** Saves a thumbnail for each recent post of the account that has an image and no file yet. */
export async function cacheThumbs(accountId: number) {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 3600_000).toISOString();
  const posts = db
    .prepare('SELECT id, media FROM post WHERE account_id = ? AND media IS NOT NULL AND posted_at >= ?')
    .all(accountId, since) as { id: number; media: string }[];
  let saved = 0;
  for (const p of posts) {
    if (existsSync(thumbFile(p.id))) continue;
    const url = (JSON.parse(p.media) as { url?: string }[]).find((m) => m.url?.startsWith('http'))?.url;
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) continue;
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_BYTES) continue;
      writeFileSync(thumbFile(p.id), body);
      saved++;
    } catch {
      // A thumbnail is cosmetic; the next run tries again while the URL lasts.
    }
  }
  return saved;
}
