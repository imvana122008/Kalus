const test = require('node:test');
const assert = require('node:assert/strict');

let store = {};
let history = {};
try { store = require('../src/store.js'); } catch (_) {}
try { history = require('../src/history.js'); } catch (_) {}

test('migrates v2.5 staff state without losing changes', () => {
  const migrated = store.migrateState?.({
    kalusStaffEditorState: {
      overrides: { user: { name: 'Ivan' } },
      added: [{ id: 'added:1', name: 'Test' }],
      ui: { position: 'left-top' }
    }
  });
  assert.deepEqual(migrated?.staff.overrides, { user: { name: 'Ivan' } });
  assert.equal(migrated?.staff.added[0].id, 'added:1');
  assert.equal(migrated?.version, 5);
});

test('default state contains useful complaint templates', () => {
  const state = store.defaultState?.();
  const ids = state?.templates.map((item) => item.id);
  assert.equal(ids?.includes('complaint-approved'), true);
  assert.equal(ids?.includes('complaint-denied'), true);
  assert.equal(ids?.includes('need-evidence'), true);
});

test('history keeps newest 500 entries and strips secrets recursively', () => {
  const input = Array.from({ length: 501 }, (_, index) => ({
    id: index,
    csrf: 'secret',
    csrfToken: 'secret-2',
    meta: { cookie: 'x', authorizationHeader: 'Bearer secret', safe: 'ok' }
  }));
  const output = history.normalizeEntries?.(input);
  assert.equal(output?.length, 500);
  assert.equal(output?.[0].id, 1);
  assert.equal('csrf' in output[0], false);
  assert.equal('csrfToken' in output[0], false);
  assert.deepEqual(output[0].meta, { safe: 'ok' });
});

test('history filters by thread, action and result', () => {
  const entries = [
    { threadId: '1', action: 'pin', ok: true },
    { threadId: '1', action: 'reply', ok: false },
    { threadId: '2', action: 'pin', ok: true }
  ];
  assert.deepEqual(history.filterEntries?.(entries, { threadId: '1', action: 'pin', ok: true }), [entries[0]]);
});

test('migrates v3 state into v5 without losing user data', () => {
  const migrated = store.migrateState?.({
    pkfaStateV3: {
      version: 3,
      templates: [{ id: 'custom:1', title: 'Мой', text: 'Ответ', custom: true }],
      history: [{ id: 'h:1', action: 'reply' }],
      staff: { overrides: { user: { name: 'Ivan' } }, added: [{ id: 'staff:1' }] }
    }
  });
  assert.equal(migrated?.version, 5);
  assert.equal(migrated?.templates[0].id, 'custom:1');
  assert.equal(migrated?.history[0].id, 'h:1');
  assert.equal(migrated?.staff.added[0].id, 'staff:1');
  assert.equal(migrated?.ui.sidebarCollapsed, false);
  assert.deepEqual(migrated?.tags, []);
});

function fixtureV4State() {
  return {
    version: 4,
    templates: [{ id: 'custom:1', title: 'Ответ', text: 'Готово', custom: true }],
    tags: [{ id: 'tag:1', title: 'Проверено', text: 'Проверено' }],
    history: [{ id: 'history:1', action: 'reply', ok: true }],
    staff: { overrides: { admin: { name: 'Ivan' } }, added: [{ id: 'staff:1' }] },
    ui: { sidebarCollapsed: true, lastRoute: 'staff' }
  };
}

test('migrates v4 into v5 once without losing staff, replies, tags or history', () => {
  const v4 = fixtureV4State();
  const first = store.migrateState({ pkfaStateV4: v4 });
  const second = store.migrateState({ pkfaStateV5: first });

  assert.equal(first.version, 5);
  assert.deepEqual(second, first);
  assert.deepEqual(first.templates, v4.templates);
  assert.deepEqual(first.tags, v4.tags);
  assert.deepEqual(first.history, v4.history);
  assert.deepEqual(first.staff.overrides, v4.staff.overrides);
  assert.deepEqual(first.replacements, []);
  assert.deepEqual(first.rules, []);
});

test('isolates a damaged ui group while preserving valid staff data', () => {
  const v4 = fixtureV4State();
  const state = store.migrateState({ pkfaStateV4: { ...v4, ui: 'broken' } });

  assert.equal(typeof state.ui, 'object');
  assert.equal(state.ui.lastRoute, 'home');
  assert.deepEqual(state.staff.overrides, v4.staff.overrides);
});

test('migration caps and sanitizes history and reconciles legacy staff', () => {
  const historyEntries = Array.from({ length: 501 }, (_, id) => ({ id, token: 'secret', error: 'csrf=secret; Authorization: Bearer demo' }));
  const migrated = store.migrateState({
    pkfaStateV4: { version: 4, history: historyEntries, staff: { overrides: { old: { name: 'Old' } } } },
    kalusStaffEditorState: { overrides: { live: { name: 'Live' } }, added: [{ id: 'live:1' }] }
  });
  assert.equal(migrated.history.length, 500);
  assert.equal('token' in migrated.history[0], false);
  assert.equal(migrated.history[0].error.includes('secret'), false);
  assert.equal(migrated.staff.overrides.live.name, 'Live');
  assert.equal(migrated.staff.added[0].id, 'live:1');
});

test('an existing v5 staff state is never overwritten by stale legacy data', () => {
  const migrated = store.migrateState({
    pkfaStateV5: { version: 5, staff: { overrides: { current: { name: 'Current' } }, added: [] } },
    kalusStaffEditorState: { overrides: { stale: { name: 'Stale' } }, added: [] }
  });
  assert.equal(migrated.staff.overrides.current.name, 'Current');
  assert.equal(migrated.staff.overrides.stale, undefined);
});

test('a failed store update does not poison the next update', async () => {
  const previous = globalThis.chrome;
  let saved = store.defaultState();
  globalThis.chrome = { storage: { local: {
    get: async () => ({ pkfaStateV5: saved }),
    set: async ({ pkfaStateV5 }) => { saved = pkfaStateV5; }
  } } };
  try {
    await assert.rejects(() => store.update(() => { throw new Error('temporary'); }));
    const next = await store.update((state) => { state.ui.accent = 'blue'; return state; });
    assert.equal(next.ui.accent, 'blue');
  } finally { globalThis.chrome = previous; }
});

test('history redacts secret-bearing strings on normalization', () => {
  const [entry] = history.normalizeEntries([{ error: 'csrf=topsecret; Authorization: Bearer abc123', text: 'safe' }]);
  assert.equal(entry.error.includes('topsecret'), false);
  assert.equal(entry.error.includes('abc123'), false);
});
