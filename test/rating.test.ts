import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratePosts, projectLifetime } from '../server/rating.ts';

const day = 24 * 3600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

/** A LinkedIn post `daysAgo` old, last read now, with this lifetime engagement. */
const post = (daysAgo: number, score: number) => ({ platform: 'linkedin', handle: 'someone', postedAt: iso(daysAgo * day), score, seenAt: iso(0) });

test('an account needs three earlier posts before its posts are rated', () => {
  const posts = [post(40, 10), post(30, 10), post(20, 10)];
  const r = ratePosts(posts);
  for (const p of posts) assert.equal(r.get(p)!.rating, null);
});

test('posts are rated against the median of the earlier ones', () => {
  const base = [post(50, 10), post(40, 10), post(30, 10)];
  const hot = post(20, 25);
  const good = post(19, 12);
  const meh = post(18, 6);
  const shit = post(17, 2);
  const r = ratePosts([...base, hot, good, meh, shit]);
  assert.equal(r.get(hot)!.rating, 'hot');
  assert.equal(r.get(good)!.rating, 'good');
  assert.equal(r.get(meh)!.rating, 'meh');
  assert.equal(r.get(shit)!.rating, 'shit');
});

test('young posts are projected forward, at most four times what they have', () => {
  const young = { platform: 'linkedin', handle: 'someone', postedAt: iso(3600_000), score: 10, seenAt: iso(0) };
  assert.equal(projectLifetime(young), 40);
  const old = post(30, 10);
  assert.ok(Math.abs(projectLifetime(old) - 10) < 0.01);
});

test('accounts are rated separately', () => {
  const a = [post(50, 100), post(40, 100), post(30, 100)];
  const b = [50, 40, 30].map((d) => ({ ...post(d, 1), handle: 'other' }));
  const bNew = { ...post(10, 2), handle: 'other' };
  const r = ratePosts([...a, ...b, bNew]);
  assert.equal(r.get(bNew)!.rating, 'hot');
});
