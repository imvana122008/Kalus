const test = require('node:test');
const assert = require('node:assert/strict');

let replies = {};
try { require('../src/productivity.js'); } catch (_) {}
try { replies = require('../src/replies.js'); } catch (_) {}

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
