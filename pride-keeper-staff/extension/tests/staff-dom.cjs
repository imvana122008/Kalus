const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const sections = ['management', 'main-mod', 'curator', 'senior-mod', 'junior-mod'];
const card = '<div class="card"><div class="avatar-container"><img class="avatar"></div><div class="name">Original</div><div class="position"><strong>Модератор</strong></div><div class="links"><a href="https://forum.pridekeeper.tech/members/2/">Форум</a></div></div>';
const fixture = `<article class="message" id="js-post-4561"><div class="bbWrapper">${sections.map(id => `<section id="${id}"><h2>${id}</h2><div class="cards">${id === 'management' ? card : ''}</div></section>`).join('')}<section id="developers"><h2>Разработчики</h2>${card}</section></div><a href="/posts/4561/edit">Изменить</a></article><form action="/threads/1646/add-reply"><textarea name="message">DO NOT TOUCH</textarea><button type="submit">Ответить</button></form>`;
const flush = () => new Promise(resolve => setTimeout(resolve, 15));

test('official custom-element rules are parsed as inert text without executing page scripts', async () => {
  const env=await setup();
  try {
    env.w.eval(fs.readFileSync(path.join(root,'src/productivity.js'),'utf8'));
    const capture=fs.readFileSync(path.join(__dirname,'fixtures/forum-rules-3.html'),'utf8');
    const doc=new env.w.DOMParser().parseFromString(capture,'text/html');
    const text=env.w.PKFA.productivity.extractForumRuleText(doc);
    assert.match(text,/1\. Общее/); assert.match(text,/Ник-Неймы/);
    assert.equal(text.includes('connectedCallback'),false);
    assert.equal(text.includes('counter-reset'),false);
    const rules=env.w.PKFA.productivity.splitForumRules(text,'Правила форума','https://forum.pridekeeper.tech/threads/3/');
    assert.ok(rules.length > 10);
  } finally { env.dom.window.close(); }
});

test('typing replacement preserves textarea caret and rich editor markup', async () => {
  const env=await setup(); const w=env.w;
  try {
    for(const file of ['productivity.js','replies.js']) w.eval(fs.readFileSync(path.join(root,'src',file),'utf8'));
    const form=w.document.querySelector('form');
    const state={replacements:[{from:'/ok',to:'Одобрено'}],tags:[]};
    w.PKFA.replies.bindAutoReplace(form,()=>state);
    const input=form.querySelector('textarea');input.value='Hello /ok tail';input.setSelectionRange(10,10);input.dispatchEvent(new w.Event('input',{bubbles:true}));
    assert.equal(input.value,'Hello Одобрено tail');assert.equal(input.selectionStart,15);
    const rich=w.document.createElement('div');rich.className='fr-element';rich.setAttribute('contenteditable','true');rich.innerHTML='<b>Keep</b><span>/ok </span>';form.append(rich);
    w.getSelection().collapse(rich.querySelector('span').firstChild,4);
    rich.dispatchEvent(new w.Event('input',{bubbles:true}));
    assert.equal(rich.querySelector('b').textContent,'Keep');assert.equal(rich.querySelector('span').textContent,'Одобрено ');
  } finally { env.dom.window.close(); }
});

test('official loader only fetches same-origin rule topics and reports failed pages', async () => {
  const env=await setup(); const w=env.w;
  try {
    w.eval(fs.readFileSync(path.join(root,'src/productivity.js'),'utf8'));
    const seen=[];
    const fetcher=async url=>{seen.push(url);return {ok:true,url,text:async()=>url.endsWith('/forums/rules/')?'<div class="structItem-title"><a href="/threads/3/">Правила</a><a href="https://evil.test/threads/2/">Bad</a><a href="/members/3/">Member</a><a href="/threads/714/">Unavailable</a></div>':url.endsWith('/threads/3/')?'<article class="message"><div class="bbWrapper"><p>1.1 Не спамить.</p><p>1.2 Уважать участников.</p></div></article>':'<form>Login</form>'};};
    const out=await w.PKFA.productivity.loadForumRules({origin:'https://forum.pridekeeper.tech',fetcher});
    assert.equal(out.records.length,2);assert.equal(out.failed.length,1);assert.equal(out.pages,1);
    assert.equal(seen.length,3);assert.ok(seen.every(url=>url.startsWith('https://forum.pridekeeper.tech/')));
  } finally { env.dom.window.close(); }
});

test('deleting one of three existing duplicate cards preserves the other two after generation and reload', async () => {
  const env = await setup(fixture.replace(card, card.repeat(3)));
  try {
    const items = env.w.__staffTest.scanRoot(env.w.document).items;
    assert.equal(new Set(items.map(i => i.key)).size, 3);
    const state = await env.w.__staffTest.getState();
    state.overrides[items[1].key] = { hidden: true };
    const generated = await env.w.__staffTest.generateCode(state, '4561');
    const parsed = new JSDOM(generated.code).window.document;
    assert.equal(parsed.querySelectorAll('#management .card').length, 2);
    const remaining = env.w.__staffTest.scanRoot(parsed).items;
    assert.equal(remaining.length, 2);
    assert.ok(remaining.every(i => i.key !== items[1].key));
    assert.equal(env.w.__staffTest.mergeSnapshot({items:remaining,sections:[]},state).items.filter(i=>!i.hidden).length,2);
    assert.equal(parsed.querySelector('#developers').outerHTML, env.w.document.querySelector('#developers').outerHTML);
  } finally { env.dom.window.close(); }
});

test('editing an existing duplicate affects one card and new members never inherit its occurrence key', async () => {
  const env=await setup(fixture.replace(card,card.repeat(3)));
  try {
    env.shadow.querySelectorAll('.k-person')[1].querySelector('[data-do="edit"]').click();
    env.shadow.querySelector('[data-f="name"]').value='Changed_Only';
    env.shadow.querySelector('[data-save]').click();await flush();await flush();
    const state=await env.w.__staffTest.getState();
    state.added.push({id:'new',name:'New_Person',forumId:'55',section:'management',role:'Основатель'});
    const parsed=new JSDOM((await env.w.__staffTest.generateCode(state,'4561')).code).window.document;
    const items=env.w.__staffTest.scanRoot(parsed).items;
    assert.equal(items.filter(i=>i.name==='Original').length,2);
    assert.equal(items.filter(i=>i.name==='Changed_Only').length,1);
    assert.equal(items.filter(i=>i.name==='New_Person').length,1);
    assert.equal(new Set(items.map(i=>i.key)).size,4);
  } finally {env.dom.window.close();}
});

test('real forum banner class overrides stale inner text for founders and deputy', async () => {
  const real = card.replace('class="position"', 'class="userBanner--osnov"').replace('<strong>Модератор</strong>', '<em class="userBanner--gm1"><strong>Гл. модератор</strong></em>');
  const deputy = real.replace('Original', 'Deputy').replace('/members/2/', '/members/19/').replace('class="userBanner--osnov"', 'class="userBanner--zgm1"');
  const env = await setup(fixture.replace(card, real + deputy));
  try {
    const items = env.w.__staffTest.scanRoot(env.w.document).items;
    assert.equal(items[0].role, 'Основатель');
    assert.equal(items[1].role, 'Заместитель главного модератора');
    assert.match(env.shadow.querySelector('.k-role').textContent, /Основатель/);
  } finally { env.dom.window.close(); }
});

test('changing a founder role changes the painted banner and preserves unrelated markup', async () => {
  const env = await setup();
  try {
    const state = await env.w.__staffTest.getState();
    const original = env.w.__staffTest.scanRoot(env.w.document).items[0];
    state.overrides[original.key] = { role: 'Заместитель главного модератора' };
    const generated = await env.w.__staffTest.generateCode(state, '4561');
    const parsed = new JSDOM(generated.code).window.document;
    assert.ok(parsed.querySelector('#management .userBanner--zgm1'));
    assert.equal(parsed.querySelector('#management .userBanner--osnov'), null);
    assert.equal(parsed.querySelector('#management strong').textContent, 'Заместитель главного модератора');
    assert.equal(parsed.querySelector('#developers').outerHTML, env.w.document.querySelector('#developers').outerHTML);
  } finally { env.dom.window.close(); }
});

test('captured Edge post reads painted roles and new founder round-trips without demotion', async () => {
  const captured = fs.readFileSync(path.join(__dirname, 'fixtures/forum-post-1646.html'), 'utf8');
  const env = await setup(`<article class="message" id="js-post-4561">${captured}<a href="/posts/4561/edit">Изменить</a></article>`);
  try {
    const items = env.w.__staffTest.scanRoot(env.w.document).items;
    for (const name of ['Skay_Esquea', 'Sanchez_Perrault']) assert.equal(items.find(i => i.name === name).role, 'Основатель');
    assert.equal(items.find(i => i.name === 'Isya_Defender').role, 'Заместитель главного модератора');
    assert.equal(items.find(i => i.name === 'Alex_Covatto').role, 'Куратор модерации');
    const state = await env.w.__staffTest.getState();
    state.added.push({ id:'founder-test', name:'Founder_Test', forumId:'9010', forum:'https://forum.pridekeeper.tech/members/9010/', section:'management', role:'Основатель' });
    const generated = await env.w.__staffTest.generateCode(state, '4561');
    const parsed = new JSDOM(generated.code).window.document;
    const added = [...parsed.querySelectorAll('#management .card')].find(c => c.textContent.includes('Founder_Test'));
    assert.ok(added.querySelector('.userBanner--osnov'));
    assert.equal(added.querySelector('strong').textContent, 'Основатель');
    assert.equal(env.w.__staffTest.scanRoot(parsed).items.find(i=>i.name==='Founder_Test').role, 'Основатель');
  } finally { env.dom.window.close(); }
});

test('custom textual role removes inherited painted rank and survives generation', async () => {
  const env = await setup(fixture.replace('class="position"', 'class="userBanner--osnov"'));
  try {
    const state = await env.w.__staffTest.getState();
    state.overrides[env.w.__staffTest.scanRoot(env.w.document).items[0].key] = { role:'Советник проекта' };
    const parsed = new JSDOM((await env.w.__staffTest.generateCode(state, '4561')).code).window.document;
    assert.equal(parsed.querySelector('#management [class*="userBanner--"]'), null);
    assert.equal(env.w.__staffTest.scanRoot(parsed).items[0].role, 'Советник проекта');
  } finally { env.dom.window.close(); }
});

test('discard drops local edits without overwriting another tab saved member', async () => {
  const env = await setup();
  try {
    await env.w.__staffTest.setState(await env.w.__staffTest.getState());
    await env.w.PKFA.store.update(full => { full.staff.added.push({ id: 'external', name: 'External', forumId: '99', section: 'main-mod' }); full.staffByThread['1646'] = structuredClone(full.staff); });
    await env.w.PKFA.staff.discardChanges();
    assert.ok((await env.w.__staffTest.getState()).added.some(item => item.id === 'external'));
  } finally { env.dom.window.close(); }
});

test('changed profile frees its previous identity for a new generated card', async () => {
  const env = await setup();
  try {
    const state = await env.w.__staffTest.getState();
    const original = env.w.__staffTest.scanRoot(env.w.document).items[0];
    state.overrides[original.key] = { forumId: '88', forum: 'https://forum.pridekeeper.tech/members/88/', name: 'Changed' };
    state.added.push({ id: 'returned', forumId: '2', forum: 'https://forum.pridekeeper.tech/members/2/', name: 'Returned', section: 'main-mod' });
    const generated = await env.w.__staffTest.generateCode(state, '4561');
    assert.match(generated.code, /Returned/);
    assert.match(generated.code, /Changed/);
  } finally { env.dom.window.close(); }
});

async function setup(html = fixture, saved = {}, url = 'https://forum.pridekeeper.tech/threads/1646/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const memory = structuredClone(saved);
  w.CSS = { escape: v => v };
  w.Image = class { set src(_) { queueMicrotask(() => this.onload?.()); } };
  w.chrome = { runtime: { getURL: name => name, onMessage: { addListener() {} } }, storage: { local: {
    get: async keys => structuredClone(Object.fromEntries(keys.filter(k => k in memory).map(k => [k, memory[k]]))),
    set: async values => Object.assign(memory, structuredClone(values)),
    remove: async keys => keys.forEach(k => delete memory[k])
  } } };
  for (const file of ['store.js', 'context.js', 'staff-gate.js']) w.eval(fs.readFileSync(path.join(root, 'src', file), 'utf8'));
  await w.PKFA.store.update(state => { state.staff.autoPublish.enabled = false; });
  let source = fs.readFileSync(path.join(root, 'src/staff.js'), 'utf8');
  source = source.replace(/  applyLauncherSettings\(\);\r?\n\}\)\(\);/, '  window.__staffTest = { generateCode, refreshData, scanRoot, mergeSnapshot, updateAutoPublishStatus, getState, setState };\n  applyLauncherSettings();\n})();');
  w.eval(source);
  const host = w.document.querySelector('#kalus-staff-builder-host');
  const shadow = host.shadowRoot;
  w.dispatchEvent(new w.Event('PKFA_OPEN_STAFF'));
  await flush();
  shadow.querySelector('[data-go="staff"]').click();
  await flush();
  return { dom, w, memory, shadow };
}

test('save and close closes the real Helper after committing the member', async () => {
  const env = await setup(); const { w } = env;
  try {
    w.PKFA.asset = name => name;
    for (const file of ['history.js', 'complaints.js', 'preferences.js', 'replies.js', 'productivity.js', 'panel.js']) w.eval(fs.readFileSync(path.join(root, 'src', file), 'utf8'));
    await w.PKFA.panel.mount(w.document, { context: w.PKFA.context.inspectDocument(w.document, w.location), state: await w.PKFA.store.getState(), actionExecutor: {}, replyController: {} });
    const host = w.document.querySelector('#pkfa-root');
    host.querySelector('[data-helper-toggle]').click(); await flush();
    host.querySelector('.pkfa-side [data-route="staff"]').click(); await flush();
    env.shadow.querySelector('[data-do="edit"]').click();
    const name = env.shadow.querySelector('[data-f="name"]'); name.value = 'Committed'; name.dispatchEvent(new w.Event('input', { bubbles: true }));
    env.shadow.querySelector('[data-save-close]').click(); await flush(); await flush();
    assert.equal(host.querySelector('[data-helper-overlay]').getAttribute('aria-hidden'), 'true');
    assert.match((await w.__staffTest.generateCode(await w.__staffTest.getState(), '4561')).code, /Committed/);
  } finally { env.dom.window.close(); }
});

test('staff list renders without throwing and has a working code button', async () => {
  const { dom, shadow } = await setup();
  try { assert.equal(shadow.querySelectorAll('.k-section').length, 5); shadow.querySelector('[data-go-code]').click(); await flush(); assert.match(shadow.querySelector('[data-code]').value, /PARSEHTML/); }
  finally { dom.window.close(); }
});

test('exact main and deputy roles survive editing and PARSEHTML generation', async () => {
  const main = card.replace('Original', 'Shakes_Suicide').replace('Модератор', 'Главный модератор');
  const deputy = card.replace('Original', 'Issa_Defender').replace('Модератор', 'Заместитель главного модератора').replace('/members/2/', '/members/3/');
  const env = await setup(fixture.replace(card, '').replace('<section id="main-mod"><h2>main-mod</h2><div class="cards"></div>', `<section id="main-mod"><h2>main-mod</h2><div class="cards">${main}${deputy}</div>`));
  try {
    for (const [name, role] of [['Shakes_Suicide', 'Главный модератор'], ['Issa_Defender', 'Заместитель главного модератора']]) {
      const row = [...env.shadow.querySelectorAll('.k-person')].find(row => row.querySelector('.k-name').textContent === name);
      row.querySelector('[data-do="edit"]').click();
      assert.equal(env.shadow.querySelector('[data-f="role"]').value, role);
      env.shadow.querySelector('[data-save]').click(); await flush();
    }
    const generated = await env.w.__staffTest.generateCode(await env.w.__staffTest.getState(), '4561');
    const parsed = new JSDOM(generated.code).window.document;
    assert.equal(parsed.querySelectorAll('#main-mod .card strong')[0].textContent, 'Главный модератор');
    assert.equal(parsed.querySelectorAll('#main-mod .card strong')[1].textContent, 'Заместитель главного модератора');
  } finally { env.dom.window.close(); }
});

test('composition structure enables a new thread and isolates drafts, metadata and reload', async () => {
  const a = await setup(fixture, {}, 'https://forum.pridekeeper.tech/threads/new.9000/');
  let b;
  try {
    assert.equal(a.w.PKFA.context.inspectDocument(a.w.document, a.w.location).isStaffThread, true);
    const draft = await a.w.__staffTest.getState();
    draft.added.push({ id: 'one', section: 'main-mod', name: 'Thread_A', forumId: '42', role: 'Главный модератор' });
    draft.autoPublish.enabled = false; await a.w.__staffTest.setState(draft);
    await a.w.__staffTest.updateAutoPublishStatus('editing', { targetPostId: '4561' });
    b = await setup(fixture.replaceAll('4561', '7777'), a.memory, 'https://forum.pridekeeper.tech/threads/9001/');
    assert.equal((await b.w.__staffTest.getState()).added.length, 0);
    assert.equal((await b.w.__staffTest.getState()).autoPublish.targetPostId, '');
    const other = await b.w.__staffTest.getState(); other.autoPublish.enabled = false;
    other.added.push({ id: 'two', section: 'junior-mod', name: 'Thread_B', forumId: '43' }); await b.w.__staffTest.setState(other);
    const reload = await setup(fixture, b.memory, 'https://forum.pridekeeper.tech/threads/9000/');
    try { assert.equal((await reload.w.__staffTest.getState()).added[0].name, 'Thread_A'); } finally { reload.dom.window.close(); }
    const code = await b.w.__staffTest.generateCode(await b.w.__staffTest.getState(), '7777');
    assert.ok(code.code.includes('Thread_B')); assert.ok(!code.code.includes('Thread_A'));
  } finally { a.dom.window.close(); b?.dom.window.close(); }
});

test('unified composition workspace has no nested dialog or fixed inner window', async () => {
  const env = await setup();
  try {
    const container = env.w.document.createElement('div'); env.w.document.body.appendChild(container);
    env.w.PKFA.staff.mountWorkspace(container, { context: env.w.PKFA.context.inspectDocument(env.w.document, env.w.location), store: env.w.PKFA.store }); await flush();
    assert.equal(env.shadow.querySelectorAll('[role="dialog"], [aria-modal="true"]').length, 0);
    assert.equal(env.shadow.querySelector('[data-staff-navigation]').querySelectorAll('button').length, 4);
    assert.equal(env.shadow.querySelectorAll('.k-section').length, 5);
  } finally { env.dom.window.close(); }
});

test('avatar preview does not access a removed form after immediate save', async () => {
  const env = await setup(); const errors = [];
  env.w.addEventListener('error', event => { errors.push(event.message); event.preventDefault(); });
  try {
    env.shadow.querySelector('[data-add-sec="main-mod"]').click();
    env.shadow.querySelector('[data-f="name"]').value = 'Fast_Save';
    const profile = env.shadow.querySelector('[data-f="forum"]'); profile.value = '/members/2501/';
    profile.dispatchEvent(new env.w.Event('input', { bubbles: true }));
    env.shadow.querySelector('[data-save]').click();
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.deepEqual(errors, []);
  } finally { env.dom.window.close(); }
});

test('leaving async settings immediately cannot replace the newer screen', async () => {
  const env = await setup();
  try {
    env.shadow.querySelector('[data-act="back"]').click();
    env.shadow.querySelector('[data-go="settings"]').click();
    env.shadow.querySelector('[data-act="back"]').click();
    await flush();
    assert.equal(env.shadow.querySelectorAll('[data-go]').length, 4);
    assert.equal(env.shadow.querySelector('[data-save-settings]'), null);
  } finally { env.dom.window.close(); }
});

test('composition icons in a reply or generic icons do not enable first-post editing', () => {
  const context = require('../src/context.js');
  const gate = require('../src/staff-gate.js');
  for (const html of [`<article class="message" id="js-post-1"><div class="bbWrapper"><svg></svg><p>Обычная тема</p></div></article>${fixture}`, '<article class="message" id="js-post-1"><div class="bbWrapper"><svg></svg></div><a href="/posts/1/edit">Изменить</a></article>']) {
    const dom = new JSDOM(html);
    try {
      const found = context.inspectDocument(dom.window.document, { pathname: '/threads/9000/' });
      assert.equal(found.isStaffThread, false); assert.equal(gate.canPublish(found), false);
    } finally { dom.window.close(); }
  }
});

for (const section of sections) test(`DOM ${section}: add/save/display/HTML/reload/move/delete`, async () => {
  let env = await setup();
  try {
    const { w, shadow } = env;
    shadow.querySelector(`[data-add-sec="${section}"]`).click();
    shadow.querySelector('[data-f="name"]').value = 'New_Member';
    shadow.querySelector('[data-f="forum"]').value = 'https://forum.pridekeeper.tech/members/new.2501/';
    shadow.querySelector('[data-f="vk"]').value = 'https://vk.com/new';
    shadow.querySelector('[data-save]').click();
    await flush();
    assert.equal(shadow.querySelector(`[data-sec="${section}"] .k-person[data-kind="added"] .k-name`).textContent, 'New_Member');
    const state = (await w.PKFA.store.getState()).staff;
    let generated = await w.__staffTest.generateCode(state, '4561');
    assert.equal(generated.ok, true);
    const parsed = new JSDOM(generated.code.replace(/^\[PARSEHTML\]\n|\n\[\/PARSEHTML\]$/g, '')).window.document;
    const member = parsed.querySelector(`#${section} .cards .card:last-child`);
    assert.equal(member.querySelector('.name').textContent, 'New_Member');
    assert.match(member.querySelector('.avatar').getAttribute('src'), /\/2\/2501\.jpg$/);
    assert.equal(member.querySelector('a[href*="/members/"]').getAttribute('href'), 'https://forum.pridekeeper.tech/members/2501/');
    assert.equal(member.querySelector('a[href*="vk.com"]').getAttribute('href'), 'https://vk.com/new');
    assert.equal(parsed.querySelector('#developers').outerHTML, w.document.querySelector('#developers').outerHTML);
    assert.equal(w.document.querySelector('form textarea').value, 'DO NOT TOUCH');
    const saved = structuredClone(env.memory);
    env.dom.window.close();
    env = await setup(fixture, saved);
    assert.equal(env.shadow.querySelectorAll('.k-person[data-kind="added"]').length, 1);
    env.shadow.querySelector('.k-person[data-kind="added"] [data-do="edit"]').click();
    const destination = section === 'management' ? 'main-mod' : 'management';
    env.shadow.querySelector('[data-f="section"]').value = destination;
    env.shadow.querySelector('[data-save]').click();
    await flush();
    assert.equal(env.shadow.querySelector(`[data-sec="${destination}"] .k-person[data-kind="added"] .k-name`).textContent, 'New_Member');
    env.shadow.querySelector('.k-person[data-kind="added"] [data-do="remove"]').click();
    await flush();
    assert.equal((await env.w.PKFA.store.getState()).staff.added.length, 0);
    generated = await env.w.__staffTest.generateCode((await env.w.PKFA.store.getState()).staff, '4561');
    assert.equal(generated.code.includes('New_Member'), false);
  } finally { env.dom.window.close(); }
});

test('empty staff generates complete cards while developer HTML is unchanged', async () => {
  const env = await setup(fixture.replace(card, ''));
  try {
    const state = (await env.w.PKFA.store.getState()).staff;
    state.added = [{ id: 'empty', section: 'junior-mod', name: 'Empty_New', forumId: '2501', forum: 'https://forum.pridekeeper.tech/members/2501/' }];
    const generated = await env.w.__staffTest.generateCode(state, '4561');
    assert.match(generated.code, /Empty_New/);
    assert.match(generated.code, /members\/2501/);
    assert.equal(generated.code.split('Original').length - 1, 1);
  } finally { env.dom.window.close(); }
});

test('auto-publish status update cannot overwrite a concurrently saved member', async () => {
  const env = await setup();
  try {
    const status = env.w.__staffTest.updateAutoPublishStatus('waiting');
    await env.w.PKFA.store.update(state => { state.staff.added.push({ id: 'concurrent', name: 'Concurrent', section: 'management' }); });
    await status;
    assert.equal((await env.w.PKFA.store.getState()).staff.added.length, 1);
  } finally { env.dom.window.close(); }
});

for (const section of sections) test(`published ${section}: no duplicate after reload, then move and remove`, async () => {
  let env = await setup();
  try {
    await env.w.PKFA.store.update(state => { state.staff.added.push({ id: 'published', section, name: 'Published', forumId: '2501', forum: 'https://forum.pridekeeper.tech/members/2501/' }); });
    const generated = await env.w.__staffTest.generateCode((await env.w.PKFA.store.getState()).staff, '4561');
    const html = generated.code.replace(/^\[PARSEHTML\]\n|\n\[\/PARSEHTML\]$/g, '');
    const saved = structuredClone(env.memory);
    env.dom.window.close();
    env = await setup(`<article class="message" id="js-post-4561">${html}<a href="/posts/4561/edit">Изменить</a></article>`, saved);
    const people = [...env.shadow.querySelectorAll('.k-person')].filter(p => p.querySelector('.k-name').textContent === 'Published');
    assert.equal(people.length, 1);
    assert.equal(people[0].dataset.kind, 'existing');
    people[0].querySelector('[data-do="edit"]').click();
    const destination = section === 'management' ? 'main-mod' : 'management';
    env.shadow.querySelector('[data-f="section"]').value = destination;
    env.shadow.querySelector('[data-save]').click();
    await flush();
    let code = (await env.w.__staffTest.generateCode((await env.w.PKFA.store.getState()).staff, '4561')).code;
    const parsed = new JSDOM(code).window.document;
    assert.equal([...parsed.querySelectorAll(`#${destination} .name`)].some(n => n.textContent === 'Published'), true);
    const moved = [...env.shadow.querySelectorAll('.k-person')].find(p => p.querySelector('.k-name').textContent === 'Published');
    moved.querySelector('[data-do="remove"]').click();
    await flush();
    code = (await env.w.__staffTest.generateCode((await env.w.PKFA.store.getState()).staff, '4561')).code;
    assert.equal(code.includes('Published'), false);
  } finally { env.dom.window.close(); }
});

test('legacy ambiguous deletion cannot erase every duplicated forum card', async () => {
  const env = await setup(fixture.replace(card, card + card + card));
  try {
    const state = (await env.w.PKFA.store.getState()).staff;
    state.overrides['forum:/members/2/'] = { hidden: true };
    const code = (await env.w.__staffTest.generateCode(state, '4561')).code;
    const parsed = new JSDOM(code).window.document;
    assert.equal(parsed.querySelectorAll('#management .card').length, 3);
    assert.equal(parsed.querySelectorAll('#developers .card').length, 1);
  } finally { env.dom.window.close(); }
});

test('staff backup, invalid import, settings, search and code copy buttons preserve data', async () => {
  const env = await setup();
  const { w, shadow } = env;
  let copied = '';
  try {
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } } });
    const click = async selector => { const button = shadow.querySelector(selector); assert.ok(button, selector); button.click(); await flush(); };
    const search = shadow.querySelector('[data-search]'); search.value = 'Missing'; search.dispatchEvent(new w.Event('input', { bubbles: true })); await flush();
    assert.equal(shadow.querySelectorAll('.k-person').length, 0);
    await click('[data-act="back"]'); await click('[data-go="backup"]');
    await click('[data-export]'); const backup = copied; assert.equal(JSON.parse(backup).format, 'kalus-staff-v2');
    await click('[data-import-toggle]');
    const before = JSON.stringify((await w.PKFA.store.getState()).staff);
    shadow.querySelector('[data-import-text]').value = '{bad'; await click('[data-import]');
    assert.equal(JSON.stringify((await w.PKFA.store.getState()).staff), before);
    shadow.querySelector('[data-import-text]').value = backup; await click('[data-import]');
    await click('[data-act="back"]'); await click('[data-go="settings"]');
    for (const position of ['right-top', 'right-bottom', 'left-top', 'left-bottom']) await click(`[data-position] [data-v="${position}"]`);
    for (const size of ['small', 'standard', 'large']) await click(`[data-size] [data-v="${size}"]`);
    await click('[data-auto="on"]'); await click('[data-auto="off"]'); await click('[data-save-settings]');
    const state = (await w.PKFA.store.getState()).staff;
    assert.equal(state.ui.position, 'left-bottom'); assert.equal(state.ui.size, 'large'); assert.equal(state.autoPublish.enabled, false);
    await click('[data-act="back"]'); await click('[data-go="code"]'); await click('[data-copy]'); assert.match(copied, /PARSEHTML/);
    assert.equal(w.document.querySelector('form[action*="add-reply"] textarea').value, 'DO NOT TOUCH');
  } finally { env.dom.window.close(); }
});

test('Helper button flows: navigation, templates, tags, replacements, rules, history, analytics and settings', async () => {
  const env = await setup();
  const { w } = env;
  const copied = [];
  const replies = [];
  try {
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => copied.push(text) } });
    w.confirm = () => true;
    w.PKFA.version = '5.0.6';
    w.PKFA.asset = name => `assets/${name}`;
    for (const file of ['history.js', 'complaints.js', 'preferences.js', 'replies.js', 'productivity.js', 'panel.js']) w.eval(fs.readFileSync(path.join(root, 'src', file), 'utf8'));
    await w.PKFA.store.update(state => {
      state.templates.push({ id: 'custom:button', title: 'Custom', text: 'Body', category: 'Мои', custom: true });
      state.tags = [{ id: 'tag1', title: 'First', text: 'One' }, { id: 'tag2', title: 'Second', text: 'Two' }];
      state.replacements = [{ id: 'replace1', from: 'hi', to: 'hello', enabled: true }];
      state.rules = [{ id: 'rule1', title: 'Rule', text: 'Rule text' }];
      state.history = [{ action: 'test', title: 'Entry', threadId: '1646', ok: true, at: new Date().toISOString() }];
      state.ui.lastRoute = 'home';
    });
    const context = { ...w.PKFA.context.inspectDocument(w.document, w.location), isComplaint: true };
    const replyController = {
      insertTemplate: async template => { replies.push(template.text); return { status: 'inserted' }; },
      sendTemplate: async template => { replies.push(template.text); return { status: 'sent' }; },
      insert: async text => { replies.push(text); return { status: 'inserted' }; }
    };
    await w.PKFA.panel.mount(w.document, { context, state: await w.PKFA.store.getState(), actionExecutor: {}, replyController });
    const host = w.document.querySelector('#pkfa-root');
    const click = async selector => { const el = host.querySelector(selector); assert.ok(el, `Missing button: ${selector}`); el.click(); await flush(); };
    const route = async name => { await click(`[data-route="${name}"]`); assert.equal(host.querySelector(`[data-route="${name}"]`).getAttribute('aria-current'), 'page'); };
    await click('[data-helper-toggle]');
    assert.equal(host.querySelector('[data-helper-overlay]').getAttribute('aria-hidden'), 'false');
    await click('[data-collapse]');
    assert.equal((await w.PKFA.store.getState()).ui.sidebarCollapsed, true);
    await click('[data-collapse]');
    assert.equal((await w.PKFA.store.getState()).ui.sidebarCollapsed, false);
    for (const name of ['home', 'staff', 'replies', 'tags', 'replace', 'rules', 'complaints', 'analytics', 'history', 'settings']) await route(name);
    await route('replies');
    await click('[data-new-template]');
    assert.equal(host.querySelector('[data-template-form]').classList.contains('is-hidden'), false);
    await click('[data-cancel-template]');
    assert.equal(host.querySelector('[data-template-form]').classList.contains('is-hidden'), true);
    await click('[data-preview-template]');
    await click('[data-copy-template]');
    assert.ok(copied.length);
    await click('[data-insert-template]');
    await click('[data-send-template]');
    assert.equal(replies.length, 2);
    const favoriteId = host.querySelector('[data-favorite-template]').getAttribute('data-favorite-template');
    await click('[data-favorite-template]');
    assert.equal((await w.PKFA.store.getState()).templates.find(t => t.id === favoriteId).favorite, true);
    await click('[data-edit-template]');
    const templateForm = host.querySelector('[data-template-form]');
    templateForm.querySelector('[name="title"]').value = 'Updated template';
    templateForm.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await flush();
    assert.ok((await w.PKFA.store.getState()).templates.some(t => t.title === 'Updated template'));
    await click('[data-remove-template]');
    assert.equal((await w.PKFA.store.getState()).templates.length, 5);
    await route('tags');
    await click('[data-insert-tag]');
    assert.equal(replies.at(-1), 'One');
    await click('[data-move-tag="tag2"][data-direction="up"]');
    assert.equal((await w.PKFA.store.getState()).tags[0].id, 'tag2');
    await click('[data-remove-tag="tag1"]');
    assert.equal((await w.PKFA.store.getState()).tags.length, 1);
    await route('replace');
    await click('[data-toggle-replacement]');
    assert.equal((await w.PKFA.store.getState()).replacements[0].enabled, false);
    await click('[data-remove-replacement]');
    assert.equal((await w.PKFA.store.getState()).replacements.length, 0);
    await route('rules'); await click('[data-copy-rule]'); assert.match(copied.at(-1), /Rule text/);
    await click('[data-remove-rule]'); assert.equal((await w.PKFA.store.getState()).rules.length, 0);
    await route('complaints'); await click('[data-complaint-status]');
    assert.ok((await w.PKFA.store.getState()).history.some(h => h.action === 'complaint-status'));
    await route('analytics'); await click('[data-range="7d"]'); assert.equal((await w.PKFA.store.getState()).complaints.analyticsRange, '7d');
    await click('[data-export-analytics]'); assert.doesNotThrow(() => JSON.parse(copied.at(-1)));
    await route('history'); await click('[data-export-history]'); assert.doesNotThrow(() => JSON.parse(copied.at(-1)));
    await click('[data-clear-history]'); assert.ok((await w.PKFA.store.getState()).history.length);
    await click('[data-clear-history]'); assert.equal((await w.PKFA.store.getState()).history.length, 0);
    await route('settings'); await click('[data-export-settings]'); assert.doesNotThrow(() => JSON.parse(copied.at(-1)));
    await click('[data-accent="purple"]'); assert.equal((await w.PKFA.store.getState()).ui.accent, 'purple');
    const scale = host.querySelector('[data-ui-scale]'); scale.value = 'large'; scale.dispatchEvent(new w.Event('change', { bubbles: true })); await flush();
    assert.equal((await w.PKFA.store.getState()).ui.scale, 'large');
    const position = host.querySelector('[data-inline-position]'); position.value = 'above'; position.dispatchEvent(new w.Event('change', { bubbles: true })); await flush();
    assert.equal((await w.PKFA.store.getState()).ui.inlinePosition, 'above');
    await click('[data-helper-close]'); assert.equal(host.querySelector('[data-helper-overlay]').getAttribute('aria-hidden'), 'true');
    assert.equal(w.document.querySelector('form[action*="add-reply"] textarea').value, 'DO NOT TOUCH');
  } finally { env.dom.window.close(); }
});

test('Helper creation forms and settings import persist through their actual UI handlers', async () => {
  const env = await setup(); const { w } = env;
  try {
    w.PKFA.asset = name => name; w.confirm = () => true;
    for (const file of ['history.js', 'complaints.js', 'preferences.js', 'replies.js', 'productivity.js', 'panel.js']) w.eval(fs.readFileSync(path.join(root, 'src', file), 'utf8'));
    await w.PKFA.panel.mount(w.document, { context:w.PKFA.context.inspectDocument(w.document,w.location), state:await w.PKFA.store.getState(), actionExecutor:{}, replyController:{} });
    const host = w.document.querySelector('#pkfa-root');
    const route = async name => { host.querySelector(`.pkfa-side [data-route="${name}"]`).click(); await flush(); };
    const submit = async (selector, values) => {
      const form = host.querySelector(selector); assert.ok(form);
      for (const [name,value] of Object.entries(values)) form.querySelector(`[name="${name}"]`).value=value;
      form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await flush(); await flush();
    };
    await route('tags'); await submit('[data-tag-form]',{title:'Added tag',group:'QA',text:'Tag body'});
    assert.ok((await w.PKFA.store.getState()).tags.some(i=>i.title==='Added tag'));
    await route('replace'); await submit('[data-replacement-form]',{from:'qa-short',to:'QA expanded'});
    assert.ok((await w.PKFA.store.getState()).replacements.some(i=>i.from==='qa-short'));
    await route('rules'); await submit('[data-rule-form]',{title:'Added rule',category:'QA',text:'Rule body',url:'https://forum.pridekeeper.tech/help/'});
    assert.ok((await w.PKFA.store.getState()).rules.some(i=>i.title==='Added rule'));
    await route('settings');
    const input=host.querySelector('[data-import-file]');
    Object.defineProperty(input,'files',{value:[{text:async()=>JSON.stringify({version:5,ui:{accent:'blue'}})}]});
    input.dispatchEvent(new w.Event('change',{bubbles:true})); await flush(); await flush();
    assert.equal((await w.PKFA.store.getState()).ui.accent,'blue');
    assert.equal(w.document.querySelector('form[action*="add-reply"] textarea').value,'DO NOT TOUCH');
  } finally { env.dom.window.close(); }
});

test('editing a surviving duplicate keeps a deleted sibling hidden through publication and reload', async () => {
 let env=await setup(fixture.replace(card,card+card+card));
 try {
  env.shadow.querySelector('.k-person [data-do="remove"]').click(); await flush();
  const survivor=env.shadow.querySelector('.k-person:not(.off)');survivor.querySelector('[data-do="edit"]').click();
  env.shadow.querySelector('[data-f="vk"]').value='https://vk.com/survivor';
  env.shadow.querySelector('[data-save]').click(); await flush();
  const state=(await env.w.PKFA.store.getState()).staff;
  assert.equal(Object.values(state.overrides).filter(x=>x.hidden).length,1);
  const generated=await env.w.__staffTest.generateCode(state,'4561');
  const html=generated.code.replace(/^\[PARSEHTML\]\n|\n\[\/PARSEHTML\]$/g,'');
  const parsed=new JSDOM(html).window.document;assert.equal(parsed.querySelectorAll('#management .card').length,2);
  const saved=structuredClone(env.memory);env.dom.window.close();
  env=await setup('<article class="message" id="js-post-4561">'+html+'<a href="/posts/4561/edit">Изменить</a></article>',saved);
  assert.equal(env.shadow.querySelectorAll('.k-person').length,2);
 } finally {env.dom.window.close();}
});

test('real forum avatar before username does not swallow the thread author in replies or complaints', async () => {
 const html=fs.readFileSync(path.join(__dirname,'fixtures/forum-author-1646.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://forum.pridekeeper.tech/threads/1646/',runScripts:'outside-only'});const env={dom,w:dom.window};
 env.w.eval(fs.readFileSync(path.join(root,'src/context.js'),'utf8'));
 try {
  for(const file of ['replies.js','complaints.js']) env.w.eval(fs.readFileSync(path.join(root,'src',file),'utf8'));
  const variables=env.w.PKFA.replies.collectVariables(env.w.document,{threadId:'1646',title:'1234'});
  assert.equal(variables.author,'Ivan_Kalus');assert.equal(variables.author_url,'https://forum.pridekeeper.tech/members/63/');
  assert.equal(env.w.PKFA.complaints.buildCard(env.w.document).author,'Ivan_Kalus');
  assert.equal(variables.thread_url,'https://forum.pridekeeper.tech/threads/1646/');
 } finally {env.dom.window.close();}
});

test('thread author remains the starter on later pages and ignores usernames inside quoted content', () => {
 const cases=[
  {html:'<div class="p-description"><a class="username" href="/members/63/">Starter</a></div><article class="message" data-author="Reply_Author"><div class="message-name"><a>Reply_Author</a></div></article>',url:'https://forum.pridekeeper.tech/threads/1646/page-2',name:'Starter'},
  {html:'<article class="message"><div class="message-name"><a class="username">Actual_Name</a></div><div class="bbWrapper"><a class="username">Quoted_Name</a></div></article>',url:'https://forum.pridekeeper.tech/threads/1646/',name:'Actual_Name'},
  {html:'<article class="message"><div class="bbWrapper"><a class="username">Quoted_Name</a></div></article>',url:'https://forum.pridekeeper.tech/threads/1646/',name:''},
  {html:'<article class="message" data-author="Reply_Author"></article>',url:'https://forum.pridekeeper.tech/threads/1646/page-2',name:''},
  {html:'<div class="p-description"><a class="username" href="https://evil.test/members/63/">Starter</a></div>',url:'https://forum.pridekeeper.tech/threads/1646/',name:'Starter',profile:''}
 ];
 for(const item of cases){const dom=new JSDOM(item.html,{url:item.url,runScripts:'outside-only'});try{dom.window.eval(fs.readFileSync(path.join(root,'src/context.js'),'utf8'));const author=dom.window.PKFA.context.collectThreadAuthor(dom.window.document);assert.equal(author.name,item.name);if('profile' in item)assert.equal(author.url,item.profile);}finally{dom.window.close();}}
});

test('reply panel shows resolved author and variable chips insert at the template cursor without sending', async () => {
 const env=await setup('<div class="p-description"><a class="username" href="/members/63/">Ivan_Kalus</a></div>'+fixture);
 try {
  const w=env.w;w.PKFA.asset=name=>name;
  for(const file of ['history.js','complaints.js','preferences.js','replies.js','productivity.js','panel.js'])w.eval(fs.readFileSync(path.join(root,'src',file),'utf8'));
  let writes=[];Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>writes.push(text)}});
  const ctx=w.PKFA.context.inspectDocument(w.document,w.location);await w.PKFA.panel.mount(w.document,{context:ctx,state:await w.PKFA.store.getState(),replyController:{},actionExecutor:{}});
  const host=w.document.querySelector('#pkfa-root');host.querySelector('.pkfa-side [data-route="replies"]').click();await flush();
  assert.match(host.querySelector('[data-reply-context]').textContent,/Ivan_Kalus/);
  assert.equal(host.querySelector('.pkfa-answer-card p').textContent.includes('{author}'),false);
  host.querySelector('[data-copy-thread-link]').click();await flush();assert.equal(writes.at(-1),'https://forum.pridekeeper.tech/threads/1646/');
  host.querySelector('[data-new-template]').click();await flush();const input=host.querySelector('[data-template-form] [name="text"]');
  input.value='Начало конец';input.setSelectionRange(7,7);host.querySelector('[data-template-variable="author"]').click();await flush();
  assert.equal(input.value,'Начало {author}конец');assert.equal(input.selectionStart,15);
  assert.equal(w.document.querySelector('textarea[name="message"]').value,'DO NOT TOUCH');
 }finally{env.dom.window.close();}
});
