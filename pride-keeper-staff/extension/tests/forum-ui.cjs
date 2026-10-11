// Offline forum simulation. The card markup was observed in thread 1646;
// names, profile IDs, surrounding page and server are test fixtures.
// No request to the real forum and no user browser/profile are used.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const capturedCard = fs.readFileSync(path.join(__dirname, 'fixtures/forum-card-1646.html'), 'utf8');
const sections = [['management', 'Руководство'], ['main-mod', 'Главная модерация'], ['curator', 'Кураторы модерации'], ['senior-mod', 'Старшие модераторы'], ['junior-mod', 'Модераторы']];
const fixtureCard = (name, id, role) => capturedCard.replaceAll('Skay_Esquea', name).replaceAll('/members/2/', `/members/${id}/`).replaceAll('/0/2.jpg', `/0/${id}.jpg`).replace('Гл. модератор', role).replace('userBanner--osnov', role === 'Разработчик' ? 'position' : 'userBanner--gm1');
const developer = '<section id="developers"><h2>Разработчики</h2><div class="cards">' + fixtureCard('Developer_Protected', '9', 'Разработчик') + '</div></section>';
const initial = '<div class="bbWrapper">' + sections.map(([id, title]) => `<section id="${id}"><h2>${title}</h2><div class="cards">${id === 'main-mod' ? fixtureCard('Shakes_Suicide', '2', 'Главный модератор') + fixtureCard('Issa_Defender', '3', 'Главный модератор') : ''}</div></section>`).join('') + developer + '</div>';
const posts = { '9000': initial, '9001': initial };
const postIds = { '9000': '4561', '9001': '7777' };
let storage = {}, savedPosts = 0, replies = 0;
const scripts = manifest.content_scripts[0].js.map(file => `<script src="/extension/${file}"></script>`).join('');
const mock = `<script>window.chrome={runtime:{id:'offline-test',getURL:name=>'/extension/'+name,onMessage:{addListener(){}}},storage:{local:{get:async keys=>fetch('/storage').then(r=>r.json()).then(raw=>Object.fromEntries(keys.filter(k=>k in raw).map(k=>[k,raw[k]]))),set:async values=>fetch('/storage',{method:'POST',body:JSON.stringify(values)}),remove:async keys=>fetch('/storage',{method:'DELETE',body:JSON.stringify(keys)})}}};</script>`;
const page = body => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Стенд форума Pride Keeper</title><style>body{margin:0;background:#15191f;color:#e7ebf0;font:14px Segoe UI,Arial}header{padding:20px;background:#202630}main{max-width:1100px;margin:24px auto;padding:20px}section{margin:16px 0}.cards{display:flex;gap:12px;flex-wrap:wrap}.card{background:#232b36;border-radius:12px;padding:16px;text-align:center;width:160px}.avatar{width:64px;height:64px;border-radius:50%}.name{margin:8px}.links{display:flex;justify-content:center;gap:12px;margin-top:12px}.userBanner--osnov{font-size:12px}textarea{width:90%;height:180px}button{cursor:pointer}a{color:#a991ff}</style><link rel="stylesheet" href="/extension/src/panel.css"></head><body>${body}${mock}${scripts}</body></html>`;
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/storage') {
    if (req.method === 'POST') Object.assign(storage, JSON.parse(body));
    if (req.method === 'DELETE') JSON.parse(body).forEach(key => delete storage[key]);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(storage)); return;
  }
  if (pathname.startsWith('/extension/')) {
    const relative = pathname.slice(11); const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const type = relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.woff2') ? 'font/woff2' : 'image/png';
    res.setHeader('Content-Type', type); res.end(fs.readFileSync(file)); return;
  }
  if (pathname.startsWith('/data/avatars/')) { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="50" fill="#7361ae"/><text x="50" y="63" text-anchor="middle" fill="white" font-size="35">PK</text></svg>'); return; }
  const thread = pathname.match(/^\/threads\/(900[01])\/$/)?.[1];
  if (thread) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(page(`<header>PRIDE KEEPER · локальный стенд</header><main><h1>Состав · тема ${thread}</h1><article class="message" id="js-post-${postIds[thread]}">${posts[thread]}<a href="/posts/${postIds[thread]}/edit">Изменить</a></article><form action="/threads/${thread}/add-reply" method="post"><textarea name="message">DO NOT TOUCH</textarea><button type="submit">Ответить</button></form></main>`)); return;
  }
  const edit = pathname.match(/^\/posts\/(4561|7777)\/edit$/)?.[1];
  if (edit) {
    const id = edit === '4561' ? '9000' : '9001';
    if (req.method === 'POST') { const code = new URLSearchParams(body).get('message'); assert.match(code, /^\[PARSEHTML\]/); posts[id] = code.replace(/^\[PARSEHTML\]\s*|\s*\[\/PARSEHTML\]$/g, ''); savedPosts++; res.writeHead(303, { Location: `/threads/${id}/` }); res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(page(`<main><h1>Редактировать существующий пост ${edit}</h1><form action="/posts/${edit}/edit" method="post"><button type="button" data-cmd="xfBbCode" onclick="this.classList.toggle('fr-active');document.querySelector('textarea').style.display='block'">BBCode</button><textarea name="message" style="display:none"></textarea><button type="submit">Сохранить</button></form></main>`)); return;
  }
  if (pathname.endsWith('/add-reply')) { replies++; res.writeHead(500); res.end('Reply forbidden'); return; }
  res.writeHead(404); res.end();
});

(async () => {
  const output = path.resolve(process.env.PKFA_QA_OUTPUT || path.join(__dirname, '../../../../../../../outputs/forum-ui'));
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PKFA_CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const p = await context.newPage(); const errors = []; p.on('pageerror', error => errors.push(error.message));
  const open = async id => { await p.goto(`${origin}/threads/${id}/`); await p.locator('[data-helper-toggle]').click(); await p.locator('.pkfa-side [data-route="staff"]').click(); await p.locator('[data-staff-navigation]').waitFor(); };
  try {
    await open('9000');
    const usableWidth = await p.locator('#kalus-staff-builder-host').evaluate(host => host.getBoundingClientRect().width / host.closest('.pkfa-main').getBoundingClientRect().width);
    assert.ok(usableWidth > 0.9, `Composition uses only ${Math.round(usableWidth * 100)}% of the panel`);
    assert.equal(await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(font => font.family === 'Inter' && font.status === 'loaded'); }), true, 'The bundled Inter font must load');
    assert.equal(await p.locator('[role="dialog"]').count(), 1, 'Only the Helper dialog may remain');
    assert.equal(await p.locator('#kalus-staff-builder-host .k-window').count(), 0);
    const row = name => p.locator('.k-person').filter({ has: p.locator('.k-name', { hasText: name }) });
    await row('Issa_Defender').locator('[data-do="edit"]').click();
    await p.locator('.k-select').filter({ has: p.locator('[data-f="role"]') }).locator('.k-select__button').click();
    await p.locator('[data-k-option="Заместитель главного модератора"]').click();
    await p.locator('[data-save]').click();
    await p.waitForURL(`${origin}/threads/9000/`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('#main-mod .card:last-child strong')?.textContent === 'Заместитель главного модератора');
    assert.equal(savedPosts, 1); assert.equal(replies, 0);
    assert.equal(await p.locator('#main-mod .card:last-child > .userBanner--zgm1').count(), 1, 'Deputy must receive the painted deputy badge');
    assert.equal(await p.locator('#main-mod .card:last-child .username--style5').count(), 1, 'Deputy name style must agree with the badge');
    assert.equal(await p.locator('#main-mod .card:last-child em.userBanner--gm1').count(), 0, 'Stale nested main badge must be removed');
    await open('9000');
    await p.locator('[data-add-sec="main-mod"]').first().click(); await p.locator('[data-f="name"]').fill('Added_Member');
    await p.locator('[data-f="forum"]').fill('https://forum.pridekeeper.tech/members/new.2501/'); await p.locator('[data-f="vk"]').fill('https://vk.com/test_profile');
    await p.locator('[data-save]').click();
    await p.waitForFunction(() => !!document.querySelector('#main-mod .cards a[href$="/members/2501/"]'));
    assert.equal(savedPosts, 2); assert.equal(replies, 0);
    assert.ok(posts['9000'].includes(developer)); assert.ok(!posts['9001'].includes('Added_Member'));
    assert.equal(await p.locator('#main-mod .cards .card').count(), 3);
    await open('9000');
    for (const [width, height] of [[1440, 1000], [768, 1000], [360, 900]]) {
      await p.setViewportSize({ width, height });
      await p.screenshot({ path: path.join(output, `staff-${width}.png`) });
      const layout = await p.locator('#kalus-staff-builder-host').evaluate(host => {
        const shadow = host.shadowRoot; const body = shadow.querySelector('.k-body'); const inner = shadow.querySelector('.k-workspace');
        return { horizontalOverflow: host.scrollWidth > host.clientWidth + 1, bodyOverflow: getComputedStyle(body).overflowY, innerBorder: getComputedStyle(inner).borderTopWidth, font: getComputedStyle(shadow.querySelector('.k-name')).fontSize };
      });
      assert.equal(layout.horizontalOverflow, false, `Overflow at ${width}`); assert.equal(layout.bodyOverflow, 'visible'); assert.equal(layout.innerBorder, '0px'); assert.equal(layout.font, '13px');
    }
    await p.setViewportSize({ width: 1440, height: 1000 });
    await p.locator('[data-workspace-screen="code"]').click();
    await p.waitForFunction(() => document.querySelector('#kalus-staff-builder-host')?.shadowRoot.querySelector('[data-code]')?.value.includes('Added_Member'));
    const code = await p.locator('[data-code]').inputValue(); assert.match(code, /Added_Member/); assert.match(code, /Заместитель главного модератора/);
    await p.screenshot({ path: path.join(output, 'generated-code.png'), fullPage: true });
    await open('9001'); assert.equal(await row('Added_Member').count(), 0);
    await open('9000'); assert.equal(await row('Added_Member').count(), 1);
    await row('Added_Member').locator('[data-do="remove"]').click();
    await p.waitForFunction(() => location.pathname === '/threads/9000/' && !document.querySelector('#main-mod .cards a[href$="/members/2501/"]'));
    assert.equal(savedPosts, 3); assert.equal(replies, 0); assert.ok(posts['9000'].includes(developer));
    for (const [index, [section]] of sections.entries()) {
      await open('9000');
      await p.locator(`[data-add-sec="${section}"]`).first().click();
      await p.locator('[data-f="name"]').fill(`Section_Member_${index}`);
      await p.locator('[data-f="forum"]').fill(`/members/${3000 + index}/`);
      await p.locator('[data-save]').click();
      await p.waitForFunction(({ section, name }) => location.pathname === '/threads/9000/' && document.querySelector(`#${section}`)?.textContent.includes(name), { section, name: `Section_Member_${index}` });
      await open('9000');
      assert.equal(await row(`Section_Member_${index}`).count(), 1);
      await row(`Section_Member_${index}`).locator('[data-do="remove"]').click();
      await p.waitForFunction(name => location.pathname === '/threads/9000/' && !document.querySelector('article.message')?.textContent.includes(name), `Section_Member_${index}`);
      assert.ok(posts['9000'].includes(developer));
    }
    assert.equal(savedPosts, 13); assert.equal(replies, 0);
    const second = await context.newPage(); await second.goto(`${origin}/threads/9001/`);
    await Promise.all([p, second].map((tab, tabIndex) => tab.evaluate(async tabIndex => {
      for (let index = 0; index < 5; index++) await PKFA.store.update(state => { state.tags.push({ id: `parallel-${tabIndex}-${index}`, text: 'parallel' }); });
    }, tabIndex)));
    assert.equal(storage.pkfaStateV5.tags.filter(tag => tag.id.startsWith('parallel-')).length, 10, 'Concurrent tabs must not lose updates');
    await second.close();
    await open('9000'); await p.locator('[data-workspace-screen="settings"]').click();
    await p.locator('[data-auto="off"]').click(); await p.locator('[data-save-settings]').click();
    await p.locator('[data-workspace-screen="staff"]').click(); await row('Issa_Defender').locator('[data-do="edit"]').click();
    await p.locator('[data-f="vk"]').fill('https://vk.com/deputy_test');
    await p.screenshot({ path: path.join(output, 'member-editor.png') });
    await p.setViewportSize({ width: 360, height: 900 });
    assert.equal(await p.locator('.k-form').evaluate(form => form.scrollWidth > form.clientWidth + 1), false, 'Mobile member form must fit');
    await p.screenshot({ path: path.join(output, 'member-editor-360.png') }); await p.setViewportSize({ width: 1440, height: 1000 });
    await p.locator('[data-save]').click(); await p.locator('[data-workspace-screen="code"]').click();
    await p.locator('[data-code]').filter({ visible: true }).waitFor();
    await p.locator('[data-publish]').click();
    await p.waitForFunction(() => location.pathname === '/threads/9000/' && !!document.querySelector('#main-mod .card a[href="https://vk.com/deputy_test"]'));
    assert.equal(savedPosts, 14); assert.equal(replies, 0); assert.ok(posts['9000'].includes(developer));
    await open('9000');
    const sameThread = await context.newPage(); sameThread.on('pageerror', error => errors.push(error.message));
    await sameThread.goto(`${origin}/threads/9000/`); await sameThread.locator('[data-helper-toggle]').click(); await sameThread.locator('.pkfa-side [data-route="staff"]').click();
    for (const [index, tab] of [p, sameThread].entries()) {
      await tab.locator('[data-add-sec="main-mod"]').first().click();
      await tab.locator('[data-f="name"]').fill(`Parallel_Member_${index}`);
      await tab.locator('[data-f="forum"]').fill(`/members/${7000 + index}/`);
    }
    await Promise.all([p, sameThread].map(tab => tab.locator('[data-save]').click()));
    await Promise.all([p, sameThread].map(tab => tab.locator('.k-form').waitFor({ state: 'detached', timeout: 60000 })));
    await p.waitForFunction(async () => (await PKFA.store.getState()).staffByThread['9000'].added.filter(item => item.name.startsWith('Parallel_Member_')).length === 2);
    await open('9000'); await row('Parallel_Member_').nth(1).waitFor(); assert.equal(await row('Parallel_Member_').count(), 2);
    await sameThread.close();
    assert.equal(errors.length, 0, errors.join('\n'));
    const report = { passed: true, savedExistingPosts: savedPosts, newReplies: replies, allFiveSections: true, threadIsolation: true, concurrentTabs: true, concurrentStaffAdditions: true, manualPublicationWithAutoOff: true, roles: true, profileAndVkLinks: true, developerPreserved: true, viewportWidths: [1440, 768, 360], pageErrors: errors, source: 'captured forum card + synthetic offline page; no live publication' };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } catch (error) {
    console.log(JSON.stringify({ url: p.url(), savedPosts, replies, errors, staff: storage.pkfaStateV5?.staffByThread, jobs: Object.keys(storage).filter(key => key.startsWith('prideKeeperStaffPublishJob')), postNames: posts['9000'].match(/class="[^\"]*name"[^>]*>([^<]+)/g) }));
    await p.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    throw error;
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
