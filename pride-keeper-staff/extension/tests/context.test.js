const test = require('node:test');
const assert = require('node:assert/strict');

let context = {};
try { context = require('../src/context.js'); } catch (_) {}

test('extracts numeric thread id from both XenForo URL formats', () => {
  assert.equal(context.parseThreadId?.('/threads/1623/'), '1623');
  assert.equal(context.parseThreadId?.('/threads/test.1623/page-2'), '1623');
});

test('marks paginated thread pages as unsafe for first-post publication', () => {
  const doc = { querySelectorAll: () => [], querySelector: () => null, title: '' };
  assert.equal(context.inspectDocument(doc, { pathname: '/threads/staff.1623/' }).isFirstThreadPage, true);
  assert.equal(context.inspectDocument(doc, { pathname: '/threads/staff.1623/page-2' }).isFirstThreadPage, false);
});

test('ignores controls hidden by an ancestor', () => {
  const parent = { nodeType: 1, parentElement: null };
  const element = { nodeType: 1, parentElement: parent, ownerDocument: { defaultView: { getComputedStyle: (node) => ({ display: node === parent ? 'none' : 'block', visibility: 'visible' }) } } };
  assert.equal(context.isEffectivelyVisible(element), false);
});

test('classifies staff, complaint and regular pages', () => {
  assert.equal(context.classify?.({ pathname: '/threads/1623/', complaint: false }), 'staff');
  assert.equal(context.classify?.({ pathname: '/threads/report.77/', complaint: true }), 'complaint');
  assert.equal(context.classify?.({ pathname: '/threads/news.88/', complaint: false }), 'thread');
  assert.equal(context.classify?.({ pathname: '/account/', complaint: false }), 'other');
});

test('keeps only actions belonging to the current thread', () => {
  const actions = context.filterActions?.([
    { type: 'pin', threadId: '88', href: '/threads/88/pin' },
    { type: 'delete', threadId: '99', href: '/posts/4/delete' },
    { type: 'edit', threadId: '88', postId: '4', href: '/posts/4/edit' }
  ], '88');
  assert.deepEqual(actions?.map((x) => x.type), ['pin', 'edit']);
});

test('detects complaint pages from stable semantic hints', () => {
  assert.equal(context.isComplaintSnapshot?.({ categoryText: 'Жалобы на игроков', hasComplaintStatus: false }), true);
  assert.equal(context.isComplaintSnapshot?.({ categoryText: 'Общая курилка', hasComplaintStatus: true }), true);
  assert.equal(context.isComplaintSnapshot?.({ categoryText: 'Новости', hasComplaintStatus: false }), false);
});

test('does not confuse editor formatting controls with destructive forum actions', () => {
  const formattingButton = {
    textContent: 'Удалить форматирование',
    value: '',
    title: '',
    getAttribute: () => ''
  };
  assert.equal(context.actionTypeFromElement?.(formattingButton), '');
});

test('does not expose a thread action whose href belongs to another thread', () => {
  const foreignEdit = {
    textContent: 'Редактировать тему',
    value: '',
    title: '',
    getAttribute: (name) => name === 'href' ? '/threads/99/edit' : '',
    closest: () => null
  };
  const doc = { querySelectorAll: () => [foreignEdit] };
  assert.deepEqual(context.detectDocumentActions?.(doc, '88'), []);
});

test('recognizes a real XenForo edit href independently from its label', () => {
  const edit = {
    textContent: 'Изменить',
    value: '',
    title: '',
    getAttribute: (name) => name === 'href' ? '/posts/4425/edit' : ''
  };
  assert.equal(context.actionTypeFromElement?.(edit), 'edit');
});

test('does not expose actions hidden by the live forum menu', () => {
  const hiddenEdit = {
    textContent: 'Редактировать тему', value: '', title: '', hidden: false,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ display: 'none', visibility: 'visible' }) } },
    getAttribute: (name) => name === 'href' ? '/threads/88/edit' : '',
    closest: () => null,
    getClientRects: () => []
  };
  const doc = { querySelectorAll: () => [hiddenEdit] };
  assert.deepEqual(context.detectDocumentActions?.(doc, '88'), []);
});

test('ignores every helper-owned control before action classification', () => {
  const ownedDelete = {
    nodeType: 1,
    textContent: 'Удалить тему', value: '', title: '', hidden: false,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) } },
    getAttribute: (name) => name === 'href' ? '/posts/44/delete' : '',
    matches: (selector) => selector.includes('[data-pkfa-owned="true"]'),
    closest: (selector) => selector.includes('[data-pkfa-owned="true"]') ? ownedDelete : null
  };
  const forumEdit = {
    nodeType: 1,
    textContent: 'Изменить', value: '', title: '', hidden: false,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) } },
    getAttribute: (name) => name === 'href' ? '/posts/42/edit' : '',
    matches: () => false,
    closest: (selector) => selector.includes('article.message') ? { id: 'post-42' } : null
  };
  const doc = { querySelectorAll: () => [ownedDelete, forumEdit] };

  assert.deepEqual(context.detectDocumentActions(doc, '1623').map((item) => item.postId), ['42']);
});
