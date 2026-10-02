(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.complaints = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const STATUSES = [
    { id: 'resolved', label: 'Рассмотрено', tone: 'success' },
    { id: 'denied', label: 'Отказано', tone: 'danger' },
    { id: 'pending', label: 'На рассмотрении', tone: 'info' },
    { id: 'senior-review', label: 'На рассмотрение ГА', tone: 'purple' },
    { id: 'punishment-removed', label: 'Наказание снято', tone: 'neutral' },
    { id: 'punishment-reduced', label: 'Наказание снижено', tone: 'warning' }
  ];

  function clean(value = '') { return String(value).replace(/\s+/g, ' ').trim(); }

  function normalizeStatus(value = '') {
    const normalized = clean(value).toLowerCase();
    if (normalized === 'на рассмотрении га') return 'senior-review';
    return STATUSES.find((status) => status.id === normalized || status.label.toLowerCase() === normalized)?.id || '';
  }

  function nodeText(doc, selector) { return clean(doc?.querySelector?.(selector)?.textContent || ''); }

  function buildCard(doc, context = {}) {
    const rawStatus = nodeText(doc, '[data-complaint-status], .complaintStatus, [class*="complaint-status"]');
    const firstPost = doc?.querySelector?.('article.message, .message, [id^="post-"]');
    const author = clean(firstPost?.querySelector?.('[data-xf-init="member-tooltip"], .message-name a, .username')?.textContent || '');
    const accused = nodeText(doc, '[data-accused], .complaint-accused, [class*="accused"]');
    return {
      threadId: String(context.threadId || ''),
      title: nodeText(doc, 'h1') || context.title || '',
      section: nodeText(doc, '.p-breadcrumbs a, .breadcrumbs a'),
      author,
      accused,
      status: normalizeStatus(rawStatus),
      isComplaint: !!context.isComplaint
    };
  }

  function summarize(entries = [], range = {}) {
    const from = range.from ? new Date(range.from).getTime() : -Infinity;
    const to = range.to ? new Date(range.to).getTime() : Infinity;
    const relevant = entries.filter((entry) => {
      const time = new Date(entry.time || 0).getTime();
      return entry.action === 'complaint-status' && time >= from && time <= to;
    });
    const result = { total: relevant.length, resolved: 0, denied: 0, pending: 0, seniorReview: 0, errors: 0, sections: {} };
    for (const entry of relevant) {
      if (entry.status === 'resolved') result.resolved += 1;
      if (entry.status === 'denied') result.denied += 1;
      if (entry.status === 'pending') result.pending += 1;
      if (entry.status === 'senior-review') result.seniorReview += 1;
      if (!entry.ok) result.errors += 1;
      if (entry.section) result.sections[entry.section] = (result.sections[entry.section] || 0) + 1;
    }
    return result;
  }

  return { STATUSES, normalizeStatus, buildCard, summarize };
});
