(() => {
  'use strict';
  if (location.hostname !== 'arizonarp.logsparser.info') return;

  const RELEASE_SEEN_KEY = 'kalusSeenRelease';
  const UPDATE_DISMISSED_KEY = 'kalusDismissedUpdate';
  const DOWNLOAD_ORIGIN = 'https://kalus-price-hub.imvana122008.chatgpt.site';

  const make = (tag, className, value) => {
    const element = document.createElement(tag);
    element.className = className;
    if (value) element.textContent = value;
    return element;
  };

  async function showReleaseNotice(message) {
    if (message?.status !== 200 || !/^\d+\.\d+\.\d+$/.test(message.installedVersion) ||
        !/^\d+\.\d+\.\d+$/.test(message.latestVersion) ||
        !Array.isArray(message.release?.changes) || !document.body ||
        document.querySelector('#kalus-release-notice')) return;

    const newer = message.latestVersion !== message.installedVersion;
    const seen = await chrome.storage.local.get([RELEASE_SEEN_KEY, UPDATE_DISMISSED_KEY]).catch(() => ({}));
    if (newer ? seen[UPDATE_DISMISSED_KEY] === message.latestVersion
      : seen[RELEASE_SEEN_KEY] === message.installedVersion) return;

    const root = make('aside', 'kalus-release-notice');
    root.id = 'kalus-release-notice';
    root.role = 'status';
    root.ariaLive = 'polite';
    const header = make('div', 'kalus-release-head');
    const icon = make('img', 'kalus-release-mark');
    icon.src = chrome.runtime.getURL('icon128.png');
    icon.alt = '';
    header.appendChild(icon);
    header.appendChild(make('strong', '', newer ? 'Доступно обновление' : 'Расширение обновлено'));
    header.appendChild(make('span', 'kalus-release-version', `v${message.latestVersion}`));
    root.appendChild(header);
    root.appendChild(make('p', 'kalus-release-title', String(message.release.title || 'Что изменилось').slice(0, 100)));
    const list = make('ul', 'kalus-release-list');
    for (const change of message.release.changes.slice(0, 4)) {
      if (typeof change === 'string' && change.trim()) list.appendChild(make('li', '', change.slice(0, 180)));
    }
    root.appendChild(list);
    const actions = make('div', 'kalus-release-actions');
    if (newer) {
      const download = make('a', 'kalus-release-download', 'Скачать обновление');
      download.href = `${DOWNLOAD_ORIGIN}/downloads/Kalus_Chandler_Extension_${message.latestVersion}.zip`;
      download.target = '_blank';
      download.rel = 'noopener noreferrer';
      actions.appendChild(download);
    }
    const dismiss = make('button', 'kalus-release-dismiss', newer ? 'Позже' : 'Понятно');
    dismiss.type = 'button';
    dismiss.addEventListener('click', () => {
      const key = newer ? UPDATE_DISMISSED_KEY : RELEASE_SEEN_KEY;
      chrome.storage.local.set({ [key]: message.latestVersion }).catch(() => {});
      root.remove();
    });
    actions.appendChild(dismiss);
    root.appendChild(actions);
    document.body.appendChild(root);
  }

  try {
    chrome.runtime.sendMessage({ type: 'getReleaseInfo' }, response => {
      if (!chrome.runtime.lastError) void showReleaseNotice(response);
    });
  } catch (_) { /* The tab can close while the extension checks the release. */ }
})();
