(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.staffGate = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';
  const OPEN_EVENT = 'PKFA_OPEN_STAFF';
  function shouldRunStaff(pathname = '', hash = '') {
    const staffThread = /\/threads\/(?:[^/?#]+\.)?1623(?:\/|$)/i.test(pathname);
    const markedPublish = /\/posts\/\d+\/edit\/?$/i.test(pathname) && hash === '#pkfa-staff-publish';
    return staffThread || markedPublish;
  }
  function shouldShowLegacyLauncher(hasUnifiedShell = false) {
    return !hasUnifiedShell;
  }
  function appendLegacyLauncher(container, launcher, hasUnifiedShell = false) {
    if (!container?.appendChild || !launcher || !shouldShowLegacyLauncher(hasUnifiedShell)) return false;
    container.appendChild(launcher);
    return true;
  }
  function canPublish(context = {}) {
    if (String(context.threadId || '') !== '1623') return false;
    const firstPostId = String(context.postIds?.[0] || '');
    if (!firstPostId) return false;
    return (context.actions || []).some((item) => item.type === 'edit'
      && String(item.postId || '') === firstPostId
      && new RegExp(`/posts/${firstPostId}/edit(?:$|[/?#])`, 'i').test(item.href || ''));
  }
  return { OPEN_EVENT, shouldRunStaff, shouldShowLegacyLauncher, appendLegacyLauncher, canPublish };
});
