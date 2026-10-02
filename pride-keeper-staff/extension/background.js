const UPDATE_URL = 'https://raw.githubusercontent.com/imvana122008/Kalus/main/pride-keeper-staff/update.json';
const UPDATE_STATE_KEY = 'prideKeeperUpdater';

function semverParts(v) {
  return String(v || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
}

function isNewer(a, b) {
  const A = semverParts(a);
  const B = semverParts(b);
  for (let i = 0; i < Math.max(A.length, B.length, 3); i++) {
    const x = A[i] || 0;
    const y = B[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function getUpdaterState() {
  const data = await chrome.storage.local.get([UPDATE_STATE_KEY]);
  return data[UPDATE_STATE_KEY] || {
    autoDownload: true,
    lastDownloadedVersion: '',
    latest: null,
    lastCheckAt: 0
  };
}

async function setUpdaterState(state) {
  await chrome.storage.local.set({ [UPDATE_STATE_KEY]: state });
}

async function downloadUpdate(info, state) {
  if (!info?.download_url) return false;
  if (state.lastDownloadedVersion === info.version) return false;

  await chrome.downloads.download({
    url: info.download_url,
    filename: 'PRIDE_KEEPER_Staff_latest.zip',
    conflictAction: 'overwrite',
    saveAs: false
  });

  state.lastDownloadedVersion = info.version;
  await setUpdaterState(state);

  try {
    await chrome.notifications.create(`pride-update-${info.version}`, {
      type: 'basic',
      iconUrl: 'assets/icon.svg',
      title: `PRIDE KEEPER Staff ${info.version}`,
      message: 'Свежий ZIP автоматически скачан. Для распакованного расширения остаётся распаковать архив и нажать Reload в chrome://extensions/.'
    });
  } catch (_) {}

  return true;
}

async function checkUpdate({ forceDownload = false } = {}) {
  const current = chrome.runtime.getManifest().version;
  const state = await getUpdaterState();

  try {
    const res = await fetch(`${UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = await res.json();
    const available = isNewer(info.version, current);

    state.latest = { ...info, available, current_version: current };
    state.lastCheckAt = Date.now();
    await setUpdaterState(state);

    if (available && (forceDownload || state.autoDownload !== false)) {
      await downloadUpdate(info, state);
    }

    return state.latest;
  } catch (error) {
    state.latest = {
      available: false,
      current_version: current,
      error: String(error?.message || error)
    };
    state.lastCheckAt = Date.now();
    await setUpdaterState(state);
    return state.latest;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('pride-update-check', { periodInMinutes: 30 });
  checkUpdate().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('pride-update-check', { periodInMinutes: 30 });
  checkUpdate().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pride-update-check') checkUpdate().catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !tab.url?.startsWith('https://forum.pridekeeper.tech/')) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'PRIDE_TOGGLE_UI' });
  } catch (_) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await chrome.tabs.sendMessage(tab.id, { type: 'PRIDE_TOGGLE_UI' });
    } catch (_) {}
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PRIDE_CHECK_UPDATE') {
    checkUpdate({ forceDownload: !!message.forceDownload }).then(sendResponse);
    return true;
  }

  if (message?.type === 'PRIDE_GET_UPDATE_STATE') {
    getUpdaterState().then(sendResponse);
    return true;
  }

  if (message?.type === 'PRIDE_SET_AUTO_DOWNLOAD') {
    getUpdaterState().then(async state => {
      state.autoDownload = !!message.enabled;
      await setUpdaterState(state);
      sendResponse(state);
    });
    return true;
  }

  if (message?.type === 'PRIDE_OPEN_URL' && message.url) {
    chrome.tabs.create({ url: message.url }).then(() => sendResponse({ ok: true }));
    return true;
  }
});
