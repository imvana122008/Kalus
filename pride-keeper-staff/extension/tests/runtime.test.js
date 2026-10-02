const test = require('node:test');
const assert = require('node:assert/strict');

const { ActionRegistry } = require('../src/action-registry.js');
let runtime = {};
try { runtime = require('../src/runtime.js'); } catch (_) {}

function node({ owned = false } = {}) {
  return {
    nodeType: 1,
    matches: (selector) => owned && selector.includes('[data-pkfa-owned="true"]'),
    closest: (selector) => owned && selector.includes('[data-pkfa-owned="true"]') ? {} : null
  };
}

function fixtureThread() {
  const nodes = [];
  const document = {
    nodes,
    body: { appendChild(item) { nodes.push(item); } },
    documentElement: { appendChild(item) { nodes.push(item); } },
    querySelectorAll(selector) {
      if (selector === '#pkfa-app-root') return nodes.filter((item) => item.id === 'pkfa-app-root');
      if (selector === '#pkfa-inline-root') return nodes.filter((item) => item.id === 'pkfa-inline-root');
      if (selector === '[data-pkfa-launcher]') return nodes.filter((item) => item.launcher);
      return [];
    },
    getElementById(id) { return nodes.find((item) => item.id === id) || null; }
  };
  const add = (data) => {
    const item = { ...data, dataset: {}, remove() { const index = nodes.indexOf(item); if (index >= 0) nodes.splice(index, 1); } };
    nodes.push(item);
    return item;
  };
  return {
    document,
    location: { pathname: '/threads/test.1623/', href: 'https://forum.pridekeeper.tech/threads/test.1623/' },
    expectedActionCount: 1,
    deps: {
      context: { inspectDocument: () => ({ threadId: '1623', actions: [{ type: 'edit', href: '/posts/42/edit', postId: '42', threadId: '1623', controlName: 'edit' }] }), isOwnedNode: (item) => !!item?.matches?.('[data-pkfa-owned="true"]') },
      store: { getState: async () => ({ version: 4, ui: {}, tags: [] }) },
      panel: { mount: () => { add({ id: 'pkfa-app-root' }); add({ launcher: true }); } },
      inlineToolbar: { mount: () => add({ id: 'pkfa-inline-root' }) },
      registry: new ActionRegistry()
    }
  };
}

test('ignores a forum-target mutation that adds only owned nodes', () => {
  const owned = node({ owned: true });
  const app = runtime.createRuntime?.({ context: { isOwnedNode: (item) => item === owned } });
  assert.equal(app?.mutationNeedsRefresh({ target: node(), addedNodes: [owned], removedNodes: [] }), false);
});

test('keeps one launcher, app root and inline root after fifty refreshes', async () => {
  const env = fixtureThread();
  const app = runtime.createRuntime?.(env.deps);
  for (let index = 0; index < 50; index += 1) await app.refresh(env.document, env.location);

  assert.equal(env.document.querySelectorAll('[data-pkfa-launcher]').length, 1);
  assert.equal(env.document.querySelectorAll('#pkfa-app-root').length, 1);
  assert.equal(env.document.querySelectorAll('#pkfa-inline-root').length, 1);
  assert.equal(app.registry.list().length, env.expectedActionCount);
});

test('reuses one action executor across mutation refreshes', async () => {
  const env = fixtureThread();
  const executor = { run: async () => ({ status: 'success' }) };
  const seen = [];
  env.deps.actionExecutor = executor;
  env.deps.inlineToolbar = { mount: (_doc, deps) => { seen.push(deps.actionExecutor); if (!env.document.getElementById('pkfa-inline-root')) env.document.nodes.push({ id: 'pkfa-inline-root', dataset: {}, remove() {} }); } };
  const app = runtime.createRuntime(env.deps);
  await app.refresh(env.document, env.location);
  await app.refresh(env.document, env.location);
  assert.deepEqual(seen, [executor, executor]);
});
