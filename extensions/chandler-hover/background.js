'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'getItemPrice' && message?.type !== 'getBtcRate') return;

  if (sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith('https://arizonarp.logsparser.info/')) {
    sendResponse({ status: 400 });
    return;
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
