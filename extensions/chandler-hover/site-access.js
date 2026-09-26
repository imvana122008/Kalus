(() => {
  'use strict';
  const siteOrigin = 'https://kalus-price-hub.imvana122008.chatgpt.site';
  if (window.location.origin !== siteOrigin || !chrome.runtime?.id) return;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== siteOrigin ||
        typeof event.data?.nonce !== 'string' || event.data.nonce.length < 1 ||
        event.data.nonce.length > 128) return;
    if (event.data.type === 'kalus:site:check') {
      window.postMessage({ type: 'kalus:site:ready', nonce: event.data.nonce }, siteOrigin);
      return;
    }
    if (event.data.type !== 'kalus:site:market' ||
        !Number.isSafeInteger(event.data.itemId) || event.data.itemId < 1 ||
        event.data.itemId > 99999) return;
    const { nonce, itemId } = event.data;
    chrome.runtime.sendMessage({ type: 'getMarketPrice', itemId }, response => {
      if (chrome.runtime.lastError) return;
      window.postMessage({ type: 'kalus:site:market:response', nonce, itemId,
        entry: response?.status === 200 && response.itemId === itemId ? response.entry : null,
        checkedAt: response?.checkedAt || null }, siteOrigin);
    });
  });
})();
