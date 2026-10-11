const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../src/productivity.js');

test('official rule refresh preserves personal rules and replaces only successful source pages', () => {
  const old = [{id:'personal',text:'mine'}, {id:'old',source:'forum',url:'https://forum.pridekeeper.tech/threads/3/',text:'old'}, {id:'keep',source:'forum',url:'https://forum.pridekeeper.tech/threads/714/',text:'keep'}];
  const fresh = [{id:'new',source:'forum',url:'https://forum.pridekeeper.tech/threads/3/',text:'new'}];
  assert.deepEqual(api.mergeForumRules(old,fresh),[old[0],old[2],fresh[0]]);
});

test('numbered official text becomes searchable individual rules with source links', () => {
  const out = api.splitForumRules('Общие правила\n1.1 Запрещён спам.\nПродолжение пункта.\n1.2 Уважайте участников.', 'Правила форума', 'https://forum.pridekeeper.tech/threads/3/');
  assert.equal(out.length,2);
  assert.match(out[0].text,/Продолжение/);
  assert.equal(out[1].title,'1.2');
  assert.equal(out[0].source,'forum');
});

test('unnumbered rule pages are retained without invented clauses', () => {
  const out=api.splitForumRules('Описание правил без нумерации.', 'Общие правила', 'https://forum.pridekeeper.tech/rules/discord/');
  assert.equal(out.length,1); assert.equal(out[0].title,'Общие правила');
});

test('typing shortcuts expands only a completed suffix and preserves surrounding text', () => {
  const state={ replacements:[{from:'/ok',to:'Одобрено'}],tags:[{title:'привет',text:'Здравствуйте'}] };
  assert.equal(api.expandTypedSuffix('Текст /ok ',state),'Текст Одобрено ');
  assert.equal(api.expandTypedSuffix('/ok',state),'/ok');
  assert.equal(api.expandTypedSuffix('https://test/ok ',state),'https://test/ok ');
  assert.equal(api.expandTypedSuffix('{привет} ',state),'Здравствуйте ');
  assert.equal(api.expandTypedSuffix('/ok ',{ replacements:[{from:'/ok',to:'NO',enabled:false}] }),'/ok ');
});
