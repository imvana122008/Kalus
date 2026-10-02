const test = require('node:test');
const assert = require('node:assert/strict');

let panel = {};
try { panel = require('../src/panel.js'); } catch (_) {}

test('shows tabs that match the current page type', () => {
  assert.deepEqual(panel.tabsForKind?.('staff'), ['staff', 'actions', 'replies', 'history']);
  assert.deepEqual(panel.tabsForKind?.('complaint'), ['actions', 'replies', 'history']);
  assert.deepEqual(panel.tabsForKind?.('thread'), ['actions', 'replies', 'history']);
  assert.deepEqual(panel.tabsForKind?.('other'), ['history']);
});

test('opens each page type on its primary tab', () => {
  assert.equal(panel.preferredTab?.('staff'), 'staff');
  assert.equal(panel.preferredTab?.('complaint'), 'actions');
  assert.equal(panel.preferredTab?.('thread'), 'actions');
  assert.equal(panel.preferredTab?.('other'), 'history');
});

test('uses consistent semantic tones for dangerous and reversible actions', () => {
  assert.equal(panel.actionTone?.('delete'), 'danger');
  assert.equal(panel.actionTone?.('close'), 'warning');
  assert.equal(panel.actionTone?.('open'), 'success');
  assert.equal(panel.actionTone?.('pin'), 'accent');
});

test('uses full width only on narrow viewports', () => {
  assert.equal(panel.layoutForWidth?.(360), 'mobile');
  assert.equal(panel.layoutForWidth?.(768), 'panel');
  assert.equal(panel.layoutForWidth?.(1440), 'panel');
});

test('debounce collapses several DOM changes into one context refresh', async () => {
  let calls = 0;
  const debounced = panel.debounce ? panel.debounce(() => { calls += 1; }, 20) : () => {};
  debounced(); debounced(); debounced();
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(calls, 1);
});

test('template search keeps matching favorites first', () => {
  const items = [
    { id: '1', title: 'Обычный ответ', category: 'Общие', text: 'текст', favorite: false },
    { id: '2', title: 'Жалоба рассмотрена', category: 'Жалобы', text: 'решение', favorite: true },
    { id: '3', title: 'Жалоба отклонена', category: 'Жалобы', text: 'отказ', favorite: false }
  ];
  assert.deepEqual(panel.filterTemplates?.(items, { query: 'жалоба', category: 'Жалобы' }).map((x) => x.id), ['2', '3']);
});

test('template visibility combines search and category instead of replacing either filter', () => {
  const card = { title: 'Жалоба рассмотрена', category: 'Жалобы', text: 'решение принято' };
  assert.equal(panel.templateVisible?.(card, { query: 'решение', category: 'Жалобы' }), true);
  assert.equal(panel.templateVisible?.(card, { query: 'решение', category: 'Общие' }), false);
  assert.equal(panel.templateVisible?.(card, { query: 'отказ', category: 'Жалобы' }), false);
});

test('history filters by text, action and result', () => {
  const entries = [
    { action: 'reply', title: 'Жалоба 10', ok: true },
    { action: 'delete', title: 'Тема 20', ok: false },
    { action: 'reply', title: 'Тема 30', ok: false }
  ];
  assert.deepEqual(panel.filterHistory?.(entries, { query: 'тема', action: 'reply', result: 'error' }), [entries[2]]);
});

test('history clear requires a second click within the safety window', () => {
  assert.deepEqual(panel.nextConfirmState?.(0, 1000, 5000), { execute: false, armedUntil: 6000 });
  assert.deepEqual(panel.nextConfirmState?.(6000, 2000, 5000), { execute: true, armedUntil: 0 });
  assert.deepEqual(panel.nextConfirmState?.(1500, 2000, 5000), { execute: false, armedUntil: 7000 });
});

test('today analytics starts at local midnight and exported ranges are bounded', () => {
  const now = new Date(2026, 8, 22, 15, 30, 0).getTime();
  const bounds = panel.analyticsBounds('today', now);
  const start = new Date(bounds.from);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(new Date(bounds.to).getTime() > now, true);
});

test('escape closes the dialog only when staff is clean', () => {
  assert.deepEqual(panel.closeDecision?.({ staffDirty: false }), { allowed: true, message: '' });
  const blocked = panel.closeDecision?.({ staffDirty: true });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.message, /несохран/i);
});

test('all v5 routes have a named view instead of an inert tile', () => {
  const routes = panel.routesForContext?.({ kind: 'thread' }) || [];
  assert.deepEqual(routes, ['home', 'staff', 'replies', 'tags', 'replace', 'rules', 'complaints', 'analytics', 'history', 'settings']);
  for (const route of routes) assert.equal(panel.hasView?.(route), true, `${route} view is missing`);
});

test('staff route reserves an embedded workspace and has no legacy modal launcher', () => {
  const html = panel.staffViewTemplate?.({ kind: 'staff' }) || '';
  assert.match(html, /data-staff-workspace-host/);
  assert.doesNotMatch(html, /data-open-staff/);
});
