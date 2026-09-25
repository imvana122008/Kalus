(() => {
  'use strict';
  const siteOrigin = 'https://kalus-price-hub.imvana122008.chatgpt.site';
  if (window.location.origin !== siteOrigin || !chrome.runtime?.id) return;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== siteOrigin ||
        event.data?.type !== 'kalus:site:check' ||
        typeof event.data.nonce !== 'string' || event.data.nonce.length > 128) return;
    window.postMessage({ type: 'kalus:site:ready', nonce: event.data.nonce }, siteOrigin);
  });
})();
