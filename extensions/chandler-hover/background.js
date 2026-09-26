'use strict';

const MARKET_STORAGE_KEY = 'kalusMarketArchiveV1';
const MARKET_ALARM_NAME = 'kalus-market-refresh';
const MARKET_REFRESH_MS = 30 * 60 * 1000;
const MARKET_RAW_BASE = 'https://raw.githubusercontent.com/FREYM1337/forumnick/main/';
const RELEASE_URL = 'https://raw.githubusercontent.com/imvana122008/Kalus/main/extensions/chandler-hover/release-notes.json';
const MARKET_FILES = {
  buy: 'avg_price/info_users_buy_chandler.json',
  sell: 'avg_price/info_users_sell_chandler.json',
  vcBuy: 'avg_price/info_users_buy_vc.json',
  vcSell: 'avg_price/info_users_sell_vc.json'
};
let marketSnapshotPromise;
let marketRefreshPromise;
let marketNextRefreshAt = 0;

function normalizeMarketName(name) {
  return String(name).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function recentMarketAverage(record) {
  const rows = Array.isArray(record?.list) ? record.list : [];
  const valid = rows.filter(row => Array.isArray(row) && /^20\d\d-\d\d-\d\d$/.test(row[0]) &&
    Number.isFinite(Number(row[4])) && Number(row[4]) > 0);
  if (!valid.length) return null;
  const row = valid.reduce((a, b) => a[0] >= b[0] ? a : b);
  return { date: row[0], price: Math.round(Number(row[4])), count: Number(row[1]) || 0 };
}

function buildMarketSnapshot(catalog, archives) {
  const lookup = {};
  for (const [field, records] of Object.entries(archives)) {
    lookup[field] = new Map(Object.entries(records).map(([name, record]) =>
      [normalizeMarketName(name), recentMarketAverage(record)]));
  }
  const items = {};
  for (const [id, name] of Object.entries(catalog)) {
    if (!/^\d+$/.test(id) || typeof name !== 'string' || !name.trim() || name.trim().toUpperCase() === 'DELETED') continue;
    const normalized = normalizeMarketName(name);
    const entry = { name: name.trim() };
    for (const field of Object.keys(MARKET_FILES)) {
      const value = lookup[field].get(normalized);
      if (value) entry[field] = value;
    }
    if (Object.keys(entry).length > 1) items[id] = entry;
  }
  return { checkedAt: Date.now(), items };
}

function loadMarketSnapshot() {
  if (!marketSnapshotPromise) marketSnapshotPromise = (async () => {
    const saved = await chrome.storage.local.get(MARKET_STORAGE_KEY).catch(() => ({}));
    if (saved[MARKET_STORAGE_KEY]?.items) return saved[MARKET_STORAGE_KEY];
    const response = await fetch(chrome.runtime.getURL('market-seed.json'));
    if (!response.ok) throw Error('Market seed unavailable');
    return response.json();
  })().catch(() => ({ items: {} }));
  return marketSnapshotPromise;
}

async function fetchMarketJson(path, encoding) {
  const response = await fetch(MARKET_RAW_BASE + path, {
    cache: 'no-store', signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw Error(`Market archive ${response.status}`);
  const text = new TextDecoder(encoding).decode(await response.arrayBuffer());
  return { data: JSON.parse(text), etag: response.headers?.get('etag') || null };
}

function refreshMarketSnapshot() {
  if (marketRefreshPromise || Date.now() < marketNextRefreshAt) return marketRefreshPromise;
  marketNextRefreshAt = Date.now() + 5 * 60 * 1000;
  marketRefreshPromise = (async () => {
    const previous = await loadMarketSnapshot();
    if (Number.isFinite(previous.checkedAt) && previous.checkedAt > Date.now() - MARKET_REFRESH_MS) {
      marketNextRefreshAt = previous.checkedAt + MARKET_REFRESH_MS;
      return;
    }
    const keys = Object.keys(MARKET_FILES);
    const paths = ['ArzMarketV3/items.json', ...keys.map(field => MARKET_FILES[field])];
    if (paths.every(path => previous.etags?.[path])) {
      const remoteTags = await Promise.all(paths.map(async path => {
        const response = await fetch(MARKET_RAW_BASE + path, {
          method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw Error(`Market archive HEAD ${response.status}`);
        return response.headers.get('etag');
      }));
      if (remoteTags.every((tag, i) => tag && tag === previous.etags[paths[i]])) {
        const next = { ...previous, checkedAt: Date.now() };
        await chrome.storage.local.set({ [MARKET_STORAGE_KEY]: next });
        marketSnapshotPromise = Promise.resolve(next);
        marketNextRefreshAt = next.checkedAt + MARKET_REFRESH_MS;
        return;
      }
    }
    const [catalog, ...data] = await Promise.all([
      fetchMarketJson('ArzMarketV3/items.json', 'utf-8'),
      ...keys.map(field => fetchMarketJson(MARKET_FILES[field], 'windows-1251'))
    ]);
    const next = buildMarketSnapshot(catalog.data, Object.fromEntries(keys.map((field, i) => [field, data[i].data])));
    if (Object.keys(next.items).length < 100) throw Error('Market archive incomplete');
    next.etags = Object.fromEntries([catalog, ...data].map((value, i) => [paths[i], value.etag]));
    await chrome.storage.local.set({ [MARKET_STORAGE_KEY]: next });
    marketSnapshotPromise = Promise.resolve(next);
    marketNextRefreshAt = Date.now() + MARKET_REFRESH_MS;
  })().catch(() => {}).finally(() => { marketRefreshPromise = null; });
  return marketRefreshPromise;
}

if (chrome.alarms) {
  const installMarketAlarm = () => {
    chrome.alarms.create(MARKET_ALARM_NAME, { periodInMinutes: 30 });
    return refreshMarketSnapshot();
  };
  chrome.runtime.onInstalled?.addListener(installMarketAlarm);
  chrome.runtime.onStartup?.addListener(installMarketAlarm);
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === MARKET_ALARM_NAME) return refreshMarketSnapshot();
  });
}

function compareReleaseVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

async function readReleaseInfo() {
  const installedVersion = chrome.runtime.getManifest().version;
  const local = await fetch(chrome.runtime.getURL('release-notes.json')).then(response => response.json());
  const valid = note => note && /^\d+\.\d+\.\d+$/.test(note.latestVersion) &&
    typeof note.title === 'string' && Array.isArray(note.changes) &&
    note.changes.every(change => typeof change === 'string');
  if (!valid(local)) throw Error('Invalid bundled release notes');
  let latest = local;
  try {
    const response = await fetch(RELEASE_URL, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const remote = await response.json();
      if (valid(remote) && compareReleaseVersions(remote.latestVersion, latest.latestVersion) >= 0)
        latest = remote;
    }
  } catch (_) { /* Bundled notes are available offline. */ }
  return { status: 200, installedVersion, latestVersion: latest.latestVersion,
    release: { title: latest.title, changes: latest.changes.slice(0, 4) } };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'getItemPrice' && message?.type !== 'getBtcRate' &&
      message?.type !== 'getMarketPrice' && message?.type !== 'getReleaseInfo') return;

  const fromLogs = sender.url?.startsWith('https://arizonarp.logsparser.info/');
  const fromSite = sender.url?.startsWith('https://kalus-price-hub.imvana122008.chatgpt.site/');
  if (sender.id !== chrome.runtime.id || !(fromLogs || (fromSite && message.type === 'getMarketPrice'))) {
    sendResponse({ status: 400 });
    return;
  }

  if (message.type === 'getReleaseInfo') {
    readReleaseInfo().then(sendResponse).catch(() => sendResponse({ status: 0 }));
    return true;
  }

  const btc = message.type === 'getBtcRate';
  const itemId = message.itemId;
  const candleTime = message.candleTime;
  if (btc
    ? (!Number.isSafeInteger(candleTime) || candleTime % 3600000 !== 0 ||
       candleTime < Date.UTC(2015, 0, 1) || candleTime > Date.now())
    : (!Number.isSafeInteger(itemId) || itemId < 1 || itemId > 99999)) {
    sendResponse({ status: 400 });
    return;
  }

  if (message.type === 'getMarketPrice') {
    loadMarketSnapshot().then(snapshot => {
      const entry = snapshot.items[String(itemId)];
      sendResponse(entry ? { status: 200, itemId, entry, checkedAt: snapshot.checkedAt || null } : { status: 404, itemId });
      if (Number.isFinite(snapshot.checkedAt) && snapshot.checkedAt > Date.now() - MARKET_REFRESH_MS)
        marketNextRefreshAt = Math.max(marketNextRefreshAt, snapshot.checkedAt + MARKET_REFRESH_MS);
      void refreshMarketSnapshot();
    }).catch(() => sendResponse({ status: 0 }));
    return true;
  }

  if (btc) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3200);
    const coinbaseUrl = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600&start=${encodeURIComponent(new Date(candleTime).toISOString())}&end=${encodeURIComponent(new Date(candleTime + 3600000).toISOString())}`;
    const coingeckoUrl = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=${candleTime / 1000 - 3600}&to=${candleTime / 1000 + 3600}`;
    async function readRate(url, source) {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw { status: response.status };
      const data = await response.json();
      const candle = source === 'Coinbase'
        ? Array.isArray(data) && data.find(row => Array.isArray(row) && row[0] === candleTime / 1000)
        : Array.isArray(data?.prices) && data.prices.find(row => Array.isArray(row) && row[0] === candleTime);
      const price = candle && Number(candle[source === 'Coinbase' ? 4 : 1]);
      if (!Number.isFinite(price) || price <= 0) throw { status: 404 };
      return { status: 200, price, candleTime, source };
    }
    Promise.any([readRate(coingeckoUrl, 'CoinGecko'), readRate(coinbaseUrl, 'Coinbase')])
      .then(sendResponse)
      .catch(error => {
        const statuses = error.errors?.map(value => value?.status) || [];
        sendResponse({ status: statuses.every(value => value === 404) ? 404 : statuses.includes(429) ? 429 : 0 });
      }).finally(() => { clearTimeout(timeout); controller.abort(); });
    return true;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  const url = `https://wiki.arz-mcr.ru/api/items/prices?id=${itemId}`;

  fetch(url, {
    signal: controller.signal,
    cache: 'no-store'
  }).then(async response => {
    const result = { status: response.status, retryAfter: response.headers.get('retry-after') };
    if (response.ok) {
      const data = await response.json();
      result.data = data;
    }
    sendResponse(result);
  }).catch(() => {
    sendResponse({ status: 0 });
  }).finally(() => clearTimeout(timeout));

  return true;
});
