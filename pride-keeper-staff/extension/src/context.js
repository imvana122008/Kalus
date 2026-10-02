(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.context = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const OWNED_SELECTOR = '#pkfa-app-root, #pkfa-inline-root, #pkfa-inline-toolbar, [data-pkfa-owned="true"]';

  function parseThreadId(pathname = '') {
    return String(pathname).match(/\/threads\/(?:[^/?#]+\.)?(\d+)(?:\/|$)/i)?.[1] || '';
  }

  function parsePostId(value = '') {
    return String(value).match(/(?:\/posts\/|post[-_])(?:[^/?#]+\.)?(\d+)/i)?.[1] || '';
  }

  function isComplaintSnapshot(snapshot = {}) {
    const category = String(snapshot.categoryText || '').toLowerCase();
    return !!snapshot.hasComplaintStatus || /жалоб|appeal|report/.test(category);
  }

  function classify({ pathname = '', complaint = false } = {}) {
    const threadId = parseThreadId(pathname);
    if (threadId === '1623') return 'staff';
    if (threadId && complaint) return 'complaint';
    if (threadId) return 'thread';
    if (/\/posts\/\d+\/edit/i.test(pathname)) return 'post-edit';
    return 'other';
  }

  function filterActions(actions = [], threadId = '') {
    return actions.filter((action) => !action.threadId || String(action.threadId) === String(threadId));
  }

  function normalizeText(value = '') {
    return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isOwnedNode(node) {
    if (!node || node.nodeType !== 1) return false;
    return !!node.matches?.(OWNED_SELECTOR) || !!node.closest?.(OWNED_SELECTOR);
  }

  function actionTypeFromElement(element) {
    const href = String(element?.getAttribute?.('href') || '').toLowerCase();
    const text = normalizeText(element?.textContent || element?.value || element?.title || '');
    if (/\/edit(?:$|[?#/])/.test(href) || /^(изменить|редактировать(?: тему| сообщение)?|edit)$/.test(text)) return 'edit';
    if (/\/delete(?:$|[?#/])/.test(href) || /^(удалить(?: тему| сообщение| пост)?|delete)$/.test(text)) return 'delete';
    if (/unpin/.test(href) || /^(открепить|unpin)$/.test(text)) return 'unpin';
    if (/\/pin(?:$|[?#/])/.test(href) || /^(закрепить|pin)$/.test(text)) return 'pin';
    if (/unlock|\/open(?:$|[?#/])/.test(href) || /^(открыть(?: тему)?|open|unlock)$/.test(text)) return 'open';
    if (/\/lock(?:$|[?#/])|\/close(?:$|[?#/])/.test(href) || /^(закрыть(?: тему)?|close|lock)$/.test(text)) return 'close';
    if (/\/move(?:$|[?#/])/.test(href) || /^(переместить(?: тему)?|move)$/.test(text)) return 'move';
    return '';
  }

  function isEffectivelyVisible(element) {
    if (!element || element.hidden || element.disabled || element.getAttribute?.('aria-hidden') === 'true') return false;
    const view = element.ownerDocument?.defaultView;
    if (!view?.getComputedStyle) return true;
    for (let node = element; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  }

  function detectDocumentActions(doc, threadId) {
    if (!doc?.querySelectorAll) return [];
    const candidates = [...doc.querySelectorAll('a[href], button, input[type="submit"]')];
    const actions = [];
    for (const element of candidates) {
      if (isOwnedNode(element)) continue;
      if (!isEffectivelyVisible(element)) continue;
      const type = actionTypeFromElement(element);
      if (!type) continue;
      const href = element.getAttribute?.('href') || '';
      const post = element.closest?.('article.message, .message, [id^="post-"]');
      const postId = parsePostId(href) || parsePostId(post?.id || '');
      const controlName = element.getAttribute?.('name') || element.getAttribute?.('data-xf-click') || type;
      actions.push({ type, threadId: parseThreadId(href) || threadId, postId, href, controlName, element, form: element.closest?.('form') || null });
    }
    return filterActions(actions, threadId);
  }

  function inspectDocument(doc, loc) {
    const pathname = loc?.pathname || '';
    const threadId = parseThreadId(pathname);
    const categoryText = [...(doc?.querySelectorAll?.('.p-breadcrumbs a, .breadcrumbs a') || [])]
      .map((node) => node.textContent || '').join(' ');
    const complaint = isComplaintSnapshot({
      categoryText,
      hasComplaintStatus: !!doc?.querySelector?.('[data-complaint], .complaintStatus, [class*="complaint-status"]')
    });
    const postIds = [...(doc?.querySelectorAll?.('article.message, .message, [id^="post-"]') || [])]
      .map((node) => parsePostId(node.id || '') || parsePostId(node.querySelector?.('a[href*="/posts/"]')?.getAttribute('href') || ''))
      .filter(Boolean);
    return {
      kind: classify({ pathname, complaint }),
      threadId,
      postIds: [...new Set(postIds)],
      isFirstThreadPage: !/\/page-(?:[2-9]|\d{2,})(?:\/|$)/i.test(pathname),
      isStaffThread: threadId === '1623',
      isComplaint: complaint,
      title: doc?.querySelector?.('h1')?.textContent?.trim() || doc?.title || '',
      profile: collectProfile(doc),
      actions: detectDocumentActions(doc, threadId)
    };
  }

  function collectProfile(doc) {
    const user = doc?.querySelector?.('.p-navgroup-link--user, a[href="/account/"], [data-nav-id="account"]');
    const name = user?.textContent?.replace(/\s+/g, ' ').trim() || 'Администратор';
    const avatarNode = user?.querySelector?.('img') || doc?.querySelector?.('.p-navgroup-link--user img, .avatar img');
    const roleNode = doc?.querySelector?.('[data-user-role], .userTitle');
    return {
      name,
      avatar: avatarNode?.getAttribute?.('src') || avatarNode?.getAttribute?.('data-src') || '',
      role: roleNode?.textContent?.replace(/\s+/g, ' ').trim() || ''
    };
  }

  return {
    parseThreadId,
    parsePostId,
    isComplaintSnapshot,
    classify,
    filterActions,
    isOwnedNode,
    actionTypeFromElement,
    isEffectivelyVisible,
    detectDocumentActions,
    collectProfile,
    inspectDocument
  };
});
