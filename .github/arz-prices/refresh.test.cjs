'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWikiApiPrice, selectForRefresh } = require('./refresh.cjs');

test('reads Chandler prices and the all-server median from Wiki API', () => {
  assert.deepEqual(parseWikiApiPrice({
    itemId: 1766, name: 'Ящик Marvel', unknown: false,
    servers: [
      { server: 1, status: 'ok', sell: { avg: 100 }, buy: { avg: 30 } },
      { server: 4, status: 'ok', sell: { avg: 159025 }, buy: { avg: 67843 } },
      { server: 9, status: 'ok', sell: { avg: 200 }, buy: { avg: 40 } },
      { server: 10, status: 'no_data', sell: { avg: 0 } },
    ]
  }, 1766, 123456), {
    itemId: 1766, itemName: 'Ящик Marvel', medianSale: 200,
    sellPrice: 159025, buyPrice: 67843, serverCount: 3, at: 123456
  });
});

test('rejects a response for a different ID and does not invent a price for an unknown item', () => {
  assert.equal(parseWikiApiPrice({ itemId: 2, servers: [] }, 1), null);
  assert.equal(parseWikiApiPrice({ itemId: 1, unknown: true, servers: [] }, 1), null);
});

test('prioritizes watched items then scans every catalog ID across consecutive rounds', () => {
  const catalog = Array.from({ length: 9 }, (_, n) => ({ id: n + 1, name: `Item ${n + 1}` }));
  const watched = [{ itemId: 9, itemName: 'Seen in logs' }];
  const first = selectForRefresh(catalog, watched, 0, 4);
  const second = selectForRefresh(catalog, watched, first.nextCursor, 4);
  const third = selectForRefresh(catalog, watched, second.nextCursor, 4);
  assert.equal(first.items[0].id, 9);
  assert.deepEqual(new Set([...first.items, ...second.items, ...third.items].map(x => x.id)), new Set([1,2,3,4,5,6,7,8,9]));
  assert.ok(first.items.length <= 4 && second.items.length <= 4 && third.items.length <= 4);
});
