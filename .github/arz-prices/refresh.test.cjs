'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWikiPagePrice, selectForRefresh } = require('./refresh.cjs');

test('reads Chandler and all-server median from rendered public item page', () => {
  assert.deepEqual(parseWikiPagePrice({
    name: 'Ящик Marvel',
    text: 'Медиана продажи 111 134 $ Цены есть на 36',
    row: '4. Chandler продажа 159 025 $ скупка 67 843 $'
  }, 1766, 123456), {
    itemId: 1766, itemName: 'Ящик Marvel', medianSale: 111134,
    sellPrice: 159025, buyPrice: 67843, serverCount: 36, at: 123456
  });
  assert.equal(parseWikiPagePrice({name:'Пустой',text:'Нет цен',row:''}, 10), null);
});

test('prioritizes watched items then scans every catalog ID across consecutive rounds', () => {
  const catalog = Array.from({ length: 9 }, (_, n) => ({ id: n + 1, name: `Item ${n + 1}` }));
  const watched = [{ itemId: 3, itemName: 'Seen in logs' }];
  const first = selectForRefresh(catalog, watched, 0, 3, 1);
  const second = selectForRefresh(catalog, watched, first.nextCursor, 3, 1);
  const third = selectForRefresh(catalog, watched, second.nextCursor, 3, 1);
  assert.equal(first.items[0].id, 3);
  assert.equal(first.nextCursor, 3);
  assert.deepEqual(first.scanItems.map(x=>x.id),[1,2,3]);
  assert.deepEqual(second.scanItems.map(x=>x.id),[4,5,6]);
  assert.deepEqual(new Set([...first.items, ...second.items, ...third.items].map(x => x.id)), new Set([1,2,3,4,5,6,7,8,9]));
  assert.ok(first.items.length <= 4 && second.items.length <= 4 && third.items.length <= 4);
});
