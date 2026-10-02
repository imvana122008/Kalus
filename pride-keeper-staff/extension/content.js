(() => {
  if (window.__PRIDE_KEEPER_STAFF_GH__) return;
  window.__PRIDE_KEEPER_STAFF_GH__ = true;

  const CONFIG = {
    version: '2.6.0',
    storageKey: 'prideKeeperStaffState',
    codeCacheKey: 'prideKeeperStaffGeneratedCode',
    publishJobKey: 'prideKeeperStaffPublishJob',
    sections: [
      { id: 'management', title: 'Руководство', color: '#ff5365' },
      { id: 'main-mod', title: 'Главная модерация', color: '#4ed35d' },
      { id: 'curator', title: 'Кураторы модерации', color: '#9173ff' },
      { id: 'senior-mod', title: 'Старшие модераторы', color: '#f0ca2f' },
      { id: 'junior-mod', title: 'Модераторы', color: '#42c4ff' }
    ],
    roles: ['Руководство', 'Главная модерация', 'Кураторы модерации', 'Старшие модераторы', 'Модераторы'],
    avatarSizes: ['o', 'l', 'h', 'm', 's'],
    autoPublishDebounceMs: 900
  };

  const asset = name => chrome.runtime.getURL(`assets/${name}`);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sectionIds = CONFIG.sections.map(x => x.id);

  function defaultState() {
    return {
      overrides: {},
      added: [],
      ui: { position: 'right-bottom', size: 'standard' },
      autoPublish: { enabled: true, targetPostId: '', lastStatus: 'idle', lastSavedAt: 0 }
    };
  }

  async function getState() {
    const data = await chrome.storage.local.get([CONFIG.storageKey]);
    const state = data[CONFIG.storageKey] || defaultState();
    state.overrides ||= {};
    state.added ||= [];
    state.ui ||= defaultState().ui;
    state.autoPublish ||= defaultState().autoPublish;
    return state;
  }

  async function saveState(state, { publish = true } = {}) {
    await chrome.storage.local.set({ [CONFIG.storageKey]: state });
    queueCodeSync();
    if (publish) queueForumSave();
  }

  function esc(v = '') {
    return String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function norm(v = '') { return String(v).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }

  function extractForumId(value) {
    const raw = String(value || '').trim();
    if (/^\d+$/.test(raw)) return raw;
    return raw.match(/\/members\/(?:[^/?#]*[.\-])?(\d+)\/?/i)?.[1]
      || raw.match(/\/data\/avatars\/[a-z]\/\d+\/(\d+)\./i)?.[1]
      || '';
  }

  function avatarPath(id, size = 'o') {
    const clean = extractForumId(id);
    if (!clean) return '';
    return `/data/avatars/${size}/${Math.floor(Number(clean) / 1000)}/${clean}.jpg`;
  }

  async function resolveAvatar(id) {
    for (const size of CONFIG.avatarSizes) {
      const path = avatarPath(id, size);
      const ok = await new Promise(resolve => {
        const img = new Image();
        const t = setTimeout(() => resolve(false), 1600);
        img.onload = () => { clearTimeout(t); resolve(true); };
        img.onerror = () => { clearTimeout(t); resolve(false); };
        img.src = `${location.origin}${path}?probe=${Date.now()}`;
      });
      if (ok) return path;
    }
    return avatarPath(id, 'l');
  }

  function getForumLink(card) { return card.querySelector('.links a[href*="/members/"]'); }
  function getVkLink(card) { return [...card.querySelectorAll('.links a[href]')].find(a => /vk\.(com|ru)/i.test(a.href)) || null; }
  function getKey(card, sectionId) {
    const forum = getForumLink(card)?.href || '';
    if (forum) {
      try { return `forum:${new URL(forum).pathname.replace(/\/+$/, '/')}`; } catch (_) {}
    }
    return `fallback:${sectionId}:${card.querySelector('.name')?.textContent?.trim() || 'unknown'}`;
  }

  function allowedSection(section) {
    if (!section || !sectionIds.includes(section.id)) return false;
    const title = norm(section.querySelector('h2')?.textContent);
    return !title.includes('разработ') && !title.includes('developer');
  }

  function scan(root = document) {
    const sections = [], items = [];
    for (const cfg of CONFIG.sections) {
      const section = root.querySelector(`#${CSS.escape(cfg.id)}`);
      if (!allowedSection(section)) continue;
      sections.push({ id: cfg.id, title: section.querySelector('h2')?.textContent?.trim() || cfg.title });
      section.querySelectorAll('.cards > .card').forEach(card => {
        const forum = getForumLink(card), vk = getVkLink(card), avatar = card.querySelector('.avatar');
        items.push({
          key: getKey(card, cfg.id), kind: 'existing', section: cfg.id,
          name: card.querySelector('.name')?.textContent?.trim() || '',
          role: card.querySelector('strong')?.textContent?.trim() || '',
          forum: forum?.href || '', vk: vk?.href || '', avatar: avatar?.src || '',
          forumId: extractForumId(forum?.href) || extractForumId(avatar?.src), hidden: false
        });
      });
    }
    return { sections, items };
  }

  function mergedSnapshot(base, state) {
    const items = base.items.map(x => ({ ...x, ...(state.overrides[x.key] || {}), kind: 'existing', key: x.key }));
    for (const x of state.added) items.push({ ...x, kind: 'added', key: x.id });
    return { sections: base.sections, items };
  }

  function setLink(a, href) {
    if (!a) return;
    if (!href) return a.remove();
    a.href = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  }

  async function patchCard(card, data) {
    if (card.querySelector('.name')) card.querySelector('.name').textContent = data.name || '';
    if (card.querySelector('strong')) card.querySelector('strong').textContent = data.role || '';
    setLink(getVkLink(card), data.vk);
    setLink(getForumLink(card), data.forum);
    const avatar = card.querySelector('.avatar');
    const id = data.forumId || extractForumId(data.forum);
    if (avatar && id) {
      avatar.src = data.avatarResolved || await resolveAvatar(id);
      avatar.alt = data.name || '';
    }
  }

  async function generateCode(state) {
    const wrapper = document.querySelector('.bbWrapper');
    if (!wrapper) return { ok: false, error: 'Не найден .bbWrapper со списком состава.' };
    const clone = wrapper.cloneNode(true);
    const base = scan(clone);
    const cardMap = new Map();

    for (const id of sectionIds) {
      const sec = clone.querySelector(`#${CSS.escape(id)}`);
      if (!allowedSection(sec)) continue;
      sec.querySelectorAll('.cards > .card').forEach(card => cardMap.set(getKey(card, id), { card, section: id }));
    }

    for (const item of base.items) {
      const entry = cardMap.get(item.key), ov = state.overrides[item.key];
      if (!entry || !ov) continue;
      if (ov.hidden) { entry.card.remove(); continue; }
      const data = { ...item, ...ov, forumId: ov.forumId || extractForumId(ov.forum) || item.forumId };
      if (data.forumId) data.avatarResolved = await resolveAvatar(data.forumId);
      const target = sectionIds.includes(data.section) ? data.section : item.section;
      if (target === entry.section) await patchCard(entry.card, data);
      else {
        const sec = clone.querySelector(`#${CSS.escape(target)}`), cards = sec?.querySelector('.cards');
        if (!allowedSection(sec) || !cards) continue;
        const template = cards.querySelector('.card') || entry.card;
        const fresh = template.cloneNode(true);
        await patchCard(fresh, data);
        cards.appendChild(fresh);
        entry.card.remove();
      }
    }

    for (const item of state.added) {
      if (item.hidden || !sectionIds.includes(item.section)) continue;
      const sec = clone.querySelector(`#${CSS.escape(item.section)}`), cards = sec?.querySelector('.cards');
      if (!allowedSection(sec) || !cards) continue;
      const template = cards.querySelector('.card') || clone.querySelector('.cards > .card');
      if (!template) continue;
      const fresh = template.cloneNode(true);
      const data = { ...item, forumId: item.forumId || extractForumId(item.forum) };
      if (data.forumId) data.avatarResolved = await resolveAvatar(data.forumId);
      await patchCard(fresh, data);
      cards.appendChild(fresh);
    }

    return { ok: true, code: `[PARSEHTML]\n${clone.outerHTML.trim()}\n[/PARSEHTML]` };
  }

  let codeTimer = null;
  function queueCodeSync() { clearTimeout(codeTimer); codeTimer = setTimeout(syncCode, 250); }
  async function syncCode() {
    if (location.pathname.match(/\/posts\/\d+\/edit\/?$/i)) return;
    const state = await getState(), result = await generateCode(state);
    if (result.ok) await chrome.storage.local.set({ [CONFIG.codeCacheKey]: { code: result.code, updatedAt: Date.now() } });
  }

  let forumTimer = null, forumBusy = false;
  function queueForumSave() { clearTimeout(forumTimer); forumTimer = setTimeout(autoSaveForum, CONFIG.autoPublishDebounceMs); }
  function currentEditPostId() { return location.pathname.match(/\/posts\/(\d+)\/edit\/?$/i)?.[1] || ''; }

  function findEditLink(targetId = '') {
    const links = [...document.querySelectorAll('a[href*="/posts/"][href*="/edit"]')].filter(visible);
    if (targetId) {
      const exact = links.find(a => new URL(a.href, location.href).pathname.includes(`/posts/${targetId}/edit`));
      if (exact) return exact;
    }
    const post = [...document.querySelectorAll('article.message,.message,.message--post,[id^="post-"]')].find(p => {
      const t = norm(p.textContent);
      return t.includes('список модерации') || t.includes('кураторы модерации') || t.includes('старшие модераторы');
    });
    return (post && links.find(a => post.contains(a))) || links[0] || null;
  }

  async function autoSaveForum() {
    const state = await getState();
    if (!state.autoPublish.enabled || currentEditPostId() || forumBusy) return;
    forumBusy = true;
    try {
      const result = await generateCode(state);
      if (!result.ok) return;
      const link = findEditLink(state.autoPublish.targetPostId);
      if (!link) return;
      const editUrl = new URL(link.href, location.href), postId = editUrl.pathname.match(/\/posts\/(\d+)\/edit/i)?.[1];
      if (!postId) return;
      state.autoPublish.targetPostId = postId;
      await chrome.storage.local.set({
        [CONFIG.storageKey]: state,
        [CONFIG.publishJobKey]: { postId, editUrl: editUrl.href, returnUrl: location.href, code: result.code, createdAt: Date.now() }
      });
      location.href = editUrl.href;
    } finally { forumBusy = false; }
  }

  function findSaveButton(form) {
    return [...form.querySelectorAll('button[type="submit"],input[type="submit"],button')].filter(visible).find(el => norm(el.value || el.textContent) === 'сохранить') || null;
  }

  function findEditForm(postId) {
    return [...document.querySelectorAll('form')].find(form => {
      const action = form.getAttribute('action') || '';
      const editor = form.querySelector('textarea[name="message"],textarea[name="message_html"],.fr-element[contenteditable="true"]');
      return editor && findSaveButton(form) && (action.includes(`/posts/${postId}/edit`) || action.includes('/edit'));
    }) || null;
  }

  function setEditorValue(el, value) {
    if (el instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter ? setter.call(el, value) : el.value = value;
    } else if (el.isContentEditable) el.innerText = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function completePublishJob() {
    const postId = currentEditPostId();
    if (!postId) return;
    const stored = await chrome.storage.local.get([CONFIG.publishJobKey]);
    const job = stored[CONFIG.publishJobKey];
    if (!job || String(job.postId) !== postId || Date.now() - job.createdAt > 120000) return;

    let form = null;
    const start = Date.now();
    while (!form && Date.now() - start < 9000) { form = findEditForm(postId); if (!form) await sleep(120); }
    if (!form) return;

    form.querySelectorAll('textarea[name="message"],textarea[name="message_html"],.fr-element[contenteditable="true"]').forEach(el => setEditorValue(el, job.code));
    await sleep(300);
    const save = findSaveButton(form);
    if (!save) return;
    await chrome.storage.local.remove([CONFIG.publishJobKey]);
    save.click();
  }

  const host = document.createElement('div');
  host.id = 'pride-keeper-staff-host';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    *{box-sizing:border-box}button,input,select,textarea{font:inherit}
    .pk-launch{position:fixed;z-index:2147483646;width:50px;height:50px;border-radius:50%;border:1px solid #443575;background:#100d18;box-shadow:0 12px 36px #0009,0 0 20px #7f63ff44;cursor:pointer;display:grid;place-items:center;padding:8px}.pk-launch img{width:100%;height:100%}.right-bottom{right:22px;bottom:22px}.right-top{right:22px;top:110px}.left-bottom{left:22px;bottom:22px}.left-top{left:22px;top:110px}.small{width:42px;height:42px}.standard{width:50px;height:50px}.large{width:60px;height:60px}
    .pk-bg{position:fixed;inset:0;z-index:2147483645;background:#030208aa;backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#f4f1ff}.hidden{display:none!important}
    .pk-win{width:min(720px,calc(100vw - 40px));height:min(640px,calc(100vh - 40px));background:radial-gradient(circle at 85% 0,#5b46b522,transparent 27%),linear-gradient(#0d0a14,#08070d);border:1px solid #30264b;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 28px 90px #000d}
    .pk-head{height:62px;border-bottom:1px solid #28203d;display:flex;align-items:center;justify-content:space-between;padding:10px 14px}.pk-brand{display:flex;gap:10px;align-items:center}.pk-brand img{width:42px;height:42px}.pk-brand strong{font-size:13px}.pk-brand span{display:block;color:#8177a4;font-size:9px;margin-top:2px}.pk-x{width:30px;height:30px;border:1px solid #372b57;background:#130f1d;color:#c3b8e4;border-radius:8px;cursor:pointer}
    .pk-scroll{flex:1;overflow:auto;padding:12px}.pk-scroll::-webkit-scrollbar{width:6px}.pk-scroll::-webkit-scrollbar-thumb{background:#35294e;border-radius:10px}.pk-bottom{height:50px;border-top:1px solid #28203d;display:flex;justify-content:space-between;align-items:center;padding:8px 10px}.pk-actions{display:flex;gap:7px}.pk-btn{border:1px solid #392c58;background:#130f1d;color:#d4cbea;border-radius:8px;padding:8px 11px;font-size:10px;font-weight:700;cursor:pointer}.pk-btn.primary{background:linear-gradient(135deg,#6550df,#8f73ff);color:#fff}.pk-btn.green{border-color:#295341;background:#102018;color:#78e0b2}.pk-btn.danger{border-color:#642d38;color:#ff9ead;background:#241116}
    .pk-top{border:1px solid #30264a;background:#151020;border-radius:10px;padding:11px;margin-bottom:10px}.pk-top strong{font-size:11px}.pk-top span{display:block;color:#81779d;font-size:9px;margin-top:3px;line-height:1.4}.pk-update{border-color:#5544a2;background:linear-gradient(135deg,#18122b,#12101d)}.pk-update b{color:#9e8aff}.pk-update-row{display:flex;justify-content:space-between;align-items:center;gap:10px}
    .pk-menu{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pk-menu button{min-height:76px;text-align:left;border:1px solid #30264a;background:#151020;color:#eeeaff;border-radius:10px;padding:12px;cursor:pointer}.pk-menu button:hover{border-color:#6251ae}.pk-menu strong{font-size:11px}.pk-menu span{display:block;color:#81779d;font-size:9px;margin-top:4px}
    .pk-toolbar{display:flex;gap:8px;margin-bottom:10px}.pk-toolbar input,.pk-field input,.pk-field select,.pk-code{width:100%;border:1px solid #33274f;background:#0e0b15;color:#eeeaff;border-radius:8px;padding:9px 10px;outline:none}.pk-toolbar input:focus,.pk-field input:focus,.pk-field select:focus,.pk-code:focus{border-color:#7d63ff}.pk-toolbar input{flex:1}
    .pk-sec{--c:#9173ff;border:1px solid #2a223e;background:#120f1a;border-radius:10px;padding:9px;margin-bottom:9px}.pk-sec[data-sec=management]{--c:#ff5365}.pk-sec[data-sec=main-mod]{--c:#4ed35d}.pk-sec[data-sec=curator]{--c:#9173ff}.pk-sec[data-sec=senior-mod]{--c:#f0ca2f}.pk-sec[data-sec=junior-mod]{--c:#42c4ff}.pk-sec-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.pk-sec-title{font-size:11px;font-weight:900;color:var(--c)}.pk-add{border:1px solid color-mix(in srgb,var(--c) 40%,#31274b);background:#100d18;color:var(--c);border-radius:7px;padding:5px 8px;font-size:9px;cursor:pointer}.pk-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.pk-card,.pk-new{min-height:126px;border:1px solid color-mix(in srgb,var(--c) 20%,#30264a);background:#171220;border-radius:9px;padding:8px;display:flex;flex-direction:column;align-items:center;text-align:center}.pk-card.off{opacity:.45}.pk-avatar{width:45px;height:45px;border-radius:50%;object-fit:cover;margin-bottom:7px}.pk-name{font-size:9px;font-weight:900;color:var(--c);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pk-role{font-size:7px;font-weight:900;margin-top:5px;padding:3px 6px;border-radius:6px;color:#fff;background:color-mix(in srgb,var(--c) 65%,#111);border:1px solid var(--c)}.pk-card-actions{display:flex;gap:5px;margin-top:auto;padding-top:8px}.pk-mini{width:26px;height:25px;border:1px solid #3b2e59;background:#0d0a13;color:#bfb5d7;border-radius:7px;cursor:pointer}.pk-new{justify-content:center;border-style:dashed;color:#847a9f;cursor:pointer}.pk-new b{font-size:20px}.pk-new span{font-size:9px;margin-top:4px}
    .pk-form{display:grid;grid-template-columns:1fr 1fr;gap:9px}.pk-field{display:grid;gap:4px}.pk-field.full{grid-column:1/-1}.pk-field label{font-size:9px;font-weight:800;color:#b9afd6}.pk-preview{grid-column:1/-1;border:1px solid #33274f;background:#100d18;border-radius:9px;padding:9px;font-size:9px;color:#8a80a6}.pk-code{height:390px;resize:none;font-family:Consolas,monospace;font-size:9px;line-height:1.4;white-space:pre}.pk-setting{border:1px solid #30264a;background:#130f1c;border-radius:9px;padding:10px;margin-bottom:8px}.pk-setting h4{font-size:10px;margin:0 0 8px}.pk-choices{display:flex;gap:6px;flex-wrap:wrap}.pk-choice{border:1px solid #372b55;background:#0e0b15;color:#9388b0;border-radius:7px;padding:7px 9px;font-size:9px;cursor:pointer}.pk-choice.active{border-color:#7c63ff;background:#251f38;color:#fff}
    @media(max-width:760px){.pk-grid,.pk-menu,.pk-form{grid-template-columns:1fr 1fr}}
  `;
  shadow.appendChild(style);

  const launcher = document.createElement('button');
  launcher.className = 'pk-launch right-bottom standard';
  launcher.innerHTML = `<img src="${asset('icon.svg')}" alt="PK">`;
  shadow.appendChild(launcher);

  const bg = document.createElement('div');
  bg.className = 'pk-bg hidden';
  bg.innerHTML = `<div class="pk-win"><div class="pk-head"><div class="pk-brand"><img src="${asset('icon.svg')}"><div><strong>PRIDE KEEPER</strong><span>STAFF EDITOR • v${CONFIG.version}</span></div></div><button class="pk-x">×</button></div><div class="pk-scroll"></div><div class="pk-bottom"><button class="pk-btn" data-back>← Назад</button><div class="pk-actions"></div></div></div>`;
  shadow.appendChild(bg);

  const scroll = bg.querySelector('.pk-scroll'), actions = bg.querySelector('.pk-actions'), back = bg.querySelector('[data-back]');
  let screen = 'home', history = [], base = { sections: [], items: [] }, snap = { sections: [], items: [] }, editItem = null, search = '';

  async function refresh() { base = scan(document); snap = mergedSnapshot(base, await getState()); }
  function itemBy(key, kind) { return snap.items.find(x => x.key === key && x.kind === kind); }
  function sectionTitle(id) { return snap.sections.find(x => x.id === id)?.title || CONFIG.sections.find(x => x.id === id)?.title || id; }
  function roleForSection(id) { const t = sectionTitle(id); return CONFIG.roles.includes(t) ? t : CONFIG.roles[0]; }
  function setScreen(s, push = true) { if (push && screen !== s) history.push(screen); screen = s; render(); }
  function goBack() { screen = history.pop() || 'home'; render(); }
  async function open() { bg.classList.remove('hidden'); await refresh(); render(); }
  function close() { bg.classList.add('hidden'); screen = 'home'; history = []; editItem = null; }

  async function applyLauncher() {
    const st = await getState();
    launcher.className = `pk-launch ${st.ui.position || 'right-bottom'} ${st.ui.size || 'standard'}`;
  }

  async function updateBannerHtml() {
    try {
      const info = await chrome.runtime.sendMessage({ type: 'PRIDE_CHECK_UPDATE' });
      if (!info?.available) return '';
      return `<div class="pk-top pk-update"><div class="pk-update-row"><div><strong>Доступно обновление <b>v${esc(info.version)}</b></strong><span>${esc(info.notes || 'Новый ZIP собирается автоматически через GitHub.')}</span></div><button class="pk-btn primary" data-download-update>Скачать ZIP</button></div></div>`;
    } catch (_) { return ''; }
  }

  async function renderHome() {
    back.style.visibility = 'hidden'; actions.innerHTML = '';
    const banner = await updateBannerHtml();
    scroll.innerHTML = `${banner}<div class="pk-top"><strong>PRIDE KEEPER • СОСТАВ</strong><span>Правки хранятся в черновике, код пересобирается автоматически. GitHub сам собирает новый ZIP после обновления исходников.</span></div><div class="pk-menu"><button data-go="staff"><strong>👥 Управление составом</strong><span>Добавить, изменить, перенести или убрать человека</span></button><button data-go="code"><strong>⌘ Готовый код</strong><span>LIVE [PARSEHTML] + ручное сохранение</span></button><button data-go="settings"><strong>⚙ Настройки</strong><span>Автосохранение, кнопка и GitHub-обновления</span></button><button data-check><strong>↻ Проверить обновление</strong><span>Проверить GitHub прямо сейчас</span></button></div>`;
    scroll.querySelectorAll('[data-go]').forEach(b => b.onclick = () => setScreen(b.dataset.go));
    scroll.querySelector('[data-check]').onclick = async () => { await chrome.runtime.sendMessage({ type: 'PRIDE_CHECK_UPDATE' }); renderHome(); };
    scroll.querySelector('[data-download-update]')?.addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'PRIDE_CHECK_UPDATE', forceDownload: true }); });
  }

  function avatarFor(x) { return x.forumId ? `${location.origin}${avatarPath(x.forumId, 'o')}` : x.avatar || ''; }
  function cardHtml(x) { return `<div class="pk-card${x.hidden ? ' off' : ''}" data-key="${esc(x.key)}" data-kind="${esc(x.kind)}"><img class="pk-avatar" src="${esc(avatarFor(x))}"><div class="pk-name">${esc(x.name || 'Без ника')}</div><div class="pk-role">${x.hidden ? 'БУДЕТ УБРАН' : esc(x.role || 'Без должности')}</div><div class="pk-card-actions"><button class="pk-mini" data-edit>✎</button><button class="pk-mini" data-toggle>${x.hidden ? '↩' : '×'}</button></div></div>`; }

  function renderStaff() {
    back.style.visibility = 'visible'; actions.innerHTML = `<button class="pk-btn primary" data-code>Готовый код</button>`;
    const q = norm(search);
    scroll.innerHTML = `<div class="pk-top"><strong>Управление составом</strong><span>Разработчики не затрагиваются.</span></div><div class="pk-toolbar"><input data-search value="${esc(search)}" placeholder="Поиск"><button class="pk-btn green" data-add-any>＋ Добавить</button></div><div data-list></div>`;
    const list = scroll.querySelector('[data-list]');
    list.innerHTML = snap.sections.map(sec => {
      const all = snap.items.filter(x => x.section === sec.id), shown = all.filter(x => !q || norm(`${x.name} ${x.role}`).includes(q));
      if (q && !shown.length) return '';
      return `<section class="pk-sec" data-sec="${esc(sec.id)}"><div class="pk-sec-head"><div class="pk-sec-title">${esc(sec.title)} (${all.filter(x => !x.hidden).length})</div><button class="pk-add" data-add="${esc(sec.id)}">＋ Добавить</button></div><div class="pk-grid">${shown.map(cardHtml).join('')}<button class="pk-new" data-add="${esc(sec.id)}"><b>＋</b><span>Добавить человека</span></button></div></section>`;
    }).join('');
    scroll.querySelector('[data-search]').oninput = e => { search = e.target.value; renderStaff(); scroll.querySelector('[data-search]').focus(); };
    scroll.querySelector('[data-add-any]').onclick = () => { editItem = { new: true, section: snap.sections[0]?.id || 'management' }; setScreen('edit'); };
    scroll.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { editItem = { new: true, section: b.dataset.add }; setScreen('edit'); });
    scroll.querySelectorAll('.pk-card').forEach(card => {
      const x = itemBy(card.dataset.key, card.dataset.kind); if (!x) return;
      card.querySelector('[data-edit]').onclick = () => { editItem = x; setScreen('edit'); };
      card.querySelector('[data-toggle]').onclick = async () => {
        const st = await getState();
        if (x.kind === 'added') st.added = st.added.filter(a => a.id !== x.key);
        else st.overrides[x.key] = { ...(st.overrides[x.key] || {}), hidden: !x.hidden };
        await saveState(st); await refresh(); renderStaff();
      };
    });
    actions.querySelector('[data-code]').onclick = () => setScreen('code');
  }

  function renderEdit() {
    back.style.visibility = 'visible';
    const x = editItem?.new ? null : editItem, section = x?.section || editItem?.section || 'management', role = CONFIG.roles.includes(x?.role) ? x.role : roleForSection(section);
    actions.innerHTML = `${x ? '<button class="pk-btn danger" data-remove>Убрать</button>' : ''}<button class="pk-btn primary" data-save>Сохранить</button>`;
    scroll.innerHTML = `<div class="pk-top"><strong>${x ? 'Редактирование' : 'Добавление'} человека</strong><span>Аватар берётся автоматически из ID профиля форума.</span></div><div class="pk-form"><div class="pk-field"><label>Раздел</label><select data-f="section">${snap.sections.map(s => `<option value="${esc(s.id)}"${s.id === section ? ' selected' : ''}>${esc(s.title)}</option>`).join('')}</select></div><div class="pk-field"><label>Должность</label><select data-f="role">${CONFIG.roles.map(r => `<option${r === role ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></div><div class="pk-field"><label>Форумный ник</label><input data-f="name" value="${esc(x?.name || '')}"></div><div class="pk-field"><label>VK</label><input data-f="vk" value="${esc(x?.vk || '')}"></div><div class="pk-field full"><label>Профиль форума</label><input data-f="forum" value="${esc(x?.forum || '')}" placeholder="https://forum.pridekeeper.tech/members/5/"></div><div class="pk-preview" data-preview>Вставь профиль форума: ID и аватар определятся автоматически.</div></div>`;
    const sec = scroll.querySelector('[data-f="section"]'), roleSel = scroll.querySelector('[data-f="role"]');
    sec.onchange = () => roleSel.value = roleForSection(sec.value);
    const forumInput = scroll.querySelector('[data-f="forum"]');
    forumInput.oninput = () => { const id = extractForumId(forumInput.value); scroll.querySelector('[data-preview]').textContent = id ? `ID форума: ${id}` : 'ID не найден'; };
    forumInput.oninput();
    actions.querySelector('[data-save]').onclick = async () => {
      const data = { section: sec.value, role: roleSel.value, name: scroll.querySelector('[data-f="name"]').value.trim(), vk: scroll.querySelector('[data-f="vk"]').value.trim(), forum: forumInput.value.trim(), forumId: extractForumId(forumInput.value), hidden: false };
      if (!data.name || !data.forumId) return;
      const st = await getState();
      if (x?.kind === 'existing') st.overrides[x.key] = { ...(st.overrides[x.key] || {}), ...data };
      else {
        const id = x?.key || `added:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
        const rec = { id, kind: 'added', ...data };
        const idx = st.added.findIndex(a => a.id === id); idx >= 0 ? st.added[idx] = rec : st.added.push(rec);
      }
      await saveState(st); await refresh(); goBack();
    };
    actions.querySelector('[data-remove]')?.addEventListener('click', async () => {
      const st = await getState();
      if (x.kind === 'added') st.added = st.added.filter(a => a.id !== x.key); else st.overrides[x.key] = { ...(st.overrides[x.key] || {}), hidden: true };
      await saveState(st); await refresh(); goBack();
    });
  }

  async function renderCode() {
    back.style.visibility = 'visible'; actions.innerHTML = `<button class="pk-btn green" data-publish>Сохранить на форум</button><button class="pk-btn primary" data-copy>Копировать</button>`;
    scroll.innerHTML = `<div class="pk-top"><strong>Готовый код</strong><span>Код пересобирается из текущей страницы + черновика. Автосохранение редактирует существующий /posts/ID/edit.</span></div><textarea class="pk-code" data-code readonly></textarea>`;
    const area = scroll.querySelector('[data-code]'), st = await getState(), result = await generateCode(st);
    if (result.ok) { area.value = result.code; await chrome.storage.local.set({ [CONFIG.codeCacheKey]: { code: result.code, updatedAt: Date.now() } }); }
    actions.querySelector('[data-copy]').onclick = async () => { await navigator.clipboard.writeText(area.value); };
    actions.querySelector('[data-publish]').onclick = () => autoSaveForum();
  }

  async function renderSettings() {
    back.style.visibility = 'visible'; actions.innerHTML = `<button class="pk-btn primary" data-save-settings>Сохранить</button>`;
    const st = await getState(), up = await chrome.runtime.sendMessage({ type: 'PRIDE_GET_UPDATE_STATE' });
    scroll.innerHTML = `<div class="pk-top"><strong>Настройки</strong><span>Кнопка, автосохранение и GitHub-обновления.</span></div><div class="pk-setting"><h4>Автосохранение поста</h4><div class="pk-choices"><button class="pk-choice${st.autoPublish.enabled ? ' active' : ''}" data-auto="1">Включено</button><button class="pk-choice${!st.autoPublish.enabled ? ' active' : ''}" data-auto="0">Выключено</button></div></div><div class="pk-setting"><h4>Автоскачивание ZIP с GitHub</h4><div class="pk-choices"><button class="pk-choice${up.autoDownload !== false ? ' active' : ''}" data-gh="1">Включено</button><button class="pk-choice${up.autoDownload === false ? ' active' : ''}" data-gh="0">Выключено</button></div><div style="font-size:9px;color:#81779d;margin-top:7px">Распакованное расширение Chrome нельзя безопасно заменить само. Поэтому новый ZIP скачивается автоматически, а установить его нужно через Reload/замену папки.</div></div><div class="pk-setting"><h4>Положение кнопки</h4><div class="pk-choices">${['right-top','right-bottom','left-top','left-bottom'].map(v => `<button class="pk-choice${st.ui.position === v ? ' active' : ''}" data-pos="${v}">${v}</button>`).join('')}</div></div>`;
    let auto = st.autoPublish.enabled, gh = up.autoDownload !== false, pos = st.ui.position;
    scroll.querySelectorAll('[data-auto]').forEach(b => b.onclick = () => { auto = b.dataset.auto === '1'; scroll.querySelectorAll('[data-auto]').forEach(x => x.classList.toggle('active', x === b)); });
    scroll.querySelectorAll('[data-gh]').forEach(b => b.onclick = () => { gh = b.dataset.gh === '1'; scroll.querySelectorAll('[data-gh]').forEach(x => x.classList.toggle('active', x === b)); });
    scroll.querySelectorAll('[data-pos]').forEach(b => b.onclick = () => { pos = b.dataset.pos; scroll.querySelectorAll('[data-pos]').forEach(x => x.classList.toggle('active', x === b)); });
    actions.querySelector('[data-save-settings]').onclick = async () => { const s = await getState(); s.autoPublish.enabled = auto; s.ui.position = pos; await saveState(s, { publish: false }); await chrome.runtime.sendMessage({ type: 'PRIDE_SET_AUTO_DOWNLOAD', enabled: gh }); await applyLauncher(); };
  }

  function render() {
    if (screen === 'home') return renderHome();
    if (screen === 'staff') return renderStaff();
    if (screen === 'edit') return renderEdit();
    if (screen === 'code') return renderCode();
    if (screen === 'settings') return renderSettings();
  }

  launcher.onclick = open; bg.querySelector('.pk-x').onclick = close; bg.onclick = e => { if (e.target === bg) close(); }; back.onclick = goBack;
  chrome.runtime.onMessage.addListener((m, _s, reply) => { if (m?.type === 'PRIDE_TOGGLE_UI') { bg.classList.contains('hidden') ? open() : close(); reply({ ok: true }); } });

  if (currentEditPostId()) completePublishJob().catch(console.error);
  applyLauncher();
  syncCode().catch(() => {});
})();
