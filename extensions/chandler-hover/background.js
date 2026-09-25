'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'getItemPrice') return;

  const itemId = message.itemId;
  if (sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith('https://arizonarp.logsparser.info/') ||
      !Number.isSafeInteger(itemId) || itemId < 1 || itemId > 99999) {
    sendResponse({ status: 400 });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  fetch(`https://wiki.arz-mcr.ru/api/items/prices?id=${itemId}`, {
    signal: controller.signal,
    cache: 'no-store'
  }).then(async response => {
    const result = { status: response.status, retryAfter: response.headers.get('retry-after') };
    if (response.ok) result.data = await response.json();
    sendResponse(result);
  }).catch(() => {
    sendResponse({ status: 0 });
  }).finally(() => clearTimeout(timeout));

  return true;
});
