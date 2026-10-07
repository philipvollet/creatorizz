import { test } from 'node:test';
import assert from 'node:assert/strict';

const { nextTier, engagementScore } = await import('../server/posts.ts');

const H = 3600_000;
const at = (hoursAfterPost: number) => new Date(Date.parse('2026-01-01T00:00:00Z') + hoursAfterPost * H).toISOString();
const posted = '2026-01-01T00:00:00Z';

test('engagement weighs comments and shares more than likes', () => {
  assert.equal(engagementScore({ likes: 10, comments: 2, shares: 1 }), 17);
});

test('revisit tiers follow the post age', () => {
  assert.equal(nextTier(posted, at(10), null, 5).tier, 'active');
  assert.equal(nextTier(posted, at(4 * 24), null, 5).tier, 'warm');
  assert.equal(nextTier(posted, at(10 * 24), 100, 110).tier, 'cooling');
  assert.equal(nextTier(posted, at(40 * 24), 100, 200).tier, 'stale');
});

test('a cooling post that stopped growing goes stale', () => {
  assert.equal(nextTier(posted, at(10 * 24), 100, 101).tier, 'stale');
  // Without a reading at least two days old, growth is unknown and the post keeps being followed.
  assert.equal(nextTier(posted, at(10 * 24), null, 101).tier, 'cooling');
});
