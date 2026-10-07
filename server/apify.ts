import { db } from './db.ts';

const API = 'https://api.apify.com/v2';

export function monthlyCapUsd(): number {
  return Number(process.env.APIFY_MONTHLY_CAP_USD ?? 5);
}

/** What creatorizz itself spent on Apify this calendar month (UTC), from its own run log. */
export function spentThisMonthUsd(): number {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  const r = db.prepare('SELECT coalesce(sum(cost_usd), 0) AS s FROM run WHERE started_at >= ?').get(start) as { s: number };
  return r.s;
}

export class BudgetExceeded extends Error {}

/**
 * What a run costs. `usageTotalUsd` lags behind for a while after a run ends, so it is
 * also priced from the charged event counts (at the highest tier price, to err high).
 */
export function chargeOf(run: any): number {
  const events = run.pricingInfo?.pricingPerEvent?.actorChargeEvents ?? {};
  let fromEvents = 0;
  for (const [name, count] of Object.entries<number>(run.chargedEventCounts ?? {})) {
    const e = events[name];
    if (!e || !count) continue;
    const price = e.eventPriceUsd ?? Math.max(...Object.values<any>(e.eventTieredPricingUsd ?? {}).map((t) => t.tieredEventPriceUsd ?? 0), 0);
    fromEvents += count * price;
  }
  return Math.max(Number(run.usageTotalUsd ?? 0), fromEvents);
}

/** Replaces recent cost estimates with what Apify settled on, once it has. */
export async function reconcileCosts() {
  const token = process.env.APIFY_TOKEN;
  if (!token) return;
  const since = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
  const rows = db.prepare('SELECT id, apify_run_id, cost_usd FROM run WHERE apify_run_id IS NOT NULL AND started_at >= ?').all(since) as { id: number; apify_run_id: string; cost_usd: number }[];
  for (const r of rows) {
    try {
      const res = await fetch(`${API}/actor-runs/${r.apify_run_id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) continue;
      const cost = chargeOf((await res.json()).data);
      if (Math.abs(cost - r.cost_usd) > 1e-6) db.prepare('UPDATE run SET cost_usd = ? WHERE id = ?').run(cost, r.id);
    } catch {
      // Next run tries again.
    }
  }
}

export interface ActorResult<T> {
  items: T[];
  costUsd: number;
  apifyRunId: string;
}

/**
 * Runs an actor and returns its dataset. `maxChargeUsd` is the per-run ceiling Apify enforces;
 * the run is refused up front if it could push this month past the cap.
 */
export async function runActor<T = any>(actorId: string, input: unknown, maxChargeUsd: number): Promise<ActorResult<T>> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is not set');
  const spent = spentThisMonthUsd();
  const cap = monthlyCapUsd();
  if (spent + maxChargeUsd > cap) {
    throw new BudgetExceeded(`budget: spent $${spent.toFixed(3)} of $${cap} this month, run could cost $${maxChargeUsd}`);
  }

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const start = await fetch(`${API}/acts/${actorId}/runs?waitForFinish=60&maxTotalChargeUsd=${maxChargeUsd}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  if (!start.ok) throw new Error(`apify start ${actorId}: ${start.status} ${await start.text()}`);
  let run = (await start.json()).data;

  const deadline = Date.now() + 10 * 60_000;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
    if (Date.now() > deadline) throw new Error(`apify ${actorId}: run ${run.id} still ${run.status} after 10 min`);
    const r = await fetch(`${API}/actor-runs/${run.id}?waitForFinish=60`, { headers });
    run = (await r.json()).data;
  }
  run = (await (await fetch(`${API}/actor-runs/${run.id}`, { headers })).json()).data;
  const costUsd = chargeOf(run);
  if (run.status !== 'SUCCEEDED') {
    const err = new Error(`apify ${actorId}: run ${run.id} ${run.status}`) as Error & { costUsd?: number };
    err.costUsd = costUsd;
    throw err;
  }
  const res = await fetch(`${API}/datasets/${run.defaultDatasetId}/items?clean=1&format=json`, { headers });
  const items = (await res.json()) as T[];
  return { items, costUsd, apifyRunId: run.id };
}
