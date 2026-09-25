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
  assert.deepEqual(manifest.host_permissions, ['https://wiki.arz-mcr.ru/*']);
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
  const hook = 'window.__hoverTest = { parseHoverTrade, pointerOnItemName, loadHoverPrice };';
  const instrumented = content.replace(
    "  if (location.hostname !== 'arizonarp.logsparser.info') return;",
    `  ${hook}\n  if (location.hostname !== 'arizonarp.logsparser.info') return;`
  );
  vm.runInNewContext(instrumented, { window, document, chrome,
    location: { hostname: 'wiki.arz-mcr.ru' }, requestAnimationFrame: fn => fn(),
    setTimeout, clearTimeout, URL, Map, Set, Intl, Date, Number, Math, String });
  return { requests, tip, actions: window.__hoverTest };
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
