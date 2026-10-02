(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.preferences = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const FIELD_MAP = {
    settings: ['side', 'width', 'compact', 'instantSend'],
    ui: ['sidebarCollapsed', 'lastRoute', 'accent', 'scale', 'inlinePosition'],
    complaints: ['defaultStatus', 'analyticsRange']
  };
  const TEMPLATE_FIELDS = ['id', 'category', 'title', 'color', 'text', 'custom', 'favorite'];
  const TAG_FIELDS = ['id', 'title', 'text', 'color', 'group'];
  const REPLACEMENT_FIELDS = ['id', 'from', 'to', 'enabled'];
  const RULE_FIELDS = ['id', 'title', 'text', 'url', 'category', 'favorite'];
  const SECRET = /(csrf|token|cookie|password|authorization|secret|__proto__|prototype|constructor)/i;

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function pick(source, fields) {
    if (!isPlainObject(source)) return {};
    const result = {};
    for (const key of fields) {
      const value = source[key];
      if (SECRET.test(key) || !['string', 'number', 'boolean'].includes(typeof value)) continue;
      result[key] = value;
    }
    return result;
  }

  function pickList(value, fields) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 500).filter(isPlainObject).map((item) => pick(item, fields));
  }

  function portableState(state = {}) {
    return {
      version: 5,
      settings: pick(state.settings, FIELD_MAP.settings),
      ui: pick(state.ui, FIELD_MAP.ui),
      templates: pickList(state.templates, TEMPLATE_FIELDS),
      tags: pickList(state.tags, TAG_FIELDS),
      replacements: pickList(state.replacements, REPLACEMENT_FIELDS),
      rules: pickList(state.rules, RULE_FIELDS),
      complaints: pick(state.complaints, FIELD_MAP.complaints)
    };
  }

  function exportSettings(state = {}) {
    return JSON.stringify(portableState(state), null, 2);
  }

  function validateImport(input) {
    let parsed;
    try { parsed = typeof input === 'string' ? JSON.parse(input) : input; }
    catch (_) { return { ok: false, errors: ['Некорректный JSON'] }; }
    if (!isPlainObject(parsed)) return { ok: false, errors: ['Корневое значение должно быть объектом'] };
    if (![4, 5].includes(parsed.version)) return { ok: false, errors: ['Поддерживаются настройки версий 4 и 5'] };
    const listGroups = { templates: TEMPLATE_FIELDS, tags: TAG_FIELDS, replacements: REPLACEMENT_FIELDS, rules: RULE_FIELDS };
    for (const key of Object.keys(listGroups)) {
      if (Object.hasOwn(parsed, key) && !Array.isArray(parsed[key])) return { ok: false, errors: [`${key}: ожидается массив`] };
      if (Array.isArray(parsed[key]) && parsed[key].some((item) => !isPlainObject(item))) return { ok: false, errors: [`${key}: неверный элемент`] };
    }
    for (const key of ['settings', 'ui', 'complaints']) {
      if (Object.hasOwn(parsed, key) && !isPlainObject(parsed[key])) return { ok: false, errors: [`${key}: ожидается объект`] };
    }
    const scalarTypes = {
      'settings.compact': 'boolean', 'settings.instantSend': 'boolean',
      'ui.sidebarCollapsed': 'boolean', 'ui.lastRoute': 'string', 'ui.accent': 'string', 'ui.scale': 'string', 'ui.inlinePosition': 'string',
      'complaints.defaultStatus': 'string', 'complaints.analyticsRange': 'string'
    };
    for (const [path, expected] of Object.entries(scalarTypes)) {
      const [group, key] = path.split('.');
      if (isPlainObject(parsed[group]) && Object.hasOwn(parsed[group], key) && typeof parsed[group][key] !== expected) return { ok: false, errors: [`${path}: неверный тип`] };
    }
    if (parsed.ui?.accent && !['gold', 'purple', 'blue'].includes(parsed.ui.accent)) return { ok: false, errors: ['ui.accent: неизвестное значение'] };
    if (parsed.ui?.scale && !['compact', 'normal', 'large'].includes(parsed.ui.scale)) return { ok: false, errors: ['ui.scale: неизвестное значение'] };
    if (parsed.ui?.inlinePosition && !['above', 'below'].includes(parsed.ui.inlinePosition)) return { ok: false, errors: ['ui.inlinePosition: неизвестное значение'] };
    const value = { version: 5 };
    for (const [group, fields] of Object.entries(FIELD_MAP)) if (Object.hasOwn(parsed, group)) value[group] = pick(parsed[group], fields);
    for (const [group, fields] of Object.entries(listGroups)) if (Object.hasOwn(parsed, group)) value[group] = pickList(parsed[group], fields);
    return { ok: true, value, errors: [] };
  }

  function describeImport(input) {
    const checked = validateImport(input);
    if (!checked.ok) return checked;
    const groups = ['settings', 'ui', 'templates', 'tags', 'replacements', 'rules', 'complaints']
      .filter((key) => Object.hasOwn(checked.value, key));
    return { ok: true, value: checked.value, groups, errors: [] };
  }

  async function applyImport(input, store = root.PKFA?.store) {
    const checked = validateImport(input);
    if (!checked.ok) return checked;
    if (!store?.update) return { ok: false, errors: ['Хранилище недоступно'] };
    const saved = await store.update((state) => {
      if (checked.value.settings) state.settings = { ...(state.settings || {}), ...checked.value.settings };
      if (checked.value.ui) state.ui = { ...(state.ui || {}), ...checked.value.ui };
      if (checked.value.complaints) state.complaints = { ...(state.complaints || {}), ...checked.value.complaints };
      for (const key of ['templates', 'tags', 'replacements', 'rules']) if (Object.hasOwn(checked.value, key)) state[key] = checked.value[key];
      return state;
    });
    return { ok: true, value: saved, errors: [] };
  }

  return { FIELD_MAP, portableState, exportSettings, validateImport, describeImport, applyImport };
});
