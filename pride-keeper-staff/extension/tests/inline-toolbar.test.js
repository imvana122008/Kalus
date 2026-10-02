const test = require('node:test');
const assert = require('node:assert/strict');

let toolbar = {};
try { toolbar = require('../src/inline-toolbar.js'); } catch (_) {}

function form(action, hasEditor = true) {
  return {
    getAttribute: (name) => name === 'action' ? action : '',
    querySelector: () => hasEditor ? {} : null
  };
}

test('selects Quick Reply and never the post edit form', () => {
  const edit = form('/posts/4425/edit');
  const quick = form('/threads/1623/add-reply');
  const doc = { querySelectorAll: () => [edit, quick] };
  assert.equal(toolbar.findQuickReply?.(doc), quick);
});

test('builds complaint statuses only for complaint pages', () => {
  const state = {
    tags: [{ id: 'tag:1', title: 'Выдано верно', text: 'Выдано верно' }],
    templates: [
      { id: 'complaint-approved', category: 'Жалобы', title: 'Жалоба одобрена', text: 'Одобрено' },
      { id: 'greeting', category: 'Общие', title: 'Приветствие', text: 'Здравствуйте' }
    ]
  };
  const complaint = toolbar.toolbarModel?.({ isComplaint: true, actions: [{ type: 'close', threadId: '77' }] }, state);
  const regular = toolbar.toolbarModel?.({ isComplaint: false, actions: [] }, state);
  assert.equal(complaint.statuses.length, 6);
  assert.equal(complaint.actions[0].type, 'close');
  assert.equal(complaint.tags[0].id, 'tag:1');
  assert.deepEqual(complaint.templates.map((item) => item.id), ['complaint-approved', 'greeting']);
  assert.deepEqual(regular.statuses, []);
  assert.deepEqual(regular.templates.map((item) => item.id), ['complaint-approved', 'greeting']);
});

test('renders complaint quick replies as insert-only controls', () => {
  const html = toolbar.render?.({
    actions: [], statuses: [], tags: [], threadId: '77',
    templates: [{ id: 'complaint-approved', title: 'Жалоба одобрена', text: 'Одобрено' }]
  });

  assert.match(html || '', /Быстрые ответы/);
  assert.match(html || '', /data-pkfa-template="complaint-approved"/);
  assert.doesNotMatch(html || '', /data-pkfa-send-template/);
});

test('shows quick reply templates in every thread while keeping complaint statuses contextual', () => {
  const state = {
    templates: [
      { id: 'complaint-approved', category: 'Жалобы', title: 'Жалоба одобрена', text: 'Одобрено' },
      { id: 'greeting', category: 'Общие', title: 'Приветствие', text: 'Здравствуйте' }
    ]
  };

  const regular = toolbar.toolbarModel?.({ isComplaint: false, actions: [] }, state);

  assert.deepEqual(regular.statuses, []);
  assert.deepEqual(regular.templates.map((item) => item.id), ['complaint-approved', 'greeting']);
  assert.match(toolbar.render(regular), /Быстрые ответы/);
});

test('mounts one toolbar even when refresh runs twice', () => {
  let root = null;
  let inserts = 0;
  const quick = form('/threads/77/add-reply');
  quick.parentNode = {
    insertBefore(node) { root = node; inserts += 1; },
    appendChild(node) { root = node; inserts += 1; }
  };
  quick.nextSibling = null;
  const doc = {
    querySelectorAll: () => [quick],
    getElementById: () => root,
    createElement: () => ({ id: '', className: '', dataset: {}, innerHTML: '', addEventListener() {} })
  };
  const deps = { context: { isComplaint: false, actions: [] }, state: { tags: [] } };
  assert.equal(toolbar.mount?.(doc, deps)?.mounted, true);
  assert.equal(toolbar.mount?.(doc, deps)?.mounted, false);
  assert.equal(inserts, 1);
});

test('does not mount when Quick Reply is missing', () => {
  const doc = { querySelectorAll: () => [], getElementById: () => null };
  assert.deepEqual(toolbar.mount?.(doc, {}), { mounted: false, reason: 'missing-reply' });
});

test('labels post edit separately from thread edit', () => {
  const html = toolbar.render?.({
    actions: [
      { type: 'edit', href: '/posts/4425/edit' },
      { type: 'edit', href: '/threads/1623/edit' }
    ],
    statuses: [], tags: []
  });
  assert.match(html || '', /Изменить сообщение/);
  assert.match(html || '', /Редактировать тему/);
});

test('chooses toolbar placement from saved settings', () => {
  assert.equal(toolbar.placementForState?.({ ui: { inlinePosition: 'above' } }), 'above');
  assert.equal(toolbar.placementForState?.({ ui: { inlinePosition: 'below' } }), 'below');
  assert.equal(toolbar.placementForState?.({}), 'below');
});

test('inline toolbar includes an accessible operation status', () => {
  const html = toolbar.render?.({ actions: [], statuses: [], tags: [], threadId: '1' });
  assert.match(html || '', /role="status"/);
  assert.match(html || '', /data-pkfa-notice/);
});

test('toolbar renders each registry fingerprint once', () => {
  const action = { fingerprint: 'edit|/posts/42/edit|1623|42|edit', type: 'edit', href: '/posts/42/edit', postId: '42' };
  const model = toolbar.toolbarModel?.({ threadId: '1623' }, {}, [action, { ...action }]);

  assert.equal(model.actions.length, 1);
  assert.match(toolbar.render(model), /Изменить сообщение #42/);
  assert.equal((toolbar.render(model).match(/data-pkfa-action-key=/g) || []).length, 1);
});

test('keeps edit controls for different posts visible with their post numbers', () => {
  const model = toolbar.toolbarModel?.({ threadId: '1623' }, {}, [
    { fingerprint: 'edit-41', type: 'edit', href: '/posts/41/edit', postId: '41' },
    { fingerprint: 'edit-42', type: 'edit', href: '/posts/42/edit', postId: '42' }
  ]);
  const html = toolbar.render(model);

  assert.match(html, /Изменить сообщение #41/);
  assert.match(html, /Изменить сообщение #42/);
});
