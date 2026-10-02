(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.store = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const KEY = 'pkfaStateV5';
  const V4_KEY = 'pkfaStateV4';
  const V3_KEY = 'pkfaStateV3';
  const PREVIOUS_KEYS = [V4_KEY, V3_KEY];
  const LEGACY_KEY = 'kalusStaffEditorState';

  function builtInTemplates() {
    return [
      { id: 'complaint-approved', category: 'Жалобы', title: 'Жалоба одобрена', color: 'green', text: 'Доброго времени суток, {author}.\nЖалоба рассмотрена и одобрена. Нарушитель получит наказание согласно правилам проекта.\nЗакрыто.' },
      { id: 'complaint-denied', category: 'Жалобы', title: 'Жалоба отклонена', color: 'red', text: 'Доброго времени суток, {author}.\nЖалоба отклонена: предоставленных материалов недостаточно для выдачи наказания.\nЗакрыто.' },
      { id: 'need-evidence', category: 'Жалобы', title: 'Нужны доказательства', color: 'yellow', text: 'Доброго времени суток, {author}.\nПожалуйста, предоставьте полную видеозапись ситуации без обрезки и монтажа.' },
      { id: 'senior-review', category: 'Жалобы', title: 'Передано старшей администрации', color: 'purple', text: 'Доброго времени суток, {author}.\nОбращение передано старшей администрации для дополнительной проверки.' },
      { id: 'greeting', category: 'Общие', title: 'Приветствие', color: 'purple', text: 'Доброго времени суток, {author}.' }
    ];
  }

  function defaultState() {
    return {
      version: 5,
      settings: { side: 'right', width: 'normal', compact: false, instantSend: true },
      ui: { sidebarCollapsed: false, lastRoute: 'home', accent: 'gold', scale: 'normal', inlinePosition: 'below' },
      templates: builtInTemplates(),
      tags: [],
      replacements: [],
      rules: [],
      complaints: { defaultStatus: 'pending', analyticsRange: '30d' },
      recentThreads: [],
      history: [],
      favorites: [],
      staff: { overrides: {}, added: [], hidden: [], ui: { position: 'right-bottom', size: 'standard' }, autoPublish: { enabled: true, targetPostId: '' } }
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function objectGroup(value, fallback) {
    return isPlainObject(value) ? { ...clone(fallback), ...clone(value) } : clone(fallback);
  }

  function arrayGroup(value, fallback = []) {
    return Array.isArray(value) ? clone(value) : clone(fallback);
  }

  const SECRET = /(csrf|token|cookie|password|authorization|secret)/i;
  function sanitizeHistoryValue(value) {
    if (typeof value === 'string') return value
      .replace(/(authorization\s*[:=]\s*bearer\s+)[a-z0-9._~-]+/gi, '$1[REDACTED]')
      .replace(/(bearer\s+)[a-z0-9._~-]+/gi, '$1[REDACTED]')
      .replace(/((?:csrf|token|cookie|password|authorization|api[_-]?key)\s*[:=]\s*)([^;\s]+)/gi, '$1[REDACTED]')
      ;
    if (Array.isArray(value)) return value.map(sanitizeHistoryValue);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET.test(key)).map(([key, item]) => [key, sanitizeHistoryValue(item)]));
  }

  function normalizeHistory(value) {
    return arrayGroup(value).map(sanitizeHistoryValue).slice(-500);
  }

  function migrateState(raw = {}) {
    const existing = raw[KEY] || raw[V4_KEY] || raw[V3_KEY] || ([3, 4, 5].includes(raw.version) ? raw : null);
    if (existing) {
      const defaults = defaultState();
      const next = { ...defaults, ...clone(existing), version: 5 };
      next.settings = objectGroup(existing.settings, defaults.settings);
      next.ui = objectGroup(existing.ui, defaults.ui);
      next.complaints = objectGroup(existing.complaints, defaults.complaints);
      const legacyStaff = !raw[KEY] && isPlainObject(raw[LEGACY_KEY]) ? raw[LEGACY_KEY] : null;
      next.staff = objectGroup(legacyStaff || existing.staff, defaults.staff);
      const staffSource = legacyStaff || existing.staff || {};
      next.staff.ui = objectGroup(staffSource.ui, defaults.staff.ui);
      next.staff.autoPublish = objectGroup(staffSource.autoPublish, defaults.staff.autoPublish);
      next.staff.overrides = isPlainObject(staffSource.overrides) ? clone(staffSource.overrides) : {};
      next.staff.added = arrayGroup(staffSource.added);
      next.staff.hidden = arrayGroup(staffSource.hidden);
      next.templates = arrayGroup(existing.templates, defaults.templates);
      next.history = normalizeHistory(existing.history);
      next.tags = arrayGroup(existing.tags);
      next.replacements = arrayGroup(existing.replacements);
      next.rules = arrayGroup(existing.rules);
      next.recentThreads = arrayGroup(existing.recentThreads);
      next.favorites = arrayGroup(existing.favorites);
      return next;
    }

    const legacy = raw[LEGACY_KEY] || raw.kalusStaffEditorState;
    const next = defaultState();
    if (legacy && typeof legacy === 'object') {
      next.staff = {
        ...next.staff,
        ...clone(legacy),
        overrides: clone(legacy.overrides || {}),
        added: clone(legacy.added || [])
      };
    }
    return next;
  }

  async function getState() {
    if (!root.chrome?.storage?.local) return defaultState();
    const raw = await root.chrome.storage.local.get([KEY, ...PREVIOUS_KEYS, LEGACY_KEY]);
    const state = migrateState(raw);
    if (!raw[KEY]) {
      await root.chrome.storage.local.set({ [KEY]: state });
      const saved = await root.chrome.storage.local.get([KEY]);
      return migrateState(saved);
    }
    return state;
  }

  let updateQueue = Promise.resolve();
  function update(mutator) {
    const operation = updateQueue.catch(() => undefined).then(async () => {
      const state = await getState();
      const result = await mutator(state);
      const next = result && typeof result === 'object' ? result : state;
      next.version = 5;
      if (root.chrome?.storage?.local) await root.chrome.storage.local.set({ [KEY]: next });
      return next;
    });
    updateQueue = operation.catch(() => undefined);
    return operation;
  }

  return { KEY, V4_KEY, V3_KEY, PREVIOUS_KEYS, LEGACY_KEY, builtInTemplates, defaultState, migrateState, getState, update };
});
