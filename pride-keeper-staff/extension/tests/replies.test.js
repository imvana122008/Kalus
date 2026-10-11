const test = require('node:test');
const assert = require('node:assert/strict');

let replies = {};
try { require('../src/productivity.js'); } catch (_) {}
try { replies = require('../src/replies.js'); } catch (_) {}

test('quick send and insertion expand shortcuts before variables without a second replacement pass', async () => {
  const values=[];
  const controller=new replies.ReplyController({setText:async text=>values.push(text),submit:async()=>{},onHistory:async()=>{}});
  const options={applyReplacements:true,rules:[{from:'/hello',to:'Здравствуйте, {author}'}]};
  await controller.insertTemplate({text:'/hello'}, {author:'Player'}, options);
  await controller.sendTemplate({text:'/hello'}, {author:'Player'}, options);
  assert.deepEqual(values,['Здравствуйте, Player','Здравствуйте, Player']);
  const blocked=await controller.sendTemplate({text:'/hello'}, {}, options);
  assert.equal(blocked.status,'unknown-variables');assert.equal(values.length,2);
});

test('template variables support Russian tag names and names with spaces', () => {
  assert.equal(replies.renderTemplate('{Привет всем}',{'Привет всем':'Здравствуйте'}).text,'Здравствуйте');
});

test('renders known variables and reports unknown placeholders', () => {
  const output = replies.renderTemplate?.('Здравствуйте, {author}. {unknown}', { author: 'Player' });
  assert.equal(output?.text, 'Здравствуйте, Player. {unknown}');
  assert.deepEqual(output?.unknown, ['unknown']);
});

test('insert fills the editor without submitting', async () => {
  let text = '';
  let submits = 0;
  const controller = replies.ReplyController ? new replies.ReplyController({
    setText: async (value) => { text = value; },
    submit: async () => { submits += 1; }
  }) : { insert: async () => ({}) };
  const result = await controller.insert('Черновик');
  assert.equal(result.status, 'inserted');
  assert.equal(text, 'Черновик');
  assert.equal(submits, 0);
});

test('instant send submits exactly once and blocks a concurrent duplicate', async () => {
  let resolve;
  let submits = 0;
  const pending = new Promise((done) => { resolve = done; });
  const controller = replies.ReplyController ? new replies.ReplyController({
    setText: async () => {},
    submit: async () => { submits += 1; await pending; }
  }) : { send: async () => ({}) };
  const first = controller.send('Ответ');
  const second = await controller.send('Ответ');
  assert.equal(second.status, 'blocked');
  assert.equal(submits, 1);
  resolve();
  assert.equal((await first).status, 'sent');
});

test('instant send refuses unknown variables and empty answers', async () => {
  const controller = replies.ReplyController ? new replies.ReplyController({ setText: async () => {}, submit: async () => {} }) : { sendTemplate: async () => ({}) };
  assert.equal((await controller.sendTemplate?.({ text: 'Hi {missing}' }, {}))?.status, 'unknown-variables');
  assert.equal((await controller.send?.('   '))?.status, 'empty');
});

test('applies replacements only when user-triggered insert opts in', async () => {
  const writes = [];
  const controller = new replies.ReplyController({ setText: async (text) => writes.push(text) });
  const rules = [{ from: '/привет', to: 'Здравствуйте', enabled: true }];

  await controller.insert('/привет', { applyReplacements: true, rules });
  await controller.insert('/привет', { rules });

  assert.deepEqual(writes, ['Здравствуйте', '/привет']);
});

test('quick toolbar variables include user tags while reserved author values cannot be overwritten', () => {
 const context=require('../src/context.js');
 const original=context.collectThreadAuthor;context.collectThreadAuthor=()=>({name:'Actual_Author',url:'https://forum.pridekeeper.tech/members/63/'});
 try {const vars=replies.collectVariables({querySelector:()=>null,location:{origin:'https://forum.pridekeeper.tech'}},{threadId:'1646'},[{title:'Метка',text:'Верно'},{title:'author',text:'Wrong'}]);assert.equal(vars.author,'Actual_Author');assert.equal(replies.renderTemplate('{автор}: {Метка}',vars).text,'Actual_Author: Верно');}finally{context.collectThreadAuthor=original;}
});

test('reply and complaint APIs load their context dependency in a fresh CommonJS process', () => {
 const child=require('node:child_process');const path=require('node:path');
 const script="const r=require('./src/replies.js');const c=require('./src/complaints.js');const d={querySelector:()=>null,location:{origin:'https://forum.pridekeeper.tech',href:'https://forum.pridekeeper.tech/threads/57/',pathname:'/threads/57/'}};console.log(JSON.stringify({variables:r.collectVariables(d,{threadId:'57'}),card:c.buildCard(d,{threadId:'57'})}));";
 const result=JSON.parse(child.execFileSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),encoding:'utf8'}));assert.equal(result.variables.author,'');assert.equal(result.variables.thread_url,'https://forum.pridekeeper.tech/threads/57/');assert.equal(result.card.author,'');
});
