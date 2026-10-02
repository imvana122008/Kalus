const test = require('node:test');
const assert = require('node:assert/strict');

let preferences = {};
try { preferences = require('../src/preferences.js'); } catch (_) {}

test('exports only portable v5 settings and round-trips them', () => {
  const source = {
    version: 4,
    settings: { compact: true, instantSend: false },
    ui: { sidebarCollapsed: true, accent: 'gold', lastRoute: 'analytics' },
    templates: [{ id: 'custom:1', title: 'Ответ', text: 'Готово', custom: true, favorite: true }],
    tags: [{ id: 'tag:1', title: 'Выдано верно' }],
    replacements: [{ id: 'replace:1', from: '/пр', to: 'Проверено', enabled: true }],
    rules: [{ id: 'rule:1', title: '1.1', text: 'Флуд', url: '/rules/1' }],
    complaints: { defaultStatus: 'pending', analyticsRange: '7d' },
    history: [{ token: 'secret', action: 'reply' }],
    staff: { autoPublish: { targetPostId: '4425' } }
  };
  const json = preferences.exportSettings?.(source);
  const parsed = JSON.parse(json);
  assert.equal(parsed.version, 5);
  assert.equal(parsed.ui.lastRoute, 'analytics');
  assert.equal('history' in parsed, false);
  assert.equal('staff' in parsed, false);
  const checked = preferences.validateImport?.(json);
  assert.equal(checked.ok, true);
  assert.equal(checked.value.templates[0].id, 'custom:1');
  assert.equal(checked.value.templates[0].favorite, true);
  assert.equal(checked.value.replacements[0].from, '/пр');
  assert.equal(checked.value.rules[0].title, '1.1');
});

test('rejects malformed JSON and unsupported schema versions', () => {
  assert.equal(preferences.validateImport?.('{broken').ok, false);
  assert.equal(preferences.validateImport?.('{"version":3}').ok, false);
  assert.equal(preferences.validateImport?.('[]').ok, false);
});

test('drops prototype keys, secrets and unknown settings during import', () => {
  const raw = '{"version":4,"settings":{"compact":true,"unknown":9,"csrfToken":"x","__proto__":{"polluted":true}},"ui":{"accent":"purple","constructor":{"bad":true}},"templates":[],"tags":[],"complaints":{}}';
  const checked = preferences.validateImport?.(raw);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.value.settings, { compact: true });
  assert.deepEqual(checked.value.ui, { accent: 'purple' });
  assert.equal({}.polluted, undefined);
});

test('does not mutate current state when validation fails', async () => {
  let updates = 0;
  const result = await preferences.applyImport?.('{bad', {
    update: async () => { updates += 1; }
  });
  assert.equal(result.ok, false);
  assert.equal(updates, 0);
});

test('accepts portable v4 settings and describes v5 import groups', () => {
  const input = JSON.stringify({
    version: 4,
    settings: { compact: true }, ui: { accent: 'purple' }, templates: [], tags: [], complaints: {}
  });
  const described = preferences.describeImport?.(input);

  assert.equal(described.ok, true);
  assert.equal(described.value.version, 5);
  assert.deepEqual(described.groups, ['settings', 'ui', 'templates', 'tags', 'complaints']);
});

test('rejects malformed group types and invalid scalar values', () => {
  assert.equal(preferences.validateImport({ version: 5, templates: 'not-an-array' }).ok, false);
  assert.equal(preferences.validateImport({ version: 5, ui: { sidebarCollapsed: 'false' } }).ok, false);
  assert.equal(preferences.validateImport({ version: 5, ui: { accent: 'neon' } }).ok, false);
});

test('missing import groups preserve current arrays', async () => {
  const current = { version: 5, settings: {}, ui: {}, complaints: {}, templates: [{ id: 'keep' }], tags: [{ id: 'keep-tag' }], replacements: [{ id: 'keep-replace' }], rules: [{ id: 'keep-rule' }] };
  const result = await preferences.applyImport({ version: 5, ui: { accent: 'blue' } }, {
    update: async (mutator) => mutator(current)
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.templates[0].id, 'keep');
  assert.equal(result.value.tags[0].id, 'keep-tag');
  assert.equal(result.value.replacements[0].id, 'keep-replace');
});
