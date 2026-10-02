(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.actionRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  function normalizeHref(value = '') {
    try {
      const url = new URL(value, 'https://forum.pridekeeper.tech/');
      return `${url.pathname}${url.search}`;
    } catch (_) {
      return String(value || '').trim();
    }
  }

  function fingerprint(action = {}) {
    return [action.type, normalizeHref(action.href), action.threadId, action.postId, action.controlName]
      .map((value) => String(value || ''))
      .join('|');
  }

  class ActionRegistry {
    constructor() {
      this.items = new Map();
    }

    replace(actions = []) {
      this.items = new Map(actions.map((action) => {
        const key = fingerprint(action);
        return [key, { ...action, fingerprint: key }];
      }));
      return this.list();
    }

    list() {
      return [...this.items.values()];
    }

    get(key) {
      return this.items.get(key) || null;
    }
  }

  return { normalizeHref, fingerprint, ActionRegistry };
});
