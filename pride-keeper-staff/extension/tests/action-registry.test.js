const test = require('node:test');
const assert = require('node:assert/strict');

const { ActionRegistry, fingerprint, normalizeHref } = require('../src/action-registry.js');

test('keeps edit controls for different posts distinct', () => {
  const actions = [
    { type: 'edit', href: '/posts/41/edit', threadId: '1623', postId: '41', controlName: 'edit' },
    { type: 'edit', href: '/posts/42/edit', threadId: '1623', postId: '42', controlName: 'edit' }
  ];
  const registry = new ActionRegistry();

  assert.equal(registry.replace(actions).length, 2);
  assert.notEqual(fingerprint(actions[0]), fingerprint(actions[1]));
});

test('deduplicates the same observable forum control', () => {
  const action = { type: 'close', href: 'https://forum.pridekeeper.tech/threads/topic.1623/close?x=1#fragment', threadId: '1623', controlName: 'close' };
  const registry = new ActionRegistry();

  assert.equal(registry.replace([action, { ...action }]).length, 1);
  assert.equal(normalizeHref(action.href), '/threads/topic.1623/close?x=1');
});
