import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseSheets } = await import('../server/collectors/linkedin-export.ts');
const { readMetrics } = await import('../server/collectors/linkedin-browser.ts');

const url = (id: string) => `https://www.linkedin.com/feed/update/urn:li:activity:${id}`;

test('the content export is read by position, in any language', () => {
  const r = parseSheets([
    { sheet: 'ENTDECKEN', data: [['Gesamtleistung', '1.9.2026 - 30.9.2026'], ['Impressionen', 48210], ['Erreichte Mitglieder', 21877]] },
    { sheet: 'INTERAKTIONEN', data: [['Datum', 'Impressionen', 'Interaktionen'], ['21/09/2026', 9120, 160]] },
    { sheet: 'TOP', data: [[], [], ['URL', 'Datum', 'Int', null, 'URL', 'Datum', 'Imp'], [url('1111111111111111111'), '21/09/2026', 245, null, url('1111111111111111111'), '21/09/2026', 21450]] },
    { sheet: 'FOLLOWER', data: [] },
    { sheet: 'DEMOGRAFIE', data: [] },
  ] as any);
  assert.deepEqual(r.posts, [{ url: url('1111111111111111111'), impressions: 21450, membersReached: null }]);
  assert.deepEqual([...r.days], [['2026-09-21', { impressions: 9120, engagements: 160 }]]);
  assert.deepEqual(r.totals, { impressions: 48210, membersReached: 21877 });
});

test('a single-post export is read by its labels', () => {
  const r = parseSheets([{ sheet: 'POST', data: [['Post URL', url('2222222222222222222')], ['Impressions', 4100], ['Members reached', 2950]] }] as any);
  assert.deepEqual(r.posts, [{ url: url('2222222222222222222'), impressions: 4100, membersReached: 2950 }]);
});

test('analytics page text: numbers above, below or inline with their labels', () => {
  const expect = { impressions: 4213, reached: 2987 };
  assert.deepEqual(readMetrics('Discovery\n4,213\nImpressions\n2,987\nMembers reached'), expect);
  assert.deepEqual(readMetrics('Discovery\nImpressions\n4,213\nMembers reached\n2,987'), expect);
  assert.deepEqual(readMetrics('4,213 impressions\n2,987 members reached'), expect);
  assert.deepEqual(readMetrics('Entdeckung\n4.213\nImpressionen\n2.987\nErreichte Mitglieder'), expect);
  assert.deepEqual(readMetrics('Something went wrong'), { impressions: null, reached: null });
});
