const test = require('node:test');
const assert = require('node:assert/strict');

let gate = {};
try { gate = require('../src/staff-gate.js'); } catch (_) {}

test('runs staff editor only in thread 1623 or its marked publish edit page', () => {
  assert.equal(gate.shouldRunStaff?.('/threads/1623/'), true);
  assert.equal(gate.shouldRunStaff?.('/threads/test.1623/page-2'), true);
  assert.equal(gate.shouldRunStaff?.('/posts/4425/edit'), false);
  assert.equal(gate.shouldRunStaff?.('/posts/4425/edit', '#pkfa-staff-publish'), true);
  assert.equal(gate.shouldRunStaff?.('/posts/4425/edit', '#unrelated'), false);
  assert.equal(gate.shouldRunStaff?.('/threads/900/'), false);
  assert.equal(gate.shouldRunStaff?.('/account/'), false);
});

test('recognizes the custom event used by the unified panel', () => {
  assert.equal(gate.OPEN_EVENT, 'PKFA_OPEN_STAFF');
});

test('hides the legacy launcher when the unified shell is present', () => {
  assert.equal(gate.shouldShowLegacyLauncher?.(true), false);
  assert.equal(gate.shouldShowLegacyLauncher?.(false), true);
});

test('does not append the legacy launcher when the unified shell is present', () => {
  const children = [];
  const container = { appendChild: (node) => children.push(node) };
  const launcher = { id: 'legacy-paw' };

  assert.equal(gate.appendLegacyLauncher?.(container, launcher, true), false);
  assert.deepEqual(children, []);
  assert.equal(gate.appendLegacyLauncher?.(container, launcher, false), true);
  assert.deepEqual(children, [launcher]);
});

test('allows publishing only in staff thread with a first post and exact edit action', () => {
  const valid = {
    threadId: '1623', postIds: ['4425', '4426'],
    actions: [{ type: 'edit', postId: '4425', href: '/posts/4425/edit' }]
  };
  assert.equal(gate.canPublish?.(valid), true);
  assert.equal(gate.canPublish?.({ ...valid, threadId: '77' }), false);
  assert.equal(gate.canPublish?.({ ...valid, actions: [{ type: 'edit', postId: '4426', href: '/posts/4426/edit' }] }), false);
});
