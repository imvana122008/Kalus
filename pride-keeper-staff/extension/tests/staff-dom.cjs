const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const sections = ['management', 'main-mod', 'curator', 'senior-mod', 'junior-mod'];
const card = '<div class="card"><div class="avatar-container"><img class="avatar"></div><div class="name">Original</div><div class="userBanner--osnov"><strong>Модератор</strong></div><div class="links"><a href="https://forum.pridekeeper.tech/members/2/">Форум</a></div></div>';
const fixture = `<article class="message" id="js-post-4561"><div class="bbWrapper">${sections.map(id => `<section id="${id}"><h2>${id}</h2><div class="cards">${id === 'management' ? card : ''}</div></section>`).join('')}<section id="developers"><h2>Разработчики</h2>${card}</section></div><a href="/posts/4561/edit">Изменить</a></article><form action="/threads/1646/add-reply"><textarea name="message">DO NOT TOUCH</textarea><button type="submit">Ответить</button></form>`;
const flush = () => new Promise(resolve => setTimeout(resolve, 15));

async function setup(html = fixture, saved = {}) {
  const dom = new JSDOM(html, { url: 'https://forum.pridekeeper.tech/threads/1646/', runScripts: 'outside-only' });
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
  source = source.replace('  applyLauncherSettings();\n})();', '  window.__staffTest = { generateCode, refreshData, scanRoot, mergeSnapshot, updateAutoPublishStatus };\n  applyLauncherSettings();\n})();');
  w.eval(source);
  const host = w.document.querySelector('#kalus-staff-builder-host');
  const shadow = host.shadowRoot;
  w.dispatchEvent(new w.Event('PKFA_OPEN_STAFF'));
  await flush();
  shadow.querySelector('[data-go="staff"]').click();
  await flush();
  return { dom, w, memory, shadow };
}

test('staff list renders without throwing and has a working code button', async () => {
  const { dom, shadow } = await setup();
  try { assert.equal(shadow.querySelectorAll('.k-section').length, 5); shadow.querySelector('[data-go-code]').click(); await flush(); assert.match(shadow.querySelector('[data-code]').value, /PARSEHTML/); }
  finally { dom.window.close(); }
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

test('removing a duplicated forum member removes every copy from generated HTML', async () => {
  const env = await setup(fixture.replace(card, card + card + card));
  try {
    const state = (await env.w.PKFA.store.getState()).staff;
    state.overrides['forum:/members/2/'] = { hidden: true };
    const code = (await env.w.__staffTest.generateCode(state, '4561')).code;
    const parsed = new JSDOM(code).window.document;
    assert.equal(parsed.querySelectorAll('#management .card').length, 0);
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
    w.PKFA.version = '5.0.1';
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
