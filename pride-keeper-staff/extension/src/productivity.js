(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.productivity = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  function validateTag(tag = {}) {
    const title = String(tag.title || '').trim();
    const text = String(tag.text || '').trim();
    if (!title) return { ok: false, reason: 'empty-title' };
    if (!text) return { ok: false, reason: 'empty-text' };
    if (title.length > 32) return { ok: false, reason: 'title-too-long' };
    if (text.length > 500) return { ok: false, reason: 'text-too-long' };
    return { ok: true, value: { ...tag, title, text } };
  }

  function validateReplacement(rule = {}) {
    const from = String(rule.from || '').trim();
    const to = String(rule.to || '').trim();
    if (!from) return { ok: false, reason: 'empty-from' };
    if (!to) return { ok: false, reason: 'empty-to' };
    if (from === to) return { ok: false, reason: 'direct-cycle' };
    return { ok: true, value: { ...rule, from, to } };
  }

  function escapePattern(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyReplacements(text, rules = []) {
    const active = rules
      .filter((rule) => rule?.enabled !== false && validateReplacement(rule).ok)
      .map((rule) => validateReplacement(rule).value)
      .sort((a, b) => b.from.length - a.from.length);
    if (!active.length) return String(text || '');
    const values = new Map(active.map((rule) => [rule.from, rule.to]));
    const pattern = new RegExp(active.map((rule) => escapePattern(rule.from)).join('|'), 'gu');
    return String(text || '').replace(pattern, (match) => values.get(match) ?? match);
  }

  function validateReplacementSet(rules = []) {
    const edges = new Map(rules.filter((rule) => rule?.enabled !== false && validateReplacement(rule).ok).map((rule) => [String(rule.from).trim(), String(rule.to).trim()]));
    for (const start of edges.keys()) {
      const seen = new Set([start]);
      let current = edges.get(start);
      while (edges.has(current)) {
        if (seen.has(current)) return { ok: false, reason: 'cycle', at: current };
        seen.add(current); current = edges.get(current);
      }
    }
    return { ok: true };
  }

  function searchRules(items = [], query = '') {
    const needle = String(query).trim().toLowerCase();
    if (!needle) return [...items];
    return items.filter((item) => `${item.title || ''} ${item.text || ''} ${item.url || ''}`.toLowerCase().includes(needle));
  }

  function reorder(items = [], from, to) {
    const result = [...items];
    const start = Number(from);
    const end = Number(to);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0 || start >= result.length || end >= result.length || start === end) return result;
    const [item] = result.splice(start, 1);
    result.splice(end, 0, item);
    return result;
  }

  return { validateTag, validateReplacement, validateReplacementSet, applyReplacements, searchRules, reorder };
});
