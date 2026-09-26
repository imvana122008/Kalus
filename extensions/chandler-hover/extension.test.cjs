const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const content = fs.readFileSync('content.js', 'utf8');
const background = fs.readFileSync('background.js', 'utf8');
const access = () => fs.readFileSync('site-access.js', 'utf8');

test('bundled market archive contains dated Chandler and VC prices for a known ID', () => {
  const market = JSON.parse(fs.readFileSync('market-seed.json', 'utf8'));
  assert.ok(Object.keys(market.items).length > 3000);
  assert.equal(market.items['1766'].name, 'Ящик Marvel');
  assert.equal(market.items['1766'].sell.price, 139512);
  assert.equal(market.items['1766'].sell.date, '2026-09-22');
  assert.ok(market.items['1766'].vcSell.price > 0);
});

test('loads only on LogsParser and asks for Wiki access', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://arizonarp.logsparser.info/*']);
  assert.deepEqual(manifest.host_permissions, ['https://wiki.arz-mcr.ru/*', 'https://api.exchange.coinbase.com/*', 'https://api.coingecko.com/*', 'https://raw.githubusercontent.com/*']);
  assert.deepEqual(manifest.permissions, ['storage', 'alarms']);
  assert.ok(fs.existsSync(manifest.icons['128']));
});

test('schedules a market check every 30 minutes even without hovering', async () => {
  let onAlarm, onStartup, alarmConfig;
  const saved = { checkedAt: Date.now() - 31 * 60 * 1000, items: { '1766': { name: 'Ящик Marvel' } },
    etags: { 'ArzMarketV3/items.json': 'v1', ...Object.fromEntries(
      ['buy_chandler', 'sell_chandler', 'buy_vc', 'sell_vc'].map(n => [`avg_price/info_users_${n}.json`, 'v1'])) } };
  const writes = [];
  const chrome = { runtime: { id: 'extension-id', onMessage: { addListener() {} },
    onStartup: { addListener: fn => { onStartup = fn; } }, onInstalled: { addListener() {} } },
    alarms: { create: (name, config) => { alarmConfig = { name, ...config }; },
      onAlarm: { addListener: fn => { onAlarm = fn; } } },
    storage: { local: { get: async () => ({ kalusMarketArchiveV1: saved }),
      set: async value => { writes.push(value.kalusMarketArchiveV1); } } } };
  const fetch = async (url, options) => {
    assert.equal(options.method, 'HEAD');
    return { ok: true, headers: { get: key => key === 'etag' ? 'v1' : null } };
  };
  const context = { chrome, fetch, AbortSignal, TextDecoder, setTimeout, clearTimeout, Date };
  vm.runInNewContext(`${background}\nthis.marketTest = { refreshMarketSnapshot };`, context);
  onStartup();
  assert.equal(alarmConfig.periodInMinutes, 30);
  await onAlarm({ name: alarmConfig.name });
  assert.equal(writes.length, 1);
  assert.ok(writes[0].checkedAt > saved.checkedAt);
  assert.equal(writes[0].items['1766'].name, 'Ящик Marvel');
});

function loadContent(onMessage = () => {}) {
  const requests = [];
  const pending = new Map();
  const tip = { innerHTML: '', style: {}, classList: {
    add: name => pending.set(name, true),
    contains: name => pending.has(name)
  }, setAttribute() {}, getBoundingClientRect: () => ({ width: 340, height: 170 }) };
  const document = { querySelector: () => tip };
  const window = { innerWidth: 1200, innerHeight: 800 };
  const chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: { lastError: null, sendMessage: (message, callback) => {
      requests.push(message);
      onMessage(message, callback);
    } }
  };
  const hook = 'window.__hoverTest = { parseHoverTrade, pointerOnItemName, loadHoverPrice, parseHoverBtc: typeof parseHoverBtc === "function" ? parseHoverBtc : undefined, pointerOnBtcAmount: typeof pointerOnBtcAmount === "function" ? pointerOnBtcAmount : undefined, loadHoverBtc: typeof loadHoverBtc === "function" ? loadHoverBtc : undefined, candidateUnderPointer };';
  const instrumented = content.replace(
    "  if (location.hostname !== 'arizonarp.logsparser.info') return;",
    `  ${hook}\n  if (location.hostname !== 'arizonarp.logsparser.info') return;`
  );
  class Element {}
  vm.runInNewContext(instrumented, { window, document, chrome, NodeFilter: { SHOW_TEXT: 4 }, Element,
    location: { hostname: 'wiki.arz-mcr.ru' }, requestAnimationFrame: fn => fn(),
    setTimeout, clearTimeout, URL, Map, Set, Intl, Date, Number, Math, String });
  return { requests, tip, document, actions: window.__hoverTest, Element };
}

test('loads Chandler sale and buy only after hovering the item name', async () => {
  const { requests, tip, actions } = loadContent((message, callback) => {
    callback({ status: 200, data: { itemId: message.itemId, name: 'Супер мото-ящик', servers: [
      { server: 4, status: 'ok', sell: { avg: 100000 }, buy: { avg: 65000 } },
      { server: 5, status: 'ok', sell: { avg: 200000 }, buy: { avg: 70000 } }
    ] } });
  });
  assert.equal(requests.length, 0);
  const item = actions.parseHoverTrade('Игрок Ivan_Kalus получил в инвентарь Супер мото-ящик [id: 1769]');
  assert.equal(item.item, 'Супер мото-ящик');
  await actions.loadHoverPrice({ host: {}, item }, 100, 100);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].itemId, 1769);
  assert.match(tip.innerHTML, /100[\s\u00a0]000/);
  assert.match(tip.innerHTML, /65[\s\u00a0]000/);
  assert.match(tip.innerHTML, /Последняя проверка Wiki:/);
});

test('Wiki fetch runs in the service worker and rejects invalid IDs', async () => {
  let handler, requested;
  const chrome = { runtime: { id: 'extension-id', onMessage: {
    addListener: fn => { handler = fn; }
  } } };
  vm.runInNewContext(background, { chrome, fetch: async url => {
    requested = url;
    return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ itemId: 1769 }) };
  }, AbortController, setTimeout, clearTimeout });
  const sender = { id: 'extension-id', url: 'https://arizonarp.logsparser.info/logs' };
  const result = await new Promise(resolve => {
    assert.equal(handler({ type: 'getItemPrice', itemId: 1769 }, sender, resolve), true);
  });
  assert.equal(requested, 'https://wiki.arz-mcr.ru/api/items/prices?id=1769');
  assert.equal(result.data.itemId, 1769);
  let bad;
  handler({ type: 'getItemPrice', itemId: '1769' }, sender, value => { bad = value; });
  assert.equal(bad.status, 400);
});

test('background returns a dated bundled market record by item ID', async () => {
  let handler;
  const snapshot = { checkedAt: Date.now(), items: { '1766': { name: 'Ящик Marvel', sell: { date: '2026-09-22', price: 139512, count: 10360 } } } };
  const chrome = { runtime: { id: 'extension-id', getURL: path => `chrome-extension://extension-id/${path}`,
    onMessage: { addListener: fn => { handler = fn; } } },
  storage: { local: { get: async () => ({}), set: async () => {} } } };
  vm.runInNewContext(background, { chrome, fetch: async url => ({ ok: true, json: async () => snapshot }),
    AbortController, setTimeout, clearTimeout, Date, URL });
  const sender = { id: 'extension-id', url: 'https://arizonarp.logsparser.info/logs' };
  const result = await new Promise(resolve => assert.equal(handler({ type: 'getMarketPrice', itemId: 1766 }, sender, resolve), true));
  assert.equal(result.entry.sell.price, 139512);
  assert.equal(result.entry.sell.date, '2026-09-22');
  assert.equal(result.checkedAt, snapshot.checkedAt);
});

test('market archive refresh maps names back to IDs and caches a successful update', async () => {
  let handler, writes = 0, remoteCalls = 0;
  const initial = { items: {} };
  const stored = {};
  const catalog = { 1766: 'Test item', ...Object.fromEntries(Array.from({ length: 105 }, (_, i) => [String(i + 1), 'Test item'])) };
  const record = { 'Test item': { list: [['2026-09-24', 3, 600, 3, 200, 200]] } };
  const chrome = { runtime: { id: 'extension-id', getURL: path => `chrome-extension://extension-id/${path}`,
    onMessage: { addListener: fn => { handler = fn; } } },
    storage: { local: { get: async key => ({ [key]: stored[key] }), set: async value => { Object.assign(stored, value); writes++; } } } };
  const fetch = async url => {
    if (url.startsWith('chrome-extension:')) return { ok: true, json: async () => initial };
    remoteCalls++;
    const payload = url.endsWith('/items.json') ? catalog : record;
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(payload)).buffer };
  };
  const context = { chrome, fetch, AbortController, AbortSignal, TextDecoder, setTimeout, clearTimeout, Date, URL };
  vm.runInNewContext(`${background}\nthis.marketTest = { refreshMarketSnapshot };`, context);
  const sender = { id: 'extension-id', url: 'https://arizonarp.logsparser.info/logs' };
  const first = await new Promise(resolve => handler({ type: 'getMarketPrice', itemId: 1766 }, sender, resolve));
  assert.equal(first.status, 404);
  await context.marketTest.refreshMarketSnapshot();
  const second = await new Promise(resolve => handler({ type: 'getMarketPrice', itemId: 1766 }, sender, resolve));
  assert.equal(second.entry.sell.price, 200);
  assert.equal(writes, 1);
  assert.equal(remoteCalls, 5);
});

test('changed source ETag rebuilds prices with the actual new date', async () => {
  const files = ['ArzMarketV3/items.json', ...['buy_chandler', 'sell_chandler', 'buy_vc', 'sell_vc'].map(n => `avg_price/info_users_${n}.json`)];
  const previous = { checkedAt: Date.now() - 3600000, items: { '1766': { name: 'Ящик Marvel', sell: { price: 100, date: '2026-09-23' } } },
    etags: Object.fromEntries(files.map(name => [name, 'old'])) };
  const data = { 'Test item': { list: [['2026-09-26', 2, 0, 2, 1234]] } };
  const catalog = { 1766: 'Test item', ...Object.fromEntries(Array.from({ length: 105 }, (_, i) => [i + 1, 'Test item'])) };
  let gets = 0;
  let stored;
  const chrome = { runtime: { onMessage: { addListener() {} } },
    storage: { local: { get: async () => ({ kalusMarketArchiveV1: previous }),
      set: async value => { stored = value.kalusMarketArchiveV1; } } } };
  const fetch = async (url, options) => {
    if (options.method === 'HEAD') return { ok: true, headers: { get: () => 'new' } };
    gets++;
    return { ok: true, headers: { get: () => 'new' }, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(url.endsWith('/items.json') ? catalog : data)).buffer };
  };
  const context = { chrome, fetch, AbortSignal, TextDecoder, Date };
  vm.runInNewContext(`${background}\nthis.marketTest = { refreshMarketSnapshot };`, context);
  await context.marketTest.refreshMarketSnapshot();
  assert.equal(gets, 5);
  assert.equal(stored.items['1766'].sell.date, '2026-09-26');
  assert.equal(stored.items['1766'].sell.price, 1234);
});

test('a rate limit shows a retry message instead of endless loading', async () => {
  const { requests, tip, actions } = loadContent((message, callback) => {
    callback({ status: 429, retryAfter: '120' });
  });
  const item = { itemId: 1769, item: 'Супер мото-ящик', qty: 1 };
  await actions.loadHoverPrice({ host: {}, item }, 100, 100);
  assert.deepEqual(requests.map(r => r.type), ['getItemPrice', 'getMarketPrice']);
  assert.match(tip.innerHTML, /повторю автоматически/);
  assert.doesNotMatch(tip.innerHTML, /Загружаю цены/);
});

test('archived Chandler averages appear with dates and separate VC when Wiki is unavailable', async () => {
  const { requests, tip, actions } = loadContent((message, callback) => {
    if (message.type === 'getItemPrice') callback({ status: 404 });
    if (message.type === 'getMarketPrice') callback({ status: 200, itemId: 1766, checkedAt: Date.UTC(2026, 8, 26, 9), entry: {
      name: 'Ящик Marvel',
      sell: { date: '2026-09-22', price: 139512, count: 10360 },
      buy: { date: '2026-09-22', price: 83929, count: 118 },
      vcSell: { date: '2026-09-23', price: 500, count: 120 },
      vcBuy: { date: '2026-09-23', price: 436, count: 1022 }
    } });
  });
  await actions.loadHoverPrice({ host: {}, item: { itemId: 1766, item: 'Ящик Marvel', qty: 1 } }, 100, 100);
  assert.deepEqual(requests.map(r => r.type), ['getItemPrice', 'getMarketPrice']);
  assert.match(tip.innerHTML, /139[\s\u00a0]512 \$/);
  assert.match(tip.innerHTML, /83[\s\u00a0]929 \$/);
  assert.match(tip.innerHTML, /2026-09-22/);
  assert.match(tip.innerHTML, /Дата цены:/);
  assert.match(tip.innerHTML, /Последняя проверка источника:/);
  assert.match(tip.innerHTML, /26\.09\.2026/);
  assert.match(tip.innerHTML, /500 VC/);
  assert.match(tip.innerHTML, /архив/i);
  assert.doesNotMatch(tip.innerHTML, /wiki\.arz-mcr\.ru\/items\/1766.*live/);
});

test('BTC log parser treats comma as thousands in the log and uses its historical time', () => {
  const { actions } = loadContent();
  const btc = actions.parseHoverBtc('2026-08-29 13:38:29 Игрок Takeru_Rize получил от игрока [31]Chaice_Root 694,409 BTC, причина: передача BTC (инвентарь)');
  assert.equal(btc.label, '694,409 BTC');
  assert.equal(btc.amount, 694409);
  assert.equal(actions.parseHoverBtc('2026-08-29 13:38:29 Игрок получил 1,000,000 BTC').amount, 1000000);
  assert.equal(actions.parseHoverBtc('2026-08-29 13:38:29 Игрок получил 0,5 BTC').amount, 0.5);
  assert.equal(btc.candleTime, Date.UTC(2026, 7, 29, 10));
  assert.equal(actions.parseHoverBtc('Игрок Takeru_Rize получил 694,409 BTC'), null);
  assert.equal(actions.parseHoverBtc('2026-02-30 13:38:29 Игрок получил 1 BTC'), null);
});

test('BTC hover is limited to the amount and ticker, not the whole row', () => {
  const { actions, document } = loadContent();
  const text = '2026-08-29 13:38:29 Игрок получил 694,409 BTC, причина: передача BTC';
  const row = { innerText: text };
  const node = { textContent: text };
  document.createTreeWalker = () => ({ nextNode: (() => { let used = false; return () => used ? null : (used = true, node); })() });
  let selected;
  document.createRange = () => ({ setStart(_, index) { selected = [index]; },
    setEnd(_, index) { selected.push(index); },
    getClientRects() { return [{ left: 50, right: 150, top: 50, bottom: 70, width: 100, height: 20 }]; } });
  const btc = actions.parseHoverBtc(text);
  assert.equal(actions.pointerOnBtcAmount(row, btc, 100, 60), true);
  assert.equal(text.slice(...selected), '694,409 BTC');
  assert.equal(actions.pointerOnBtcAmount(row, btc, 100, 10), false);
});

test('BTC tooltip works in a non-table row when rendered amount and ticker span lines', () => {
  const { actions, document, Element } = loadContent();
  const row = Object.assign(new Element(), { innerText: '2026-08-29 13:38:29 Игрок получил 694,409 BTC, причина: передача BTC', parentElement: null,
    closest: () => null, textContent: '2026-08-29 13:38:29 Игрок получил 694,409\nBTC, причина: передача BTC' });
  const text = '694,409 BTC';
  const leaf = Object.assign(new Element(), { innerText: text, textContent: text, parentElement: row, closest: () => null });
  document.body = {};
  document.elementsFromPoint = () => [leaf];
  document.createTreeWalker = () => ({ nextNode: (() => { let used = false; return () => used ? null : (used = true, { textContent: row.textContent }); })() });
  document.createRange = () => ({ setStart() {}, setEnd() {}, getClientRects() { return [{ left: 50, right: 150, top: 50, bottom: 70, width: 100, height: 20 }]; } });
  assert.equal(actions.candidateUnderPointer(100, 60).btc.amount, 694409);
});

test('only the site origin gets an extension presence response', () => {
  assert.deepEqual(manifest.content_scripts[1].matches, ['https://kalus-price-hub.imvana122008.chatgpt.site/*']);
  let onMessage;
  const posted = [];
  const window = { location: { origin: 'https://kalus-price-hub.imvana122008.chatgpt.site' },
    addEventListener: (_, listener) => { onMessage = listener; },
    postMessage: (...values) => posted.push(values) };
  vm.runInNewContext(access(), { window, chrome: { runtime: { id: 'installed-extension' } } });
  onMessage({ source: window, origin: window.location.origin, data: { type: 'kalus:site:check', nonce: 'random-challenge' } });
  assert.equal(posted[0][0].type, 'kalus:site:ready');
  assert.equal(posted[0][0].nonce, 'random-challenge');
  onMessage({ source: window, origin: 'https://other.example', data: { type: 'kalus:site:check', nonce: 'wrong-origin' } });
  assert.equal(posted.length, 1);
});

test('BTC tooltip calculates approximate game dollars and displays the price timestamp', async () => {
  const { actions, requests, tip } = loadContent((message, callback) => {
    if (message.type === 'getBtcRate') callback({ status: 200, price: 60000, candleTime: message.candleTime });
  });
  const btc = actions.parseHoverBtc('2026-08-29 13:38:29 Игрок получил 694,409 BTC, причина: передача BTC');
  await actions.loadHoverBtc({ host: {}, btc }, 100, 100);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].type, 'getBtcRate');
  assert.equal(requests[0].candleTime, Date.UTC(2026, 7, 29, 10));
  assert.match(tip.innerHTML, /41\.664\.540\.000/);
  assert.match(tip.innerHTML, /694,409 BTC/);
  assert.match(tip.innerHTML, /694\.409 BTC/);
  assert.match(tip.innerHTML, /29\.08\.2026/);
  assert.match(tip.innerHTML, /Обновлено/);
});

test('BTC unavailable historical rate shows a clear message and no made-up dollars', async () => {
  const { actions, tip } = loadContent((message, callback) => callback({ status: 404 }));
  const btc = actions.parseHoverBtc('2026-08-29 13:38:29 Игрок получил 694,409 BTC');
  await actions.loadHoverBtc({ host: {}, btc }, 100, 100);
  assert.match(tip.innerHTML, /Курс за этот час не найден/);
  assert.doesNotMatch(tip.innerHTML, /41\.664\.540\.000/);
});

test('background selects exact historical hourly close and rejects invalid or absent candles', async () => {
  let handler, requested;
  let candles;
  const chrome = { runtime: { id: 'extension-id', onMessage: { addListener: fn => { handler = fn; } } } };
  vm.runInNewContext(background, { chrome, fetch: async url => {
    requested = url;
    return { status: 200, ok: true, headers: { get: () => null }, json: async () => candles };
  }, AbortController, setTimeout, clearTimeout, Date, URL });
  const sender = { id: 'extension-id', url: 'https://arizonarp.logsparser.info/logs' };
  const candleTime = Date.UTC(2026, 7, 29, 10);
  candles = [[candleTime / 1000 + 3600, 1, 1, 1, 1, 3], [candleTime / 1000, 50000, 65000, 55000, 60000, 3]];
  const result = await new Promise((resolve, reject) => {
    try { assert.equal(handler({ type: 'getBtcRate', candleTime }, sender, resolve), true); }
    catch (error) { reject(error); }
  });
  assert.match(requested, /^https:\/\/api\.exchange\.coinbase\.com\/products\/BTC-USD\/candles\?/);
  assert.match(requested, /granularity=3600/);
  assert.equal(result.price, 60000);
  candles = [[candleTime / 1000 + 3600, 1, 1, 1, 1, 3]];
  const absent = await new Promise(resolve => handler({ type: 'getBtcRate', candleTime }, sender, resolve));
  assert.equal(absent.status, 404);
  let invalid;
  handler({ type: 'getBtcRate', candleTime: Date.now() + 86400000 }, sender, result => { invalid = result; });
  assert.equal(invalid.status, 400);
});

test('BTC rate falls back to CoinGecko when Coinbase is unavailable', async () => {
  let handler;
  const hour = Date.UTC(2026, 7, 29, 10);
  const chrome = { runtime: { id: 'extension-id', onMessage: { addListener: fn => { handler = fn; } } } };
  vm.runInNewContext(background, { chrome, fetch: async url => {
    if (url.includes('coinbase.com')) throw Error('network blocked');
    return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ prices: [[hour, 77649.82]] }) };
  }, AbortController, setTimeout, clearTimeout, Date, URL });
  const sender = { id: 'extension-id', url: 'https://arizonarp.logsparser.info/logs' };
  const response = await new Promise(resolve => handler({ type: 'getBtcRate', candleTime: hour }, sender, resolve));
  assert.equal(response.price, 77649.82);
  assert.equal(response.source, 'CoinGecko');
});
