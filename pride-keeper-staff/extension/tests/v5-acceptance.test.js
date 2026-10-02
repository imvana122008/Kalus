const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(project, name), 'utf8');
const { ActionRegistry } = require('../src/action-registry.js');
const { createRuntime } = require('../src/runtime.js');
const { performDomAction } = require('../src/actions.js');
const store = require('../src/store.js');

function fixtureDocument() {
  const nodes = [];
  const add = (entry) => {
    const node = { dataset: {}, ...entry };
    node.remove = () => { const index = nodes.indexOf(node); if (index >= 0) nodes.splice(index, 1); };
    nodes.push(node);
    return node;
  };
  return {
    nodes,
    add,
    body: { appendChild: add },
    documentElement: { appendChild: add },
    getElementById: (id) => nodes.find((node) => node.id === id) || null,
    querySelectorAll(selector) {
      if (selector === '#pkfa-app-root') return nodes.filter((node) => node.id === 'pkfa-app-root');
      if (selector === '#pkfa-inline-root') return nodes.filter((node) => node.id === 'pkfa-inline-root');
      if (selector === '[data-pkfa-launcher]') return nodes.filter((node) => node.launcher);
      return [];
    }
  };
}

test('release identifiers and forum-only scope are v5.0.0', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.version, '5.0.0');
  assert.deepEqual(manifest.host_permissions, ['https://forum.pridekeeper.tech/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://forum.pridekeeper.tech/*']);
  assert.match(read('src/bootstrap.js'), /version:\s*'5\.0\.0'/);
  assert.match(read('src/staff.js'), /__PRIDE_KEEPER_STAFF__\s*=\s*"5\.0\.0"/);
});

test('v5 migration survives fifty refreshes with one root, toolbar and launcher', async () => {
  const document = fixtureDocument();
  const migrated = store.migrateState({ version: 4, ui: { lastRoute: 'staff' }, templates: [], tags: [], history: [], staff: { sections: {} } });
  const registry = new ActionRegistry();
  const runtime = createRuntime({
    registry,
    context: {
      inspectDocument: () => ({ threadId: '1623', kind: 'staff', actions: [{ type: 'edit', href: '/posts/42/edit', postId: '42', threadId: '1623', fingerprint: 'edit|42' }] }),
      isOwnedNode: () => false
    },
    store: { getState: async () => migrated },
    panel: { mount: () => { if (!document.getElementById('pkfa-app-root')) { document.add({ id: 'pkfa-app-root' }); document.add({ launcher: true }); } } },
    inlineToolbar: { mount: () => { if (!document.getElementById('pkfa-inline-root')) document.add({ id: 'pkfa-inline-root' }); } }
  });
  for (let index = 0; index < 50; index += 1) await runtime.refresh(document, { pathname: '/threads/example.1623/' });
  assert.equal(document.querySelectorAll('#pkfa-app-root').length, 1);
  assert.equal(document.querySelectorAll('#pkfa-inline-root').length, 1);
  assert.equal(document.querySelectorAll('[data-pkfa-launcher]').length, 1);
  assert.equal(runtime.registry.list().length, 1);
  assert.equal(migrated.version, 5);
  assert.equal(migrated.ui.lastRoute, 'staff');
});

test('acceptance audit opens edit and move only and never submits or confirms', async () => {
  const calls = [];
  const element = { click: () => calls.push('click') };
  const form = { requestSubmit: () => calls.push('requestSubmit') };
  for (const type of ['edit', 'move']) {
    const result = await performDomAction({ type, element, form });
    assert.equal(result.mechanism, 'open-only');
  }
  assert.deepEqual(calls, ['click', 'click']);
  assert.doesNotMatch(read('src/staff.js'), /quickReply\.(?:requestSubmit|submit)\s*\(/i);
});
