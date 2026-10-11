const assert=require('node:assert/strict');
const path=require('node:path');

module.exports=async function helperFlows(p,origin,output) {
  p.setDefaultTimeout(30000);
  await p.context().grantPermissions(['clipboard-read','clipboard-write'],{origin});
  await p.goto(origin+'/threads/9002/');
  await p.locator('[data-helper-toggle]').click();
  const route=async name=>{await p.locator(`.pkfa-side [data-route="${name}"]`).click();};
  const text=()=>p.locator('form[action="/threads/9002/add-reply"] textarea').inputValue();
  const clipboard=()=>p.evaluate(()=>navigator.clipboard.readText());
  await route('home');
  assert.equal(await p.locator('.pkfa-profile-card,.pkfa-clock').count(),0);
  assert.equal(await p.locator('.pkfa-side__item svg').count(),10);
  assert.equal(await p.locator('.pkfa-side__brand em').innerText(),'v5.0.5');assert.ok(await p.locator('.pkfa-side__brand em').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>0));
  await p.screenshot({path:path.join(output,'home.png')});

  await route('replace');
  await p.locator('[data-replacement-form] [name="from"]').fill('/qa');
  await p.locator('[data-replacement-form] [name="to"]').fill('QA Expanded');
  await p.locator('[data-replacement-form] button').click();
  await p.locator('[data-toggle-replacement]').waitFor();
  await route('tags');
  for(const title of ['QA_Tag_1','QA_Tag_2']) {
    await p.locator('[data-tag-form] [name="title"]').fill(title);
    await p.locator('[data-tag-form] [name="text"]').fill(title+' /qa');
    await p.locator('[data-tag-form] button').click();
    await p.locator('.pkfa-answer-card').filter({hasText:title}).waitFor();
  }
  const tag=p.locator('.pkfa-answer-card').filter({hasText:'QA_Tag_2'});
  await tag.locator('[data-direction="up"]').click();
  await p.waitForFunction(()=>[...document.querySelectorAll('[data-screen] .pkfa-answer-card')].filter(x=>/QA_Tag_[12]/.test(x.textContent))[0]?.textContent.includes('QA_Tag_2')); 
  await tag.locator('[data-direction="down"]').click();
  await tag.locator('[data-insert-tag]').click();assert.equal(await text(),'QA_Tag_2 QA Expanded');
  await p.locator('[data-helper-close]').click();
  const editor=p.locator('form[action="/threads/9002/add-reply"] textarea');
  await editor.fill('');await editor.pressSequentially('/qa ');assert.equal(await text(),'QA Expanded ');
  await editor.fill('');await editor.pressSequentially('{QA_Tag_1} ');assert.equal(await text(),'QA_Tag_1 /qa ');
  await p.locator('[data-pkfa-tag]').filter({hasText:'QA_Tag_1'}).click();assert.equal(await text(),'QA_Tag_1 QA Expanded');
  await p.locator('[data-helper-toggle]').click();
  await route('replace');await p.locator('[data-toggle-replacement]').click();
  await p.locator('[data-helper-close]').click();await editor.fill('');await editor.pressSequentially('/qa ');assert.equal(await text(),'/qa ');
  await p.locator('[data-helper-toggle]').click();await route('replace');await p.locator('[data-toggle-replacement]').click();

  await route('replies');await p.locator('[data-new-template]').click();await p.locator('[data-cancel-template]').click();
  await p.locator('[data-new-template]').click();
  await p.locator('[data-template-form] [name="title"]').fill('QA_Answer');
  await p.locator('[data-template-form] [name="text"]').fill('Hello {author} /qa');
  await p.locator('[data-template-form] button[type="submit"]').click();
  const answer=p.locator('.pkfa-answer-card').filter({hasText:'QA_Answer'});
  await answer.waitFor();
  assert.equal(await p.locator('[data-pkfa-template]').filter({hasText:'QA_Answer'}).count(),1);
  await answer.locator('[data-favorite-template]').click();
  await answer.locator('[data-edit-template]').click();
  await p.locator('[data-template-form] [name="text"]').fill('Hi {author} /qa');
  await p.locator('[data-template-form] button[type="submit"]').click();
  await p.locator('[data-template-filter]').fill('QA_Answer');
  await p.locator('[data-template-category]').selectOption('Мои шаблоны');
  await answer.locator('[data-preview-template]').click();
  await answer.locator('[data-copy-template]').click();assert.equal(await clipboard(),'Hi Test_Author QA Expanded');
  await answer.locator('[data-insert-template]').click();assert.equal(await text(),'Hi Test_Author QA Expanded');
  await answer.locator('[data-send-template]').click();
  await p.waitForFunction(()=>document.querySelector('form[action="/threads/9002/add-reply"]').dataset.sent==='true');
  await answer.locator('[data-remove-template]').click();
  await p.waitForFunction(()=>![...document.querySelectorAll('[data-pkfa-template]')].some(x=>x.textContent==='QA_Answer'));

  await route('rules');await p.locator('[data-rule-search]').nth(10).waitFor();
  const initialRules=await p.locator('[data-rule-search]').count();assert.ok(initialRules>10);
  await p.locator('[data-rule-filter]').fill('1.2. Незнание');
  const rule=p.locator('[data-rule-search]:not([hidden])');assert.equal(await rule.count(),1);
  await rule.locator('[data-copy-rule]').click();assert.match(await clipboard(),/Незнание правил/);
  await rule.locator('[data-insert-rule]').click();assert.match(await text(),/Незнание правил/);
  await p.locator('[data-rule-filter]').fill('');
  await p.locator('[data-rule-form] [name="title"]').fill('QA_Personal');
  await p.locator('[data-rule-form] [name="text"]').fill('My personal rule');
  await p.locator('[data-rule-form] button').click();
  await p.locator('[data-rule-search]').filter({hasText:'QA_Personal'}).waitFor();
  await p.locator('[data-load-forum-rules]').click();
  await p.locator('[data-load-forum-rules]').waitFor({state:'visible'});
  await p.waitForFunction(()=>!document.querySelector('[data-load-forum-rules]').disabled);
  assert.equal(await p.locator('[data-rule-search]').filter({hasText:'QA_Personal'}).count(),1);
  assert.equal(await p.locator('[data-rule-search]').count(),initialRules+1);
  await p.locator('[data-rule-search]').filter({hasText:'QA_Personal'}).locator('[data-remove-rule]').click();
  await p.screenshot({path:path.join(output,'rules.png')});

  await route('complaints');
  for(const status of ['resolved','denied','pending','senior-review','punishment-removed','punishment-reduced']) await p.locator(`[data-complaint-status="${status}"]`).click();
  await route('analytics');
  for(const range of ['today','7d','30d']) await p.locator(`[data-range="${range}"]`).click();
  await p.locator('[data-analytics-tab="sections"]').click();
  assert.equal(await p.locator('.pkfa-stat-grid').isVisible(),false);assert.match(await p.locator('.pkfa-report').innerText(),/Жалобы/);
  await p.locator('[data-analytics-tab="stats"]').click();assert.equal(await p.locator('.pkfa-stat-grid').isVisible(),true);
  await p.locator('[data-export-analytics]').click();const stats=JSON.parse(await clipboard());assert.equal(stats.total,6);assert.equal(stats.errors,0);
  await p.screenshot({path:path.join(output,'analytics.png')});
  await route('history');await p.locator('[data-history-query]').fill('9002');
  await p.locator('[data-history-action]').selectOption('complaint-status');await p.locator('[data-history-result]').selectOption('success');
  await p.locator('[data-export-history]').click();await p.waitForFunction(async()=>{try{return JSON.parse(await navigator.clipboard.readText()).length>=6;}catch{return false;}});assert.ok(JSON.parse(await clipboard()).length>=6);
  await p.locator('[data-clear-history]').click();assert.ok(await p.locator('.pkfa-history-v4 article').count());
  await p.locator('[data-clear-history]').click();await p.waitForFunction(()=>document.querySelectorAll('.pkfa-history-v4 article').length===0);assert.equal(await p.locator('.pkfa-history-v4 article').count(),0);

  await route('settings');
  await p.locator('[data-setting="appearance"]').click();assert.equal(await p.locator('.pkfa-appearance').getAttribute('tabindex'),'-1');
  await p.locator('[data-setting="navigation"]').click();assert.equal(await p.locator('.pkfa-ui-options').getAttribute('tabindex'),'-1');
  for(const accent of ['blue','purple','gold']) {await p.locator(`button[data-accent="${accent}"]`).click();await p.waitForFunction(accent=>document.querySelector('#pkfa-root')?.dataset.accent===accent,accent);}
  for(const scale of ['large','compact','normal']) {await p.locator('[data-ui-scale]').selectOption(scale);await p.waitForFunction(scale=>document.querySelector('#pkfa-root')?.dataset.scale===scale,scale);}
  for(const position of ['above','below']) {await p.locator('[data-inline-position]').selectOption(position);await p.waitForFunction(position=>document.querySelector('[data-inline-position]')?.value===position && document.querySelector('[data-toast]')?.textContent==='Настройка применена',position);}
  await p.locator('[data-export-settings]').click();await p.waitForFunction(async()=>{try{return !!JSON.parse(await navigator.clipboard.readText()).ui;}catch{return false;}});const exported=await clipboard();assert.ok(JSON.parse(exported).ui);
  p.once('dialog',dialog=>dialog.accept());
  await p.locator('[data-import-file]').setInputFiles({name:'test-settings.json',mimeType:'application/json',buffer:Buffer.from(exported)});
  await p.waitForFunction(()=>document.querySelector('[data-toast]').textContent.includes('Настройки импортированы'));
  await route('rules');await p.locator('[data-load-forum-rules]').click();await p.waitForFunction(()=>!document.querySelector('[data-load-forum-rules]').disabled);assert.equal(await p.locator('[data-rule-search]').count(),initialRules);await route('settings');
  await p.locator('[data-import-file]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
  await p.waitForFunction(()=>document.querySelector('[data-toast]').dataset.tone==='danger');
  await p.locator('[data-collapse]').first().click();await p.locator('[data-collapse]').first().click();
  await p.locator('[data-helper-close]').click();
  assert.equal(await p.locator('[data-helper-overlay]').getAttribute('aria-hidden'),'true');
  return {rules:initialRules,allHelperSections:true,typingReplacement:true,helperSendOnlyToLocalFixture:true};
};
