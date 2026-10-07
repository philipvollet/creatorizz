import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeTowers, towerHeight, TOWER_GAP } from '../web/src/lib/layout.ts';

const from = Date.parse('2026-09-01T00:00:00Z');
const span = 30 * 24 * 3600_000;

test('tower height is linear in engagement, with a visible floor', () => {
  assert.equal(towerHeight(300, 300), 3.2);
  assert.equal(towerHeight(150, 300), 1.6);
  assert.equal(towerHeight(0, 300), 0.12);
});

test('posts published at the same time never overlap', () => {
  const posts = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    platform: 'linkedin',
    postedAt: '2026-09-15T12:00:00Z',
    score: 10 + i,
  })) as any[];
  const placed = placeTowers(posts, from, span, 30);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const d = Math.hypot(Math.cos(a.angle) * a.radius - Math.cos(b.angle) * b.radius, Math.sin(a.angle) * a.radius - Math.sin(b.angle) * b.radius);
      assert.ok(d >= TOWER_GAP - 1e-9, `towers ${a.post.id} and ${b.post.id} overlap (${d.toFixed(3)})`);
    }
  }
});

test('a lone post stands exactly at its date on its own ring', () => {
  const [p] = placeTowers([{ id: 1, platform: 'x', postedAt: '2026-09-16T00:00:00Z', score: 5 }] as any[], from, span, 5);
  assert.equal(p.radius, 3.05);
});
