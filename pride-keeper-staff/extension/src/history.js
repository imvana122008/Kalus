(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.history = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const SECRET = /(csrf|token|cookie|password|authorization|secret)/i;

  function sanitizeString(value) {
    return String(value)
      .replace(/(authorization\s*[:=]\s*bearer\s+)[a-z0-9._~-]+/gi, '$1[REDACTED]')
      .replace(/(bearer\s+)[a-z0-9._~-]+/gi, '$1[REDACTED]')
      .replace(/((?:csrf|token|cookie|password|authorization|api[_-]?key)\s*[:=]\s*)([^;\s]+)/gi, '$1[REDACTED]')
      ;
  }

  function sanitize(value) {
    if (Array.isArray(value)) return value.map(sanitize);
    if (typeof value === 'string') return sanitizeString(value);
    if (!value || typeof value !== 'object') return value;
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET.test(key)) continue;
      clean[key] = sanitize(item);
    }
    return clean;
  }

  function normalizeEntries(entries = []) {
    return entries.map(sanitize).slice(-500);
  }

  function filterEntries(entries = [], filter = {}) {
    const query = String(filter.query || '').trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter.threadId && String(entry.threadId) !== String(filter.threadId)) return false;
      if (filter.action && entry.action !== filter.action) return false;
      if (typeof filter.ok === 'boolean' && !!entry.ok !== filter.ok) return false;
      if (query && !JSON.stringify(entry).toLowerCase().includes(query)) return false;
      return true;
    });
  }

  async function add(entry) {
    let saved;
    await root.PKFA.store.update((state) => {
      saved = sanitize({ id: `h:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`, time: new Date().toISOString(), ...entry });
      state.history = normalizeEntries([...(state.history || []), saved]);
      return state;
    });
    return saved;
  }

  async function list(filter = {}) {
    const state = await root.PKFA.store.getState();
    return filterEntries(state.history || [], filter);
  }

  async function clear() {
    return root.PKFA.store.update((state) => { state.history = []; return state; });
  }

  async function exportJson() {
    return JSON.stringify(await list(), null, 2);
  }

  return { sanitizeString, sanitize, normalizeEntries, filterEntries, add, list, clear, exportJson };
});
