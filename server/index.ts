import { createServer, type RequestListener, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, normalize } from 'node:path';
import { AVATAR_DIR, db, ROOT } from './db.ts';
import { hasConfig, syncConfig } from './config.ts';
import { collect, isRunning, JOBS, type JobName } from './jobs.ts';
import { dashboard, lastCollectedAt, parseScope, personaIds, scopes } from './stats.ts';
import { startScheduler } from './scheduler.ts';
import { THUMB_DIR } from './thumbs.ts';

const PORT = Number(process.env.PORT ?? 4410);
const HOST = process.env.HOST ?? '127.0.0.1';
const WEB_DIST = resolve(ROOT, 'web/dist');
// Lets an open dashboard notice a restart (a new build or config) and reload itself.
const STARTED_AT = new Date().toISOString();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function file(res: ServerResponse, base: string, rel: string, fallback?: string): boolean {
  const path = normalize(resolve(base, '.' + rel));
  if (!path.startsWith(base)) return false;
  const target = existsSync(path) && statSync(path).isFile() ? path : fallback;
  if (!target) return false;
  res.writeHead(200, { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream' });
  createReadStream(target).pipe(res);
  return true;
}

syncConfig();
// Only one server runs collections, so a run still marked running now was cut off by a restart.
db.exec("UPDATE run SET status = 'error', finished_at = started_at, note = 'interrupted: server restarted mid-run' WHERE status = 'running'");

const handler: RequestListener = async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  try {
    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, collecting: isRunning(), lastCollectedAt: lastCollectedAt(), startedAt: STARTED_AT });
    }
    if (url.pathname === '/api/scopes') return json(res, 200, scopes());
    if ((url.pathname === '/api/dashboard' || url.pathname === '/api/scopes') && !hasConfig()) {
      return json(res, 503, { error: 'No one to track yet: add config.json (see the README).' });
    }
    if (url.pathname === '/api/dashboard') {
      const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 7), 7), 365);
      return json(res, 200, dashboard(parseScope(url.searchParams.get('scope')), days));
    }
    if (url.pathname === '/api/collect' && req.method === 'POST') {
      // Manual refresh. Answers at once; the dashboard polls /api/health until it is done.
      const only = url.searchParams.get('jobs')?.split(',').filter((j): j is JobName => JOBS.includes(j as JobName));
      if (isRunning()) return json(res, 409, { error: 'a collection is already running' });
      // With a scope, only that person's (or group's) accounts are collected.
      const scope = url.searchParams.get('scope');
      collect({ jobs: only?.length ? only : undefined, force: url.searchParams.get('force') === '1', personas: scope ? personaIds(parseScope(scope)) : undefined })
        .then((out) => console.log('[manual]', out.map((o) => `${o.job} ${o.status}`).join(', ')))
        .catch((e) => console.error('[manual]', e));
      return json(res, 202, { started: true });
    }
    if (url.pathname.startsWith('/avatars/') && file(res, AVATAR_DIR, url.pathname.slice('/avatars'.length))) return;
    if (url.pathname.startsWith('/thumbs/') && file(res, THUMB_DIR, url.pathname.slice('/thumbs'.length))) return;
    if (existsSync(WEB_DIST) && file(res, WEB_DIST, url.pathname === '/' ? '/index.html' : url.pathname, resolve(WEB_DIST, 'index.html'))) return;
    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: String(e) });
  }
};

createServer(handler).listen(PORT, HOST, () => {
  console.log(`creatorizz on http://${HOST}:${PORT}`);
  startScheduler();
});

// When serving on a network address, also answer on loopback, so this machine can always reach
// the app (a NetBird peer in userspace mode can't connect to its own NetBird IP) and the
// watchdog's health check doesn't depend on the network being up. Loopback is not reachable
// from other machines.
if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
  createServer(handler)
    .on('error', (e) => console.error(`[loopback] not listening on 127.0.0.1:${PORT}:`, e.message))
    .listen(PORT, '127.0.0.1', () => console.log(`creatorizz also on http://127.0.0.1:${PORT}`));
}
