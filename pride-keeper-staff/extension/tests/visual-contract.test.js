const test = require('node:test');
const assert = require('node:assert/strict');

test('Inter font is bundled, licensed and available to the forum without remote font requests', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'src/panel.css'), 'utf8');
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*['"]Inter['"]/);
  assert.match(css, /\.\.\/assets\/InterVariable\.woff2/);
  const font = fs.readFileSync(path.join(root, 'assets/InterVariable.woff2'));
  assert.equal(font.subarray(0, 4).toString(), 'wOF2');
  assert.match(fs.readFileSync(path.join(root, 'assets/Inter-LICENSE.txt'), 'utf8'), /SIL OPEN FONT LICENSE/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.ok(manifest.web_accessible_resources.some(group => group.resources.includes('assets/InterVariable.woff2')));
});
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const project = join(__dirname, '..');
const css = () => readFileSync(join(project, 'src/panel.css'), 'utf8');
const panel = require('../src/panel.js');
const toolbar = require('../src/inline-toolbar.js');

test('css defines v5 tokens and all target viewport contracts', () => {
  const source = css();
  for (const token of ['--pkfa-bg: #0b0f15', '--pkfa-accent: #e4ae32', '--pkfa-card: #151d27']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const width of ['360px', '768px', '1180px', '1440px']) assert.match(source, new RegExp(width));
  assert.match(source, /max-height:\s*92vh/);
});

test('owned controls expose focus disabled busy and reduced-motion states', () => {
  const source = css();
  assert.match(source, /:focus-visible/);
  assert.match(source, /\[disabled\]/);
  assert.match(source, /\[aria-busy="true"\]/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
});

test('toolbar wraps and marks every generated control as owned', () => {
  const source = css();
  assert.match(source, /\.pkfa-inline__row\s*\{[^}]*display:flex[^}]*flex-wrap:wrap/s);
  const html = toolbar.render({
    actions: [{ type: 'close', fingerprint: 'close|1' }],
    statuses: [{ id: 'resolved', label: 'Рассмотрено', tone: 'success' }],
    tags: [{ id: 'tag:1', title: 'Проверено' }]
  });
  const buttons = html.match(/<button\b[^>]*>/g) || [];
  assert.equal(buttons.length, 4);
  for (const button of buttons) assert.match(button, /data-pkfa-owned="true"/);
});

test('shell images and icon-only controls have accessible labels', () => {
  const html = panel.shellTemplate({ profile: { name: 'Ivan', avatar: '/avatar.png' }, routes: ['home'], contextLabel: 'Форум' }, 'home', false);
  for (const image of html.match(/<img\b[^>]*>/g) || []) assert.match(image, /\balt="[^"]*"/);
  assert.match(html, /data-helper-close[^>]*aria-label="Закрыть"/);
  assert.match(html, /data-collapse[^>]*aria-label="Открыть навигацию"/);
});

test('layout helpers cover 360 768 1180 and 1440 widths', () => {
  assert.deepEqual([360, 768, 1180, 1440].map((width) => panel.sidebarMode(width, width === 1180)), ['mobile', 'full', 'compact', 'full']);
});
