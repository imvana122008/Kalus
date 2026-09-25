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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), btc ? 3000 : 2000);
  const url = btc
    ? `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600&start=${encodeURIComponent(new Date(candleTime).toISOString())}&end=${encodeURIComponent(new Date(candleTime + 3600000).toISOString())}`
    : `https://wiki.arz-mcr.ru/api/items/prices?id=${itemId}`;

  fetch(url, {
    signal: controller.signal,
    cache: 'no-store'
  }).then(async response => {
    const result = { status: response.status, retryAfter: response.headers.get('retry-after') };
    if (response.ok) {
      const data = await response.json();
      if (btc) {
        // Coinbase returns [time in seconds, low, high, open, close, volume].
        const candle = Array.isArray(data) && data.find(row =>
          Array.isArray(row) && row[0] === candleTime / 1000);
        const price = candle && Number(candle[4]);
        if (Number.isFinite(price) && price > 0) {
          result.price = price;
          result.candleTime = candleTime;
        } else result.status = 404;
      } else result.data = data;
    }
    sendResponse(result);
  }).catch(() => {
    sendResponse({ status: 0 });
  }).finally(() => clearTimeout(timeout));

  return true;
});
