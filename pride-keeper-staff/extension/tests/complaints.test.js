const test = require('node:test');
const assert = require('node:assert/strict');

let complaints = {};
let context = {};
try { complaints = require('../src/complaints.js'); } catch (_) {}
try { context = require('../src/context.js'); } catch (_) {}

test('normalizes supported complaint statuses and rejects unknown values', () => {
  assert.equal(complaints.normalizeStatus?.('Рассмотрено'), 'resolved');
  assert.equal(complaints.normalizeStatus?.('На рассмотрении ГА'), 'senior-review');
  assert.equal(complaints.normalizeStatus?.('что-то другое'), '');
});

test('summarizes complaint actions within the selected date range', () => {
  const entries = [
    { time: '2026-09-20T10:00:00.000Z', action: 'complaint-status', status: 'resolved', ok: true, section: 'Жалобы на игроков' },
    { time: '2026-09-21T10:00:00.000Z', action: 'complaint-status', status: 'denied', ok: true, section: 'Жалобы на игроков' },
    { time: '2026-09-21T11:00:00.000Z', action: 'complaint-status', status: 'pending', ok: false, section: 'Жалобы на администрацию' }
  ];
  const out = complaints.summarize?.(entries, { from: '2026-09-21T00:00:00.000Z', to: '2026-09-21T23:59:59.999Z' });
  assert.equal(out?.total, 2);
  assert.equal(out?.denied, 1);
  assert.equal(out?.pending, 1);
  assert.equal(out?.errors, 1);
  assert.deepEqual(out?.sections, { 'Жалобы на игроков': 1, 'Жалобы на администрацию': 1 });
});

test('collects forum profile with a stable fallback', () => {
  const avatar = { getAttribute: (name) => name === 'src' ? '/avatars/ivan.jpg' : '' };
  const user = { textContent: ' Ivan_Kalus ', querySelector: () => avatar };
  const doc = { querySelector: (selector) => selector.includes('p-navgroup-link--user') ? user : null };
  assert.deepEqual(context.collectProfile?.(doc), { name: 'Ivan_Kalus', avatar: '/avatars/ivan.jpg', role: '' });
  assert.deepEqual(context.collectProfile?.({ querySelector: () => null }), { name: 'Администратор', avatar: '', role: '' });
});

test('builds complaint card only from observable page data', () => {
  const nodes = {
    'h1': { textContent: 'Жалоба на Player_Test' },
    '.p-breadcrumbs a, .breadcrumbs a': { textContent: 'Жалобы на игроков' },
    '[data-complaint-status], .complaintStatus, [class*="complaint-status"]': { textContent: 'На рассмотрении' }
  };
  const doc = { querySelector: (selector) => nodes[selector] || null };
  const card = complaints.buildCard?.(doc, { threadId: '77', isComplaint: true });
  assert.equal(card?.threadId, '77');
  assert.equal(card?.title, 'Жалоба на Player_Test');
  assert.equal(card?.section, 'Жалобы на игроков');
  assert.equal(card?.status, 'pending');
  assert.equal(card?.accused, '');
});
