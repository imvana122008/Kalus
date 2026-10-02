const test = require('node:test');
const assert = require('node:assert/strict');

let panel = {};
try { panel = require('../src/panel.js'); } catch (_) {}

test('builds context-aware dashboard routes', () => {
  const expected = ['home', 'staff', 'replies', 'tags', 'replace', 'rules', 'complaints', 'analytics', 'history', 'settings'];
  assert.deepEqual(panel.routesForContext?.({ kind: 'staff' }), expected);
  assert.deepEqual(panel.routesForContext?.({ kind: 'complaint' }), expected);
  assert.deepEqual(panel.routesForContext?.({ kind: 'other' }), expected);
});

test('selects the primary dashboard route for each context', () => {
  assert.equal(panel.preferredRoute?.({ kind: 'staff' }), 'staff');
  assert.equal(panel.preferredRoute?.({ kind: 'complaint' }), 'complaints');
  assert.equal(panel.preferredRoute?.({ kind: 'thread' }), 'home');
});

test('uses mobile, compact and full sidebar modes at target widths', () => {
  assert.equal(panel.sidebarMode?.(360, false), 'mobile');
  assert.equal(panel.sidebarMode?.(768, false), 'full');
  assert.equal(panel.sidebarMode?.(1180, true), 'compact');
  assert.equal(panel.sidebarMode?.(1440, false), 'full');
});

test('dashboard model uses observable profile and local complaint totals', () => {
  const model = panel.dashboardModel?.(
    { kind: 'complaint', threadId: '77', title: 'Жалоба', profile: { name: 'Ivan_Kalus', avatar: '/a.jpg', role: 'Администратор' }, isComplaint: true },
    { history: [{ action: 'complaint-status', status: 'resolved', ok: true, time: '2026-09-21T10:00:00Z' }], ui: { sidebarCollapsed: false }, recentThreads: [] }
  );
  assert.equal(model.profile.name, 'Ivan_Kalus');
  assert.equal(model.complaintTotal, 1);
  assert.equal(model.routes.includes('complaints'), true);
});

test('shell template exposes accessible dialog and navigation state', () => {
  const html = panel.shellTemplate?.({ profile: { name: 'Ivan_Kalus', avatar: '' }, routes: ['home', 'settings'], contextLabel: 'Тема #77' }, 'home', false);
  assert.match(html || '', /role="dialog"/);
  assert.match(html || '', /aria-current="page"/);
  assert.match(html || '', /Ivan_Kalus/);
  assert.doesNotMatch(html || '', /href="https:\/\/(?:vk\.com|t\.me)"/);
  assert.doesNotMatch(html || '', /class="pkfa-bell"/);
  assert.equal((html.match(/data-pkfa-launcher/g) || []).length, 1);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /HELPER <em>v5\.0<\/em>/);
});

test('uses one round paw launcher without the old PK cube', () => {
  const html = panel.shellTemplate?.({ profile: { name: 'Ivan' }, routes: ['home'], contextLabel: 'Форум' }, 'home', false);

  assert.equal((html.match(/data-pkfa-launcher/g) || []).length, 1);
  assert.match(html || '', /pkfa-launcher-v4--round/);
  assert.match(html || '', /pridekeeper-paw\.png/);
  assert.doesNotMatch(html || '', /data-pkfa-launcher[^>]*><b>PK<\/b>/);
});
