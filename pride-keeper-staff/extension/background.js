chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !/^https:\/\/forum\.pridekeeper\.tech\//i.test(tab.url || '')) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: 'PKFA_TOGGLE' }); } catch (_) {}
});
