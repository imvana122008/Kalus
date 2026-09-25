const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const content = fs.readFileSync('content.js', 'utf8');
const background = fs.readFileSync('background.js', 'utf8');

test('loads only on LogsParser and asks for Wiki access', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://arizonarp.logsparser.info/*']);
  assert.deepEqual(manifest.host_permissions, ['https://wiki.arz-mcr.ru/*', 'https://api.exchange.coinbase.com/*', 'https://api.coingecko.com/*']);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.ok(fs.existsSync(manifest.icons['128']));
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
  const hook = 'window.__hoverTest = { parseHoverTrade, pointerOnItemName, loadHoverPrice, parseHoverBtc: typeof parseHoverBtc === "function" ? parseHoverBtc : undefined, pointerOnBtcAmount: typeof pointerOnBtcAmount === "function" ? pointerOnBtcAmount : undefined, loadHoverBtc: typeof loadHoverBtc === "function" ? loadHoverBtc : undefined };';
  const instrumented = content.replace(
    "  if (location.hostname !== 'arizonarp.logsparser.info') return;",
    `  ${hook}\n  if (location.hostname !== 'arizonarp.logsparser.info') return;`
  );
  vm.runInNewContext(instrumented, { window, document, chrome, NodeFilter: { SHOW_TEXT: 4 },
    location: { hostname: 'wiki.arz-mcr.ru' }, requestAnimationFrame: fn => fn(),
    setTimeout, clearTimeout, URL, Map, Set, Intl, Date, Number, Math, String });
  return { requests, tip, document, actions: window.__hoverTest };
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

test('a rate limit shows a retry message instead of endless loading', async () => {
  const { requests, tip, actions } = loadContent((message, callback) => {
    callback({ status: 429, retryAfter: '120' });
  });
  const item = { itemId: 1769, item: 'Супер мото-ящик', qty: 1 };
  await actions.loadHoverPrice({ host: {}, item }, 100, 100);
  assert.equal(requests.length, 1);
  assert.match(tip.innerHTML, /повторю автоматически/);
  assert.doesNotMatch(tip.innerHTML, /Загружаю цены/);
});

test('BTC log parser treats comma as decimal and uses the log time, not today', () => {
  const { actions } = loadContent();
  const btc = actions.parseHoverBtc('2026-08-29 13:38:29 Игрок Takeru_Rize получил от игрока [31]Chaice_Root 694,409 BTC, причина: передача BTC (инвентарь)');
  assert.equal(btc.label, '694,409 BTC');
  assert.equal(btc.amount, 694.409);
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

test('BTC tooltip calculates approximate game dollars and displays the price timestamp', async () => {
  const { actions, requests, tip } = loadContent((message, callback) => {
    if (message.type === 'getBtcRate') callback({ status: 200, price: 60000, candleTime: message.candleTime });
  });
  const btc = actions.parseHoverBtc('2026-08-29 13:38:29 Игрок получил 694,409 BTC, причина: передача BTC');
  await actions.loadHoverBtc({ host: {}, btc }, 100, 100);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].type, 'getBtcRate');
  assert.equal(requests[0].candleTime, Date.UTC(2026, 7, 29, 10));
  assert.match(tip.innerHTML, /41\.664\.540/);
  assert.match(tip.innerHTML, /694,409 BTC/);
  assert.match(tip.innerHTML, /29\.08\.2026/);
  assert.match(tip.innerHTML, /Обновлено/);
});

test('BTC unavailable historical rate shows a clear message and no made-up dollars', async () => {
  const { actions, tip } = loadContent((message, callback) => callback({ status: 404 }));
  const btc = actions.parseHoverBtc('2026-08-29 13:38:29 Игрок получил 694,409 BTC');
  await actions.loadHoverBtc({ host: {}, btc }, 100, 100);
  assert.match(tip.innerHTML, /Курс за этот час не найден/);
  assert.doesNotMatch(tip.innerHTML, /41\.664\.540/);
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
