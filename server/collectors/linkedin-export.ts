// LinkedIn shows impressions and members reached only to the author. Rather than log in as
// them, creatorizz reads LinkedIn's own analytics export: Analytics > Content > Export (or
// Export on a single post's analytics) gives an .xlsx, which goes in
// data/imports/linkedin/<handle>/, one folder per person.
// The content export has one fixed layout in every language; only labels and date formats
// change (layout as documented by github.com/obrenoalvim/linkedin-insights, MIT):
//   sheet 0 DISCOVERY    row 1 [label, impressions], row 2 [label, members reached]
//   sheet 1 ENGAGEMENT   row 0 header, then [date, impressions, engagements]
//   sheet 2 TOP POSTS    from row 3: [url, date, engagements, -, url, date, impressions]
// It is read by position. Other exports (a single post's analytics) fall back to matching labels.
import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import readXlsxFile from 'read-excel-file/node';
import { DATA_DIR, db, now, tx, type Account } from '../db.ts';

export const IMPORT_DIR = resolve(DATA_DIR, 'imports/linkedin');

type Cell = string | number | boolean | Date | null;

const text = (c: Cell) => (c === null || c === undefined ? '' : String(c).trim());
const num = (c: Cell): number | null => {
  if (typeof c === 'number') return c;
  const n = Number(text(c).replace(/[,\s]/g, ''));
  return text(c) && Number.isFinite(n) ? n : null;
};
const isUrl = (c: Cell) => /linkedin\.com\//i.test(text(c));
/** Long digit runs in a post URL: activity, share and ugcPost ids. */
const idsIn = (url: string) => url.match(/\d{15,}/g) ?? [];

type DateOrder = 'MD' | 'DM';

/** English exports write M/D/YYYY, most other locales D/M/YYYY or D.M.YYYY: any first part over 12 settles it. */
function dateOrder(cells: Cell[]): DateOrder {
  for (const c of cells) {
    const m = text(c).match(/^(\d{1,2})[./](\d{1,2})[./]\d{4}$/);
    if (m && Number(m[1]) > 12) return 'DM';
    if (m && Number(m[2]) > 12) return 'MD';
  }
  return text(cells.find((c) => /\./.test(text(c))) ?? null) ? 'DM' : 'MD';
}

function toDay(c: Cell, order: DateOrder = 'MD'): string | null {
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  const s = text(c);
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) {
    const [mo, d] = order === 'MD' ? [m[1], m[2]] : [m[2], m[1]];
    return `${m[3]}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

/** The content export, read by position. Null if the workbook doesn't have that shape. */
function parseContentExport(sheets: { data: Cell[][] }[]) {
  if (sheets.length < 5) return null;
  const top = sheets[2].data.slice(3).filter((r) => isUrl(r[0]) || isUrl(r[4]));
  if (!top.length) return null;
  const engagement = sheets[1].data.slice(1).filter((r) => text(r[0]));
  const order = dateOrder(engagement.map((r) => r[0]));
  const days = new Map<string, { impressions: number | null; engagements: number | null }>();
  for (const r of engagement) {
    const d = toDay(r[0], order);
    if (d) days.set(d, { impressions: num(r[1]), engagements: num(r[2]) });
  }
  const posts: PostRow[] = top.filter((r) => isUrl(r[4])).map((r) => ({ url: text(r[4]), impressions: num(r[6]), membersReached: null }));
  const discovery = sheets[0].data;
  return { posts, days, totals: { impressions: num(discovery[1]?.[1] ?? null), membersReached: num(discovery[2]?.[1] ?? null) } };
}

interface PostRow {
  url: string;
  impressions: number | null;
  membersReached: number | null;
}

/** Reads every sheet for per-post impressions and per-day totals. */
export function parseSheets(sheets: { sheet: string; data: Cell[][] }[]) {
  const byPosition = parseContentExport(sheets);
  if (byPosition) return byPosition;
  const posts = new Map<string, PostRow>();
  const days = new Map<string, { impressions: number | null; engagements: number | null }>();
  const upsertPost = (url: string, f: Partial<PostRow>) => {
    const cur = posts.get(url) ?? { url, impressions: null, membersReached: null };
    posts.set(url, { ...cur, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined)) });
  };

  for (const { data } of sheets) {
    for (let r = 0; r < data.length; r++) {
      const header = data[r].map((c) => text(c).toLowerCase());

      // Table layout: "Post URL | ... | Impressions" (possibly two tables side by side).
      const urlCols = header.flatMap((h, i) => (h.includes('post url') || h === 'url' ? [i] : []));
      if (urlCols.length) {
        for (const [i, h] of header.entries()) {
          const kind = h.includes('impression') ? 'impressions' : h.includes('members reached') ? 'membersReached' : null;
          if (!kind) continue;
          const urlCol = Math.max(...urlCols.filter((u) => u < i));
          if (!Number.isFinite(urlCol)) continue;
          for (let rr = r + 1; rr < data.length && isUrl(data[rr][urlCol]); rr++) {
            upsertPost(text(data[rr][urlCol]), { [kind]: num(data[rr][i]) });
          }
        }
        continue;
      }

      // Daily layout: "Date | Impressions | Engagements".
      const dateCol = header.findIndex((h) => h === 'date');
      const impCol = header.findIndex((h) => h.includes('impression'));
      if (dateCol >= 0 && impCol >= 0) {
        const engCol = header.findIndex((h) => h.includes('engagement'));
        for (let rr = r + 1; rr < data.length; rr++) {
          const d = toDay(data[rr][dateCol]);
          if (!d) break;
          days.set(d, { impressions: num(data[rr][impCol]), engagements: engCol >= 0 ? num(data[rr][engCol]) : null });
        }
      }
    }

    // Single-post export: label/value rows ("Post URL", "Impressions", "Members reached").
    const kv = new Map<string, Cell>();
    for (const row of data) {
      const k = text(row[0]).toLowerCase();
      if (k && row.length > 1) kv.set(k, row[1]);
    }
    const url = [...kv.entries()].find(([k, v]) => k.includes('url') && isUrl(v))?.[1];
    if (url) {
      const imp = [...kv.entries()].find(([k]) => k.includes('impression'))?.[1] ?? null;
      const reached = [...kv.entries()].find(([k]) => k.includes('members reached'))?.[1] ?? null;
      upsertPost(text(url), { impressions: num(imp), membersReached: num(reached) });
    }
  }
  return { posts: [...posts.values()], days, totals: null };
}

/** Maps every id LinkedIn uses for a post (activity, share, ugcPost) to our post row. */
function postIdIndex(accountId: number): Map<string, number> {
  const index = new Map<string, number>();
  for (const p of db.prepare('SELECT id, platform_post_id, url FROM post WHERE account_id = ?').all(accountId) as { id: number; platform_post_id: string; url: string | null }[]) {
    index.set(p.platform_post_id, p.id);
    for (const id of idsIn(p.url ?? '')) index.set(id, p.id);
  }
  // The scraper's raw items carry the share and ugcPost ids as well.
  const raws = db
    .prepare("SELECT r.body FROM raw_payload r JOIN run ON run.id = r.run_id WHERE run.job = 'linkedin.posts' AND run.account_id = ?")
    .all(accountId) as { body: Uint8Array }[];
  for (const { body } of raws) {
    for (const item of JSON.parse(gunzipSync(body).toString()) as any[]) {
      const own = index.get(String(item.entityId ?? item.id));
      if (!own) continue;
      for (const id of idsIn(JSON.stringify([item.shareUrn, item.engagement?.id, item.shareLinkedinUrl, item.linkedinUrl]))) index.set(id, own);
    }
  }
  return index;
}

/** Imports every new or changed export in the folder. Free; runs with every collection. */
export async function importExports(account: Account) {
  const dir = resolve(IMPORT_DIR, account.handle);
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(dir).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'));
  const results: string[] = [];
  let items = 0;
  for (const f of files) {
    const path = resolve(dir, f);
    const mtime = statSync(path).mtime.toISOString();
    const key = `${account.handle}/${f}`;
    const seen = db.prepare('SELECT mtime FROM import_file WHERE path = ?').get(key) as { mtime: string } | undefined;
    if (seen?.mtime === mtime) continue;

    const parsed = parseSheets((await readXlsxFile(path)) as { sheet: string; data: Cell[][] }[]);
    const index = postIdIndex(account.id);
    let matched = 0;
    const unmatched: string[] = [];
    tx(() => {
      for (const p of parsed.posts) {
        if (p.impressions === null) continue;
        const postId = idsIn(p.url).map((id) => index.get(id)).find((x) => x !== undefined);
        if (!postId) {
          unmatched.push(p.url);
          continue;
        }
        // The export is a reading as of when it was downloaded.
        db.prepare(
          'INSERT OR REPLACE INTO post_impression (post_id, taken_at, impressions, members_reached, source) VALUES (?, ?, ?, ?, ?)',
        ).run(postId, mtime, p.impressions, p.membersReached, f);
        matched++;
      }
      const day = db.prepare(
        `INSERT INTO account_day (account_id, day, impressions, engagements) VALUES (?, ?, ?, ?)
         ON CONFLICT (account_id, day) DO UPDATE SET impressions = coalesce(excluded.impressions, impressions), engagements = coalesce(excluded.engagements, engagements)`,
      );
      for (const [d, v] of parsed.days) day.run(account.id, d, v.impressions, v.engagements);
      const t = parsed.totals;
      const note = `${matched} posts matched, ${unmatched.length} unknown, ${parsed.days.size} days` +
        (t ? `; period: ${t.impressions ?? '?'} impressions, ${t.membersReached ?? '?'} members reached` : '');
      db.prepare('INSERT OR REPLACE INTO import_file (path, mtime, imported_at, note) VALUES (?, ?, ?, ?)').run(key, mtime, now(), note);
      results.push(`${f}: ${note}`);
    });
    items += matched + parsed.days.size;
  }
  return { items, note: results.join('; ') || 'no new exports' };
}
