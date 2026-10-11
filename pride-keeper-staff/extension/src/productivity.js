(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.productivity = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
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

  function expandTypedSuffix(text, state = {}) {
    const input = String(text || '');
    const boundary = input.match(/\s+$/);
    if (!boundary) return input;
    const body = input.slice(0, -boundary[0].length);
    const rules = [...(state.replacements || []).filter(rule => rule.enabled !== false && validateReplacement(rule).ok),
      ...(state.tags || []).filter(tag => tag.title && tag.text).map(tag => ({ from:`{${tag.title}}`, to:tag.text }))]
      .sort((a,b) => b.from.length - a.from.length);
    for (const rule of rules) {
      if (!body.endsWith(rule.from)) continue;
      const start = body.length - rule.from.length;
      if (start > 0 && !/\s/.test(body[start - 1])) continue;
      return body.slice(0,start) + rule.to + boundary[0];
    }
    return input;
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

  function splitForumRules(text, title, url) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean);
    const parts = []; let current = null;
    for (const line of lines) {
      const number = line.match(/^(\d+(?:\.\d+)*)(?:[.)]|\s)[\s\u00a0]*(.+)/);
      if (number) { current = { title: number[1], text: line }; parts.push(current); }
      else if (current) current.text += '\n' + line;
    }
    if (!parts.length && lines.length) parts.push({ title, text: lines.join('\n') });
    return parts.map((part,index) => ({ ...part, id:`forum-rule:${url}:${index}`, category:title, url, source:'forum', updatedAt:new Date().toISOString() }));
  }

  function mergeForumRules(existing, incoming) {
    const refreshed = new Set(incoming.map(item => item.url));
    return [...existing.filter(item => item.source !== 'forum' || !refreshed.has(item.url)), ...incoming];
  }

  function officialRuleLinks(doc, origin) {
    const result = new Map();
    for (const a of doc.querySelectorAll('.structItem-title a[href]')) {
      try {
        const url = new URL(a.getAttribute('href'), origin);
        if (url.origin !== origin || !/^\/(?:threads\/[^/]+\/|rules\/[^/]+\/)$/.test(url.pathname)) continue;
        result.set(url.href, { url:url.href, title:a.textContent.trim() });
      } catch (_) {}
    }
    return [...result.values()].slice(0, 30);
  }

  function extractForumRuleText(doc, Parser = root.DOMParser) {
    const content = doc.querySelector('article.message .bbWrapper, article.message .message-body, .bbWrapper');
    if (!content) return '';
    const copy = content.cloneNode(true);
    // Some official topics render a custom element from a literal HTML
    // template. Read that template as inert markup; never execute its script.
    for (const script of content.querySelectorAll('script')) {
      const template = script.textContent.match(/(?:shadowRoot\.)?innerHTML\s*=\s*`([\s\S]*?)`/);
      if (template && !template[1].includes('${')) {
        const parsed = new Parser().parseFromString(template[1], 'text/html');
        copy.appendChild(parsed.body.cloneNode(true));
      }
    }
    copy.querySelectorAll('script,style,button,title,meta').forEach(node => node.remove());
    copy.querySelectorAll('br').forEach(node => node.replaceWith(doc.createTextNode('\n')));
    copy.querySelectorAll('p,div,li,h1,h2,h3,tr').forEach(node => node.appendChild(doc.createTextNode('\n')));
    return copy.textContent;
  }

  async function loadForumRules(options = {}) {
    const origin = options.origin || root.location.origin;
    const fetcher = options.fetcher || root.fetch.bind(root);
    const Parser = options.Parser || root.DOMParser;
    async function read(url) {
      const response = await fetcher(url, { credentials:'same-origin', signal:root.AbortSignal?.timeout?.(15000) });
      if (!response.ok || (response.url && new URL(response.url).origin !== origin)) throw new Error('Не удалось загрузить правила форума');
      return new Parser().parseFromString(await response.text(), 'text/html');
    }
    const index = await read(new URL('/forums/rules/', origin).href);
    const links = officialRuleLinks(index, origin);
    if (!links.length) throw new Error('Темы правил не найдены. Проверьте вход на форум.');
    const records = [], failed = [];
    for (const entry of links) {
      try {
        const doc = await read(entry.url);
        const parts = splitForumRules(extractForumRuleText(doc, Parser), entry.title, entry.url);
        if (!parts.length) throw new Error('Пустые правила');
        records.push(...parts);
      } catch (_) { failed.push(entry.title); }
    }
    if (!records.length) throw new Error('Правила не загрузились. Сохранённый каталог оставлен без изменений.');
    return { records, failed, pages:links.length - failed.length };
  }

  return { validateTag, validateReplacement, validateReplacementSet, applyReplacements, expandTypedSuffix, searchRules, reorder, splitForumRules, mergeForumRules, officialRuleLinks, extractForumRuleText, loadForumRules };
});
