(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.actions = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const ALLOWED = new Set(['pin', 'unpin', 'close', 'open', 'move', 'edit', 'delete']);

  function validateDescriptor(descriptor = {}, context = {}) {
    if (!ALLOWED.has(descriptor.type)) return { ok: false, reason: 'unknown-action' };
    if (!descriptor.threadId || String(descriptor.threadId) !== String(context.threadId || '')) {
      return { ok: false, reason: 'wrong-thread' };
    }
    const threadAction = ['edit', 'delete'].includes(descriptor.type) && String(descriptor.href || '').match(new RegExp(`/threads/(?:[^/?#]+\\.)?(\\d+)/${descriptor.type}(?:$|[/?#])`, 'i'));
    if (threadAction) {
      if (String(threadAction[1]) !== String(descriptor.threadId)) return { ok: false, reason: 'wrong-thread' };
    } else if (['edit', 'delete'].includes(descriptor.type)) {
      if (!descriptor.postId) return { ok: false, reason: 'missing-post' };
      if (descriptor.href) {
        const escaped = String(descriptor.postId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const expected = new RegExp(`/posts/${escaped}/${descriptor.type}(?:$|[/?#])`, 'i');
        if (!expected.test(descriptor.href)) return { ok: false, reason: 'wrong-post' };
      }
    }
    return { ok: true };
  }

  function actionKey(descriptor) {
    return descriptor.fingerprint || `${descriptor.type}:${descriptor.threadId}:${descriptor.postId || ''}:${descriptor.href || ''}`;
  }

  function sourceIsLive(descriptor = {}, contextApi = root.PKFA?.context) {
    const element = descriptor.element;
    if (!element || element.isConnected === false || element.disabled || element.hidden || element.getAttribute?.('aria-disabled') === 'true') return false;
    if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
    const view = element.ownerDocument?.defaultView;
    if (view?.getComputedStyle) {
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        if (style?.display === 'none' || style?.visibility === 'hidden') return false;
      }
    }
    const owned = contextApi?.isOwnedNode?.(element)
      || element.matches?.('#pkfa-app-root, #pkfa-inline-root, [data-pkfa-owned="true"]')
      || element.closest?.('#pkfa-app-root, #pkfa-inline-root, [data-pkfa-owned="true"]');
    return !owned;
  }

  function waitFor(check, timeout = 1800) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const value = check();
        if (value) return resolve(value);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, 60);
      };
      tick();
    });
  }

  function overlayMatches(type, overlay) {
    const text = String(overlay?.textContent || '').toLowerCase();
    const words = {
      delete: ['удал', 'delete'], close: ['закры', 'close', 'lock'], open: ['откры', 'open', 'unlock'],
      pin: ['закреп', 'pin'], unpin: ['откреп', 'unpin']
    }[type] || [];
    return words.some((word) => text.includes(word));
  }

  async function performDomAction(descriptor) {
    const element = descriptor.element;
    if (descriptor.type === 'edit' || descriptor.type === 'move') {
      if (!element?.click) throw new Error('Элемент действия больше недоступен');
      element.click();
      return { ok: true, mechanism: 'open-only' };
    }
    if (!element?.click) throw new Error('Элемент действия больше недоступен');
    element.click();

    const overlay = await waitFor(() => root.document?.querySelector?.('.overlay-container.is-active, .overlay-container:not(.is-hidden), .overlay[open]'), 900);
    return { ok: true, mechanism: overlay ? 'overlay' : 'click' };
  }

  class ActionExecutor {
    constructor(options = {}) {
      this.getContext = options.getContext || (() => root.PKFA.context.inspectDocument(root.document, root.location));
      this.perform = options.perform || performDomAction;
      this.onHistory = options.onHistory || ((entry) => root.PKFA.history?.add?.(entry));
      this.sourceCheck = options.sourceCheck || sourceIsLive;
      this.locks = new Set();
    }

    isLocked(key) { return this.locks.has(key); }

    async run(descriptor) {
      const context = this.getContext();
      const validation = validateDescriptor(descriptor, context);
      if (!validation.ok) return { status: 'rejected', reason: validation.reason };
      if (!this.sourceCheck(descriptor)) return { status: 'rejected', reason: 'stale-source' };

      const key = actionKey(descriptor);
      if (this.locks.has(key)) return { status: 'blocked', reason: 'duplicate' };
      this.locks.add(key);
      try {
        const detail = await this.perform(descriptor);
        const result = { status: 'success', ok: true, detail };
        await this.onHistory?.({ action: descriptor.type, threadId: descriptor.threadId, postId: descriptor.postId || '', title: context.title || '', ok: true });
        return result;
      } catch (error) {
        await this.onHistory?.({ action: descriptor.type, threadId: descriptor.threadId, postId: descriptor.postId || '', title: context.title || '', ok: false, error: error?.message || String(error) });
        return { status: 'error', ok: false, error: error?.message || String(error) };
      } finally {
        this.locks.delete(key);
      }
    }
  }

  return { ALLOWED, validateDescriptor, actionKey, sourceIsLive, overlayMatches, performDomAction, ActionExecutor };
});
