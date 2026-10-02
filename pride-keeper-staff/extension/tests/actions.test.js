const test = require('node:test');
const assert = require('node:assert/strict');

let actions = {};
try { actions = require('../src/actions.js'); } catch (_) {}

function makeExecutor(options) {
  return actions.ActionExecutor ? new actions.ActionExecutor(options) : { run: async () => ({}) };
}

test('blocks a duplicate action until the first operation finishes', async () => {
  let resolve;
  let calls = 0;
  const pending = new Promise((done) => { resolve = done; });
  const executor = makeExecutor({
    getContext: () => ({ threadId: '88' }),
    perform: async () => { calls += 1; await pending; return { ok: true }; }
  });
  const descriptor = { type: 'pin', threadId: '88', postId: '', element: { isConnected: true } };
  const first = executor.run(descriptor);
  const second = await executor.run(descriptor);
  assert.equal(second.status, 'blocked');
  assert.equal(calls, 1);
  resolve();
  assert.equal((await first).status, 'success');
});

test('rejects an action that belongs to another thread', async () => {
  let calls = 0;
  const executor = makeExecutor({
    getContext: () => ({ threadId: '88' }),
    perform: async () => { calls += 1; return { ok: true }; }
  });
  const result = await executor.run({ type: 'delete', threadId: '99', postId: '4', element: { isConnected: true } });
  assert.equal(result.status, 'rejected');
  assert.equal(calls, 0);
});

test('unlocks an action after server failure so it can be retried', async () => {
  let calls = 0;
  const executor = makeExecutor({
    getContext: () => ({ threadId: '88' }),
    perform: async () => { calls += 1; if (calls === 1) throw new Error('network'); return { ok: true }; }
  });
  const descriptor = { type: 'close', threadId: '88', postId: '', element: { isConnected: true } };
  assert.equal((await executor.run(descriptor)).status, 'error');
  assert.equal((await executor.run(descriptor)).status, 'success');
  assert.equal(calls, 2);
});

test('validates edit/delete href against the selected post id', () => {
  assert.equal(actions.validateDescriptor?.({ type: 'edit', threadId: '88', postId: '4425', href: '/posts/4425/edit' }, { threadId: '88' }).ok, true);
  assert.equal(actions.validateDescriptor?.({ type: 'edit', threadId: '88', postId: '4425', href: '/posts/9999/edit' }, { threadId: '88' }).ok, false);
});

test('validates thread edit against the current thread without requiring a post id', () => {
  assert.equal(actions.validateDescriptor?.({ type: 'edit', threadId: '88', postId: '', href: '/threads/88/edit' }, { threadId: '88' }).ok, true);
  assert.equal(actions.validateDescriptor?.({ type: 'edit', threadId: '88', postId: '', href: '/threads/99/edit' }, { threadId: '88' }).ok, false);
});

test('validates observed thread delete without inventing a post id', () => {
  assert.equal(actions.validateDescriptor?.({ type: 'delete', threadId: '88', href: '/threads/88/delete' }, { threadId: '88' }).ok, true);
  assert.equal(actions.validateDescriptor?.({ type: 'delete', threadId: '88', href: '/threads/99/delete' }, { threadId: '88' }).ok, false);
});

test('never auto-confirms edit or move overlays', () => {
  const editOverlay = { textContent: 'Изменить сообщение' };
  const moveOverlay = { textContent: 'Переместить тему' };
  const deleteOverlay = { textContent: 'Удалить сообщение' };
  assert.equal(actions.overlayMatches?.('edit', editOverlay), false);
  assert.equal(actions.overlayMatches?.('move', moveOverlay), false);
  assert.equal(actions.overlayMatches?.('delete', deleteOverlay), true);
});

test('edit and move only click the source control and return immediately', async () => {
  for (const type of ['edit', 'move']) {
    const clicks = [];
    const result = await actions.performDomAction({ type, element: { click: () => clicks.push('source') } });
    assert.deepEqual(clicks, ['source']);
    assert.equal(result.mechanism, 'open-only');
  }
});

test('rejects a detached source before the action performer runs', async () => {
  let calls = 0;
  const executor = makeExecutor({
    getContext: () => ({ threadId: '88' }),
    perform: async () => { calls += 1; return { ok: true }; }
  });
  const result = await executor.run({ type: 'close', threadId: '88', element: { isConnected: false } });

  assert.deepEqual(result, { status: 'rejected', reason: 'stale-source' });
  assert.equal(calls, 0);
});

test('rejects disabled and effectively hidden sources', async () => {
  const executor = makeExecutor({ getContext: () => ({ threadId: '88' }), perform: async () => ({ ok: true }) });
  assert.equal((await executor.run({ type: 'close', threadId: '88', element: { isConnected: true, disabled: true } })).reason, 'stale-source');
  assert.equal((await executor.run({ type: 'close', threadId: '88', element: { isConnected: true, getClientRects: () => [] } })).reason, 'stale-source');
});

test('native form actions activate the observed source instead of requestSubmit', async () => {
  const calls = [];
  await actions.performDomAction({
    type: 'close',
    element: { click: () => calls.push('click') },
    form: { requestSubmit: () => calls.push('requestSubmit') }
  });
  assert.deepEqual(calls, ['click']);
});

test('uses registry fingerprint as the operation lock key', () => {
  assert.equal(actions.actionKey?.({ fingerprint: 'close|stable', type: 'close', threadId: '88' }), 'close|stable');
});

test('destructive actions leave the visible forum confirmation to the user', async () => {
  const previousDocument = globalThis.document;
  let sourceClicks = 0;
  let confirmClicks = 0;
  globalThis.document = {
    querySelector: () => ({
      textContent: 'Удалить сообщение',
      querySelector: () => ({ click: () => { confirmClicks += 1; } })
    })
  };
  try {
    const result = await actions.performDomAction({ type: 'delete', element: { click: () => { sourceClicks += 1; } } });
    assert.equal(result.mechanism, 'overlay');
    assert.equal(sourceClicks, 1);
    assert.equal(confirmClicks, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});
