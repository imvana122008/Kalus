const test = require('node:test');
const assert = require('node:assert/strict');

const productivity = require('../src/productivity.js');

test('rejects empty and directly cyclic replacement rules', () => {
  assert.equal(productivity.validateReplacement({ from: '', to: 'x' }).ok, false);
  assert.equal(productivity.validateReplacement({ from: '/pk', to: '/pk' }).ok, false);
  assert.equal(productivity.validateReplacement({ from: '/pk', to: '' }).ok, false);
});

test('rejects multi-rule replacement cycles', () => {
  assert.equal(productivity.validateReplacementSet([{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }]).ok, false);
  assert.equal(productivity.validateReplacementSet([{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }]).ok, true);
});

test('applies enabled replacements once in longest-key order', () => {
  const rules = [
    { from: '/п', to: 'Короткий', enabled: true },
    { from: '/привет', to: 'Здравствуйте', enabled: true },
    { from: 'мир', to: 'ошибка', enabled: false }
  ];
  assert.equal(productivity.applyReplacements('/привет, мир!', rules), 'Здравствуйте, мир!');
});

test('supports unicode replacements without changing unmatched text', () => {
  const rules = [{ from: 'вітаю', to: 'Доброго дня', enabled: true }];
  assert.equal(productivity.applyReplacements('Я вітаю вас 🐾', rules), 'Я Доброго дня вас 🐾');
});

test('rule search never invents a remote result', () => {
  const items = [{ id: '1', title: '1.1', text: 'Флуд', url: '/rules/1' }];
  assert.deepEqual(productivity.searchRules(items, 'оскорбление'), []);
  assert.deepEqual(productivity.searchRules(items, 'флуд'), items);
});

test('validates tags and reorders without mutating the source', () => {
  assert.equal(productivity.validateTag({ title: '', text: 'x' }).ok, false);
  assert.equal(productivity.validateTag({ title: 'Проверено', text: 'Ответ' }).ok, true);
  const source = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(productivity.reorder(source, 0, 2).map((item) => item.id), [2, 3, 1]);
  assert.deepEqual(source.map((item) => item.id), [1, 2, 3]);
});
