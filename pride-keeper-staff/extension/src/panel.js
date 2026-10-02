(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.panel = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const ROUTES = {
    home: ['⌂', 'Главная'], staff: ['♟', 'STAFF состав'], replies: ['◉', 'Быстрые ответы'],
    tags: ['#', 'Теги'], replace: ['⌁', 'Автозамена'], rules: ['▤', 'Правила'],
    complaints: ['◆', 'Работа с жалобами'], analytics: ['◔', 'Аналитика жалоб'],
    history: ['↺', 'История'], settings: ['☷', 'Настройки']
  };
  const ROUTE_ORDER = ['home', 'staff', 'replies', 'tags', 'replace', 'rules', 'complaints', 'analytics', 'history', 'settings'];
  const ACTION_LABELS = { pin: 'Закрепить', unpin: 'Открепить', close: 'Закрыть тему', open: 'Открыть тему', move: 'Переместить', edit: 'Изменить', delete: 'Удалить' };
  function esc(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
  function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }
  function actionTone(type) { return type === 'delete' ? 'danger' : type === 'close' ? 'warning' : type === 'open' ? 'success' : 'accent'; }
  function layoutForWidth(width) { return Number(width) < 560 ? 'mobile' : 'panel'; }
  function tabsForKind(kind) { return kind === 'staff' ? ['staff', 'actions', 'replies', 'history'] : (kind === 'complaint' || kind === 'thread') ? ['actions', 'replies', 'history'] : ['history']; }
  function preferredTab(kind) { return kind === 'staff' ? 'staff' : (kind === 'complaint' || kind === 'thread') ? 'actions' : 'history'; }
  function routesForContext(context = {}) {
    return [...ROUTE_ORDER];
  }
  function preferredRoute(context = {}) { return context.kind === 'staff' ? 'staff' : context.kind === 'complaint' ? 'complaints' : 'home'; }
  function sidebarMode(width, collapsed) { return Number(width) < 640 ? 'mobile' : collapsed ? 'compact' : 'full'; }
  function filterTemplates(items = [], filters = {}) {
    return items.filter((item) => templateVisible(item, filters)).sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
  }
  function templateVisible(item = {}, filters = {}) {
    const query = String(filters.query || '').trim().toLowerCase();
    const category = String(filters.category || '').trim().toLowerCase();
    const haystack = `${item.title || ''} ${item.category || ''} ${item.text || ''}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!category || String(item.category || '').toLowerCase() === category);
  }
  function filterHistory(entries = [], filters = {}) {
    const query = String(filters.query || '').trim().toLowerCase();
    const action = String(filters.action || 'all');
    const result = String(filters.result || 'all');
    return entries.filter((entry) => {
      const haystack = `${entry.title || ''} ${entry.threadId || ''} ${entry.action || ''} ${entry.status || ''} ${entry.error || ''}`.toLowerCase();
      return (!query || haystack.includes(query)) && (action === 'all' || entry.action === action) && (result === 'all' || (result === 'success' ? !!entry.ok : !entry.ok));
    });
  }
  function nextConfirmState(armedUntil = 0, now = Date.now(), windowMs = 5000) {
    return armedUntil > now ? { execute: true, armedUntil: 0 } : { execute: false, armedUntil: now + windowMs };
  }
  function analyticsBounds(range = '30d', now = Date.now()) {
    const end = new Date(now + 1000);
    if (range === 'today') { const start = new Date(now); start.setHours(0, 0, 0, 0); return { from: start.toISOString(), to: end.toISOString() }; }
    const days = range === '7d' ? 7 : 30;
    return { from: new Date(now - days * 86400000).toISOString(), to: end.toISOString() };
  }
  function dashboardModel(context = {}, state = {}) {
    const history = Array.isArray(state.history) ? state.history : [];
    return {
      profile: context.profile || { name: 'Администратор', avatar: '', role: '' }, routes: routesForContext(context),
      contextLabel: `${context.kind === 'staff' ? 'Состав' : context.isComplaint ? 'Жалоба' : context.threadId ? 'Тема' : 'Форум'}${context.threadId ? ` #${context.threadId}` : ''}`,
      complaintTotal: history.filter((entry) => entry.action === 'complaint-status' && entry.ok).length,
      recentThreads: Array.isArray(state.recentThreads) ? state.recentThreads.slice(-5).reverse() : [],
      sidebarCollapsed: !!state.ui?.sidebarCollapsed, title: context.title || '', threadId: context.threadId || ''
    };
  }
  function routeButtons(routes, active) {
    return routes.map((id) => `<button type="button" class="pkfa-side__item${id === active ? ' is-active' : ''}" data-route="${id}" aria-label="${esc(ROUTES[id]?.[1] || id)}" aria-current="${id === active ? 'page' : 'false'}"><i>${ROUTES[id]?.[0] || '•'}</i><span>${esc(ROUTES[id]?.[1] || id)}</span></button>`).join('');
  }
  function shellTemplate(model, active = 'home', collapsed = false) {
    const avatar = model.profile?.avatar ? `<img src="${esc(model.profile.avatar)}" alt="">` : `<span>${esc((model.profile?.name || 'A').slice(0, 1).toUpperCase())}</span>`;
    const paw = root.PKFA?.asset?.('pridekeeper-paw.png') || 'assets/pridekeeper-paw.png';
    return `<button type="button" class="pkfa-launcher-v4 pkfa-launcher-v4--round" data-pkfa-launcher data-helper-toggle aria-label="Открыть PRIDE KEEPER Helper"><img src="${esc(paw)}" alt=""><em></em></button><div class="pkfa-overlay" data-helper-overlay aria-hidden="true"><section class="pkfa-helper${collapsed ? ' is-collapsed' : ''}" role="dialog" aria-modal="true" aria-label="PRIDE KEEPER Helper"><aside class="pkfa-side"><div class="pkfa-side__brand"><b>PK</b><span>PRIDE KEEPER<small>HELPER <em>v5.0</em></small></span></div><div class="pkfa-side__section">ОСНОВНОЕ</div><nav aria-label="Разделы Helper">${routeButtons(model.routes || [], active)}</nav><div class="pkfa-side__links" aria-label="Статус"><span><b>●</b> Форум подключён</span></div><button type="button" class="pkfa-side__collapse" data-collapse aria-expanded="${String(!collapsed)}"><i>‹</i><span>Свернуть панель</span></button></aside><div class="pkfa-main"><header class="pkfa-topbar"><button type="button" class="pkfa-mobile-menu" data-collapse aria-label="Открыть навигацию">☰</button><div class="pkfa-context-dot"><i></i><span>${esc(model.contextLabel || 'Форум')}</span></div><div class="pkfa-user"><div><b>${esc(model.profile?.name || 'Администратор')}</b><small>${esc(model.profile?.role || 'Forum staff')}</small></div><figure>${avatar}</figure><button type="button" class="pkfa-close-v4" data-helper-close aria-label="Закрыть">×</button></div></header><main class="pkfa-screen" data-screen></main><div class="pkfa-toast-v4" data-toast role="status" aria-live="polite"></div></div></section></div>`;
  }

  let host, overlay, screen, toast, state, context, model, activeRoute = 'home', opened = false;
  let historyFilters = { query: '', action: 'all', result: 'all' }, clearHistoryArmedUntil = 0;
  let actionExecutor, replyController;
  function notify(message, tone = 'info') { if (!toast) return; toast.textContent = message; toast.dataset.tone = tone; toast.classList.add('is-show'); clearTimeout(toast.__timer); toast.__timer = setTimeout(() => toast.classList.remove('is-show'), 3200); }
  function closeDecision({ staffDirty = false } = {}) {
    return staffDirty ? { allowed: false, message: 'Сначала сохраните или отмените несохранённые изменения STAFF.' } : { allowed: true, message: '' };
  }
  function setOpen(value) { opened = typeof value === 'boolean' ? value : !opened; overlay?.classList.toggle('is-open', opened); overlay?.setAttribute('aria-hidden', String(!opened)); if (overlay) overlay.inert = !opened; if (opened) host?.querySelector('[data-route].is-active')?.focus?.(); else host?.querySelector('[data-pkfa-launcher]')?.focus?.(); }
  function open(route) { if (route && model?.routes?.includes(route)) updateRoute(route); setOpen(true); return { opened: true, route: activeRoute }; }
  function close(options = {}) { const decision = closeDecision({ staffDirty: options.staffDirty ?? !!root.PKFA?.staff?.isDirty?.() }); if (!decision.allowed) { notify(decision.message, 'warning'); return decision; } setOpen(false); return decision; }
  function homeView() {
    const profile = model.profile || {}; const avatar = profile.avatar ? `<img src="${esc(profile.avatar)}" alt="">` : `<span>${esc((profile.name || 'A')[0])}</span>`;
    const recents = model.recentThreads.length ? model.recentThreads.map((item) => `<button data-go-thread="${esc(item.url || '')}"><b>${esc(item.title || `Тема #${item.threadId}`)}</b><span>#${esc(item.threadId || '')}</span></button>`).join('') : `<div class="pkfa-empty-v4"><i>◉</i><b>Здесь появятся ваши недавние разделы</b><span>Helper запомнит посещённые темы</span></div>`;
    return `<section class="pkfa-welcome"><b>Отдохнули? Тогда за дело, ${esc(profile.name || 'Администратор')}! ☕</b><span></span></section><section class="pkfa-service"><i>♟</i><b>Сервис администрации</b><span>PRIDE KEEPER Forum</span></section><section class="pkfa-profile-card"><div class="pkfa-profile-card__avatar">${avatar}</div><div class="pkfa-profile-card__body"><h1>${esc(profile.name || 'Администратор')} <em>CHANDLER</em></h1><div class="pkfa-recents">${recents}</div></div><div class="pkfa-clock"><b>${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</b><span>${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div><div class="pkfa-complaint-count"><span>Проверено жалоб</span><b>${model.complaintTotal}</b></div></section><div class="pkfa-quick-grid"><button data-route="replies"><i>◉</i><b>Быстрые ответы</b><span>Шаблоны и теги</span></button><button data-route="analytics"><i>◔</i><b>Аналитика жалоб</b><span>Локальная статистика</span></button>${context.kind === 'staff' ? '<button data-route="staff"><i>♟</i><b>STAFF состав</b><span>Редактор первого сообщения</span></button>' : ''}<button data-route="settings"><i>☷</i><b>Настройки</b><span>Внешний вид и данные</span></button></div>`;
  }
  function staffViewTemplate(currentContext = context || {}) {
    const available = currentContext.kind === 'staff';
    return `<div class="pkfa-page-head" tabindex="-1"><i>♟</i><div><b>STAFF EDITOR</b><span>Управление составом темы №1623</span></div><button type="button" data-discard-staff>Отменить черновик</button></div><section class="pkfa-hero-v4"><div><small>STAFF ENGINE v5</small><h1>Редактор состава PRIDE KEEPER</h1><p>${available ? 'Рабочая область состава загружается внутри Helper.' : 'Откройте тему №1623, чтобы редактировать состав.'}</p></div><b>PK</b></section><div data-staff-workspace-host${available ? '' : ' aria-disabled="true"'}></div><div class="pkfa-notice ${available ? 'success' : ''}">Разработчики не изменяются. Quick Reply не используется для сохранения состава.</div>`;
  }
  function staffView() { return staffViewTemplate(context); }
  function repliesView() {
    const sorted = filterTemplates(state.templates || []);
    const categories = [...new Set(sorted.map((item) => item.category || 'Общие'))];
    const cards = sorted.map((item) => `<article class="pkfa-answer-card" data-category="${esc(item.category || 'Общие')}" data-template-search="${esc(`${item.title} ${item.category || ''} ${item.text}`.toLowerCase())}"><header><i class="tone-${esc(item.color || 'purple')}"></i><div><b>${esc(item.title)}</b><span>${esc(item.category || 'Общие')}</span></div><button class="pkfa-favorite${item.favorite ? ' is-active' : ''}" data-favorite-template="${esc(item.id)}" aria-label="${item.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}">★</button>${item.custom ? `<button data-edit-template="${esc(item.id)}">Изменить</button><button data-remove-template="${esc(item.id)}" aria-label="Удалить шаблон">×</button>` : ''}</header><p>${esc(item.text)}</p><footer><button data-preview-template="${esc(item.id)}">Предпросмотр</button><button data-copy-template="${esc(item.id)}">Копировать</button><button data-insert-template="${esc(item.id)}">Вставить</button><button class="primary" data-send-template="${esc(item.id)}">Отправить сразу</button></footer></article>`).join('');
    return `<div class="pkfa-page-head"><i>◉</i><div><b>Быстрые ответы</b><span>Шаблоны, переменные и мгновенная отправка</span></div><button data-new-template>＋ Новый шаблон</button></div><div class="pkfa-toolbar-v4"><label>⌕<input data-template-filter placeholder="Поиск шаблона"></label><select data-template-category><option value="">Все категории</option>${categories.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select><span>${sorted.length} шаблонов</span></div><form class="pkfa-editor-form is-hidden" data-template-form><input type="hidden" name="id"><input name="title" required placeholder="Название"><input name="category" value="Мои шаблоны" placeholder="Категория"><textarea name="text" required placeholder="Текст ответа"></textarea><div><button type="button" data-cancel-template>Отмена</button><button class="primary" type="submit">Сохранить</button></div></form><div class="pkfa-answer-grid" data-answer-grid>${cards || '<div class="pkfa-empty-v4"><b>Шаблонов пока нет</b></div>'}</div>`;
  }
  function complaintsView() {
    const card = root.PKFA.complaints?.buildCard?.(root.document, context) || {}; const statuses = context.isComplaint ? (root.PKFA.complaints?.STATUSES || []).map((item) => `<button class="pkfa-status-chip tone-${esc(item.tone)}${card.status === item.id ? ' is-active' : ''}" data-complaint-status="${esc(item.id)}">${esc(item.label)}</button>`).join('') : '';
    return `<div class="pkfa-page-head"><i>◆</i><div><b>Работа с жалобами</b><span>Карточка текущей темы и быстрые решения</span></div></div><section class="pkfa-complaint-card"><header><span>${esc(card.section || 'Раздел не определён')}</span><em>#${esc(card.threadId || '—')}</em></header><h1>${esc(card.title || 'Откройте тему жалобы')}</h1><div class="pkfa-complaint-meta"><span>Автор <b>${esc(card.author || '—')}</b></span><span>Ответчик <b>${esc(card.accused || '—')}</b></span></div></section><div class="pkfa-subhead"><b>Изменить статус</b><span>Ответ не отправляется автоматически</span></div><div class="pkfa-status-grid">${statuses || '<span>Статусы доступны в разделе жалоб</span>'}</div><div class="pkfa-notice">Статус сохраняется локально и используется в аналитике. Форумные действия выполняются отдельными реальными кнопками.</div>`;
  }
  function analyticsView() {
    const range = state.complaints?.analyticsRange || '30d';
    const stats = root.PKFA.complaints?.summarize?.(state.history || [], analyticsBounds(range)) || { total: 0, resolved: 0, denied: 0, pending: 0, errors: 0, sections: {} };
    const sections = Object.entries(stats.sections || {}).map(([name, count]) => `<div><span>${esc(name)}</span><b>${count}</b></div>`).join('');
    return `<div class="pkfa-page-head"><i>◔</i><div><b>Аналитика жалоб</b><span>Реальная локальная статистика действий Helper</span></div></div><div class="pkfa-tabs-v4"><button class="is-active">◔ Статистика</button><button>☷ Разделы</button></div><div class="pkfa-toolbar-v4"><div class="pkfa-range"><button data-range="today" class="${range === 'today' ? 'is-active' : ''}">Сегодня</button><button data-range="7d" class="${range === '7d' ? 'is-active' : ''}">7 дней</button><button data-range="30d" class="${range === '30d' ? 'is-active' : ''}">30 дней</button></div><button data-export-analytics>Экспорт отчёта</button></div><div class="pkfa-stat-grid"><article><i>Σ</i><b>${stats.total}</b><span>Всего решений</span></article><article><i>✓</i><b>${stats.resolved}</b><span>Рассмотрено</span></article><article><i>×</i><b>${stats.denied}</b><span>Отказано</span></article><article><i>!</i><b>${stats.errors}</b><span>Ошибки</span></article></div><section class="pkfa-report"><header><b>Статистика по разделам</b><span>${range}</span></header>${sections || '<div class="pkfa-empty-v4"><i>▰</i><b>Отчётов пока нет</b><span>Обработайте жалобы через Helper — данные появятся здесь</span></div>'}</section>`;
  }
  function historyView() {
    const source = [...(state.history || [])].reverse();
    const entries = filterHistory(source, historyFilters);
    const actions = [...new Set(source.map((entry) => entry.action).filter(Boolean))];
    return `<div class="pkfa-page-head"><i>↺</i><div><b>История действий</b><span>Последние операции расширения</span></div><div><button data-export-history>Экспорт</button><button data-clear-history>${clearHistoryArmedUntil > Date.now() ? 'Нажмите ещё раз' : 'Очистить'}</button></div></div><div class="pkfa-history-filters"><label>⌕<input data-history-query value="${esc(historyFilters.query)}" placeholder="Поиск по теме или ID"></label><select data-history-action><option value="all">Все действия</option>${actions.map((name) => `<option value="${esc(name)}"${historyFilters.action === name ? ' selected' : ''}>${esc(ACTION_LABELS[name] || name)}</option>`).join('')}</select><select data-history-result><option value="all">Любой результат</option><option value="success"${historyFilters.result === 'success' ? ' selected' : ''}>Успешно</option><option value="error"${historyFilters.result === 'error' ? ' selected' : ''}>Ошибки</option></select><span>${entries.length} из ${source.length}</span></div><div class="pkfa-history-v4">${entries.map((entry) => `<article><i class="${entry.ok ? 'ok' : 'bad'}">${entry.ok ? '✓' : '!'}</i><div><b>${esc(ACTION_LABELS[entry.action] || entry.action || 'Действие')}</b><span>${esc(entry.title || `Тема #${entry.threadId || '—'}`)}</span><small>${esc(new Date(entry.time).toLocaleString('ru-RU'))}${entry.error ? ` · ${esc(entry.error)}` : ''}</small></div></article>`).join('') || '<div class="pkfa-empty-v4"><b>Ничего не найдено</b><span>Измените фильтры истории</span></div>'}</div>`;
  }
  function tagsView() {
    const tags = (state.tags || []).map((tag, index) => `<article class="pkfa-answer-card"><header><div><b>${esc(tag.title || tag.text)}</b><span>${esc(tag.group || 'Общие')} · ${esc(tag.text || '')}</span></div><button data-move-tag="${esc(tag.id)}" data-direction="up" aria-label="Поднять тег"${index === 0 ? ' disabled' : ''}>↑</button><button data-move-tag="${esc(tag.id)}" data-direction="down" aria-label="Опустить тег"${index === state.tags.length - 1 ? ' disabled' : ''}>↓</button><button data-insert-tag="${esc(tag.id)}">Вставить</button><button data-remove-tag="${esc(tag.id)}" aria-label="Удалить тег">×</button></header></article>`).join('');
    return `<div class="pkfa-page-head" tabindex="-1"><i>#</i><div><b>Теги</b><span>Короткие вставки без автоматической отправки</span></div></div><form class="pkfa-editor-form" data-tag-form><input name="title" required maxlength="32" placeholder="Название"><input name="group" maxlength="32" placeholder="Группа"><textarea name="text" required maxlength="500" placeholder="Текст тега"></textarea><button class="primary" type="submit">Добавить тег</button></form><div class="pkfa-answer-grid">${tags || '<div class="pkfa-empty-v4"><b>Тегов пока нет</b><span>Создайте первый быстрый тег</span></div>'}</div>`;
  }
  function replaceView() {
    const rows = (state.replacements || []).map((item) => `<article class="pkfa-answer-card"><header><div><b>${esc(item.from)}</b><span>${esc(item.to)}</span></div><button data-toggle-replacement="${esc(item.id)}" aria-pressed="${String(item.enabled !== false)}">${item.enabled !== false ? 'Включено' : 'Выключено'}</button><button data-remove-replacement="${esc(item.id)}" aria-label="Удалить автозамену">×</button></header></article>`).join('');
    return `<div class="pkfa-page-head" tabindex="-1"><i>⌁</i><div><b>Автозамена</b><span>Применяется только при явной вставке текста</span></div></div><form class="pkfa-editor-form" data-replacement-form><input name="from" required maxlength="80" placeholder="Сокращение"><textarea name="to" required maxlength="1000" placeholder="Текст замены"></textarea><button class="primary" type="submit">Добавить правило</button></form><div class="pkfa-answer-grid">${rows || '<div class="pkfa-empty-v4"><b>Правил автозамены нет</b></div>'}</div>`;
  }
  function rulesView() {
    const rows = (state.rules || []).map((item) => `<article class="pkfa-answer-card" data-rule-search="${esc(`${item.title || ''} ${item.text || ''} ${item.url || ''}`.toLowerCase())}"><header><div><b>${esc(item.title || 'Правило')}</b><span>${esc(item.category || 'Локальное')}</span></div><button data-copy-rule="${esc(item.id)}">Копировать</button><button data-remove-rule="${esc(item.id)}" aria-label="Удалить правило">×</button></header><p>${esc(item.text || '')}</p></article>`).join('');
    return `<div class="pkfa-page-head" tabindex="-1"><i>▤</i><div><b>Правила</b><span>Локальный каталог и закладки</span></div></div><div class="pkfa-toolbar-v4"><label>⌕<input data-rule-filter placeholder="Поиск правила"></label></div><form class="pkfa-editor-form" data-rule-form><input name="title" required maxlength="80" placeholder="Номер или название"><input name="category" maxlength="80" placeholder="Категория"><textarea name="text" required maxlength="2000" placeholder="Формулировка"></textarea><input name="url" maxlength="500" placeholder="Ссылка (необязательно)"><button class="primary" type="submit">Добавить правило</button></form><div class="pkfa-answer-grid">${rows || '<div class="pkfa-empty-v4"><b>Сохранённых правил нет</b></div>'}</div>`;
  }
  function settingsView() {
    const tiles = [['replies', '◉', 'Быстрые ответы', 'blue'], ['tags', '#', 'Теги', 'green'], ['replace', '⌁', 'Автозамена', 'gold'], ['rules', '▤', 'Правила', 'purple'], ['appearance', '✣', 'Внешний вид', 'purple'], ['complaints', '◆', 'Работа с жалобами', 'red'], ['navigation', '⌘', 'Навигация', 'blue']];
    const tags = (state.tags || []).map((tag) => `<span class="pkfa-tag-item"><b>${esc(tag.title || tag.text)}</b><button data-remove-tag="${esc(tag.id)}" aria-label="Удалить тег">×</button></span>`).join('');
    return `<div class="pkfa-settings-actions"><button data-export-settings><i>⇧</i><b>Экспорт настроек</b></button><button data-import-settings><i>⇩</i><b>Импорт настроек</b></button><input type="file" accept="application/json,.json" data-import-file hidden></div><div class="pkfa-section-label">КОНТЕНТ И ШАБЛОНЫ</div><div class="pkfa-settings-grid">${tiles.map(([id, icon, title, tone]) => `<button data-setting="${id}"><i class="tone-${tone}">${icon}</i><b>${title}</b><span>→</span></button>`).join('')}</div><section class="pkfa-tags-editor"><header><div><b>Быстрые теги</b><span>Отображаются под формой ответа</span></div></header><form data-tag-form><input name="title" required maxlength="32" placeholder="Название"><input name="text" required maxlength="500" placeholder="Текст для вставки"><button type="submit">Добавить</button></form><div>${tags || '<span class="pkfa-muted">Тегов пока нет</span>'}</div></section><div class="pkfa-section-label">ИНТЕРФЕЙС</div><section class="pkfa-appearance"><div><b>Акцент интерфейса</b><span>Выберите основной цвет Helper</span></div><div class="pkfa-accent-list"><button data-accent="gold" aria-label="Золотой акцент" class="gold${state.ui?.accent === 'gold' ? ' is-active' : ''}"></button><button data-accent="purple" aria-label="Фиолетовый акцент" class="purple${state.ui?.accent === 'purple' ? ' is-active' : ''}"></button><button data-accent="blue" aria-label="Синий акцент" class="blue${state.ui?.accent === 'blue' ? ' is-active' : ''}"></button></div></section><section class="pkfa-ui-options"><label><span>Масштаб Helper</span><select data-ui-scale><option value="compact"${state.ui?.scale === 'compact' ? ' selected' : ''}>Компактный</option><option value="normal"${state.ui?.scale === 'normal' ? ' selected' : ''}>Обычный</option><option value="large"${state.ui?.scale === 'large' ? ' selected' : ''}>Крупный</option></select></label><label><span>Панель под ответом</span><select data-inline-position><option value="below"${state.ui?.inlinePosition !== 'above' ? ' selected' : ''}>Снизу</option><option value="above"${state.ui?.inlinePosition === 'above' ? ' selected' : ''}>Сверху</option></select></label></section>`;
  }
  function renderScreen() {
    if (!screen) return;
    const views = { home: homeView, staff: staffView, replies: repliesView, tags: tagsView, replace: replaceView, rules: rulesView, complaints: complaintsView, analytics: analyticsView, history: historyView, settings: settingsView };
    screen.innerHTML = (views[activeRoute] || settingsView)();
    if (activeRoute === 'staff' && context.kind === 'staff') {
      const container = screen.querySelector?.('[data-staff-workspace-host]');
      if (container) root.PKFA?.staff?.mountWorkspace?.(container, { context, store: root.PKFA.store, notify });
    }
    const heading = screen.querySelector?.('.pkfa-page-head[tabindex]');
    heading?.focus?.();
  }
  function hasView(route) { return ROUTE_ORDER.includes(route); }
  function updateRoute(next) {
    if (activeRoute === 'staff' && next !== 'staff' && root.PKFA?.staff?.isDirty?.()) { notify('Сохраните или отмените черновик STAFF перед переходом.', 'warning'); return false; }
    if (!model.routes.includes(next)) next = preferredRoute(context); activeRoute = next;
    host.querySelectorAll('[data-route]').forEach((button) => { const active = button.getAttribute('data-route') === activeRoute; button.classList.toggle('is-active', active); button.setAttribute('aria-current', active ? 'page' : 'false'); });
    renderScreen(); root.PKFA.store?.update?.((nextState) => { nextState.ui.lastRoute = activeRoute; return nextState; }).then((saved) => { state = saved; }).catch(() => {});
    return true;
  }
  function findTemplate(id) { return (state.templates || []).find((item) => item.id === id); }
  function applyTemplateFilters() {
    const query = screen?.querySelector?.('[data-template-filter]')?.value || '';
    const category = screen?.querySelector?.('[data-template-category]')?.value || '';
    screen?.querySelectorAll?.('.pkfa-answer-card').forEach((card) => { card.hidden = !templateVisible({ title: card.dataset.templateSearch || '', category: card.dataset.category || '' }, { query, category }); });
  }
  function variables() { return root.PKFA.replies.collectVariables(root.document, context); }
  async function onClick(event) {
    const button = event.target?.closest?.('button'); if (!button) return;
    if (button.matches('[data-helper-toggle]')) return opened ? close() : open();
    if (button.matches('[data-helper-close]')) return close();
    if (button.matches('[data-collapse]')) { const helper = host.querySelector('.pkfa-helper'); const collapsed = !helper.classList.contains('is-collapsed'); helper.classList.toggle('is-collapsed', collapsed); button.setAttribute('aria-expanded', String(!collapsed)); state = await root.PKFA.store.update((next) => { next.ui.sidebarCollapsed = collapsed; return next; }); return; }
    if (button.hasAttribute('data-route')) return updateRoute(button.getAttribute('data-route'));
    if (button.hasAttribute('data-go-thread') && button.getAttribute('data-go-thread')) { root.location.href = button.getAttribute('data-go-thread'); return; }
    if (button.hasAttribute('data-new-template')) { screen.querySelector('[data-template-form]')?.classList.remove('is-hidden'); return; }
    if (button.hasAttribute('data-cancel-template')) { screen.querySelector('[data-template-form]')?.classList.add('is-hidden'); return; }
    if (button.hasAttribute('data-edit-template')) { const item = findTemplate(button.getAttribute('data-edit-template')); const form = screen.querySelector('[data-template-form]'); if (!item || !form) return; form.querySelector('[name="id"]').value = item.id; form.querySelector('[name="title"]').value = item.title || ''; form.querySelector('[name="category"]').value = item.category || ''; form.querySelector('[name="text"]').value = item.text || ''; form.classList.remove('is-hidden'); form.querySelector('[name="title"]')?.focus?.(); return; }
    if (button.hasAttribute('data-copy-template')) { const rendered = root.PKFA.replies.renderTemplate(findTemplate(button.getAttribute('data-copy-template'))?.text || '', variables()); return copyText(rendered.text, rendered.unknown.length ? `Скопировано; не заполнено: ${rendered.unknown.join(', ')}` : 'Шаблон скопирован'); }
    if (button.hasAttribute('data-preview-template')) { const rendered = root.PKFA.replies.renderTemplate(findTemplate(button.getAttribute('data-preview-template'))?.text || '', variables()); notify(rendered.unknown.length ? `Не заполнено: ${rendered.unknown.join(', ')}` : rendered.text.slice(0, 180), rendered.unknown.length ? 'warning' : 'info'); return; }
    if (button.hasAttribute('data-insert-template')) { const out = await replyController.insertTemplate(findTemplate(button.getAttribute('data-insert-template')), variables(), { applyReplacements: true, rules: state.replacements || [] }); notify(out.unknown?.length ? `Не заполнено: ${out.unknown.join(', ')}` : 'Ответ вставлен', out.unknown?.length ? 'warning' : 'success'); return; }
    if (button.hasAttribute('data-send-template')) { button.disabled = true; button.setAttribute('aria-busy', 'true'); try { const out = await replyController.sendTemplate(findTemplate(button.getAttribute('data-send-template')), variables(), context); notify(out.status === 'sent' ? 'Ответ отправлен' : out.error || out.status, out.status === 'sent' ? 'success' : 'danger'); } finally { button.disabled = false; button.removeAttribute('aria-busy'); } return; }
    if (button.hasAttribute('data-favorite-template')) { state = await root.PKFA.store.update((next) => { const item = next.templates.find((entry) => entry.id === button.getAttribute('data-favorite-template')); if (item) item.favorite = !item.favorite; return next; }); renderScreen(); notify('Избранное обновлено', 'success'); return; }
    if (button.hasAttribute('data-remove-template')) { state = await root.PKFA.store.update((next) => { next.templates = next.templates.filter((item) => item.id !== button.getAttribute('data-remove-template')); return next; }); renderScreen(); return; }
    if (button.hasAttribute('data-remove-tag')) { state = await root.PKFA.store.update((next) => { next.tags = (next.tags || []).filter((item) => item.id !== button.getAttribute('data-remove-tag')); return next; }); renderScreen(); root.PKFA.inlineToolbar?.unmount?.(root.document); root.PKFA.inlineToolbar?.mount?.(root.document, { context, state, actionExecutor, replyController }); notify('Тег удалён', 'success'); return; }
    if (button.hasAttribute('data-move-tag')) { const id = button.getAttribute('data-move-tag'); const from = (state.tags || []).findIndex((item) => item.id === id); const to = from + (button.getAttribute('data-direction') === 'up' ? -1 : 1); state = await root.PKFA.store.update((next) => { next.tags = root.PKFA.productivity.reorder(next.tags || [], from, to); return next; }); renderScreen(); return; }
    if (button.hasAttribute('data-insert-tag')) { const tag = (state.tags || []).find((item) => item.id === button.getAttribute('data-insert-tag')); if (!tag) return; const out = await replyController.insert(tag.text || tag.title || '', { applyReplacements: true, rules: state.replacements || [] }); notify(out.status === 'inserted' ? 'Тег вставлен' : 'Не удалось вставить тег', out.status === 'inserted' ? 'success' : 'danger'); return; }
    if (button.hasAttribute('data-discard-staff')) { await root.PKFA?.staff?.discardChanges?.(); renderScreen(); notify('Черновик STAFF отменён', 'success'); return; }
    if (button.hasAttribute('data-toggle-replacement')) { state = await root.PKFA.store.update((next) => { const item = (next.replacements || []).find((entry) => entry.id === button.getAttribute('data-toggle-replacement')); if (item) item.enabled = item.enabled === false; return next; }); renderScreen(); return; }
    if (button.hasAttribute('data-remove-replacement')) { state = await root.PKFA.store.update((next) => { next.replacements = (next.replacements || []).filter((item) => item.id !== button.getAttribute('data-remove-replacement')); return next; }); renderScreen(); return; }
    if (button.hasAttribute('data-copy-rule')) { const item = (state.rules || []).find((entry) => entry.id === button.getAttribute('data-copy-rule')); if (item) return copyText([item.title, item.text, item.url].filter(Boolean).join('\n'), 'Правило скопировано'); return; }
    if (button.hasAttribute('data-remove-rule')) { state = await root.PKFA.store.update((next) => { next.rules = (next.rules || []).filter((item) => item.id !== button.getAttribute('data-remove-rule')); return next; }); renderScreen(); return; }
    if (button.hasAttribute('data-complaint-status')) { if (!context.isComplaint) return notify('Статусы доступны только в теме жалобы', 'warning'); const status = button.getAttribute('data-complaint-status'); const card = root.PKFA.complaints.buildCard(root.document, context); await root.PKFA.history.add({ action: 'complaint-status', status, threadId: context.threadId, title: context.title, section: card.section, ok: true }); state = await root.PKFA.store.getState(); renderScreen(); notify('Локальный статус сохранён в аналитике', 'success'); return; }
    if (button.hasAttribute('data-range')) { state = await root.PKFA.store.update((next) => { next.complaints.analyticsRange = button.getAttribute('data-range'); return next; }); renderScreen(); return; }
    if (button.hasAttribute('data-clear-history')) { const step = nextConfirmState(clearHistoryArmedUntil); clearHistoryArmedUntil = step.armedUntil; if (!step.execute) { renderScreen(); notify('Нажмите «Нажмите ещё раз» в течение 5 секунд', 'warning'); return; } await root.PKFA.history.clear(); state = await root.PKFA.store.getState(); renderScreen(); notify('История очищена', 'success'); return; }
    if (button.hasAttribute('data-export-history')) return copyText(await root.PKFA.history.exportJson(), 'История скопирована');
    if (button.hasAttribute('data-export-analytics')) return copyText(JSON.stringify(root.PKFA.complaints.summarize(state.history || [], analyticsBounds(state.complaints?.analyticsRange || '30d')), null, 2), 'Отчёт скопирован');
    if (button.hasAttribute('data-export-settings')) return copyText(root.PKFA.preferences.exportSettings(state), 'Настройки скопированы');
    if (button.hasAttribute('data-import-settings')) { screen.querySelector('[data-import-file]')?.click(); return; }
    if (button.hasAttribute('data-setting')) { const target = button.getAttribute('data-setting'); if (model.routes.includes(target)) return updateRoute(target); notify('Настройка доступна в этом разделе', 'info'); return; }
    if (button.hasAttribute('data-accent')) { state = await root.PKFA.store.update((next) => { next.ui.accent = button.getAttribute('data-accent'); return next; }); host.dataset.accent = state.ui.accent; renderScreen(); }
  }
  async function copyText(text, message) { try { await root.navigator?.clipboard?.writeText?.(text); notify(message, 'success'); } catch (_) { notify('Не удалось скопировать', 'danger'); } }
  async function onChange(event) {
    if (event.target?.matches?.('[data-import-file]')) { const file = event.target.files?.[0]; if (!file) return; const input = await file.text(); const preview = root.PKFA.preferences.describeImport(input); if (!preview.ok) return notify(preview.errors.join('. '), 'danger'); const approved = typeof root.confirm !== 'function' || root.confirm(`Импортировать группы: ${preview.groups.join(', ') || 'нет изменений'}?`); if (!approved) return notify('Импорт отменён', 'info'); const result = await root.PKFA.preferences.applyImport(input); if (!result.ok) return notify(result.errors.join('. '), 'danger'); state = result.value; model = dashboardModel(context, state); renderShell(); notify('Настройки импортированы', 'success'); return; }
    if (event.target?.matches?.('[data-template-category]')) { applyTemplateFilters(); return; }
    if (event.target?.matches?.('[data-history-action], [data-history-result]')) { historyFilters[event.target.matches('[data-history-action]') ? 'action' : 'result'] = event.target.value; renderScreen(); return; }
    if (event.target?.matches?.('[data-ui-scale], [data-inline-position]')) { const key = event.target.matches('[data-ui-scale]') ? 'scale' : 'inlinePosition'; state = await root.PKFA.store.update((next) => { next.ui[key] = event.target.value; return next; }); renderShell(); root.PKFA.inlineToolbar?.unmount?.(root.document); root.PKFA.inlineToolbar?.mount?.(root.document, { context, state, actionExecutor, replyController }); notify('Настройка применена', 'success'); }
  }
  function onInput(event) {
    if (event.target?.matches?.('[data-template-filter]')) { applyTemplateFilters(); return; }
    if (event.target?.matches?.('[data-rule-filter]')) { const query = event.target.value.trim().toLowerCase(); screen?.querySelectorAll?.('[data-rule-search]').forEach((card) => { card.hidden = !!query && !String(card.dataset.ruleSearch || '').includes(query); }); return; }
    if (event.target?.matches?.('[data-history-query]')) { historyFilters.query = event.target.value; clearTimeout(event.target.__historyTimer); event.target.__historyTimer = setTimeout(() => renderScreen(), 250); }
  }
  async function onSubmit(event) {
    if (event.target?.matches?.('[data-template-form]')) { event.preventDefault(); const data = new FormData(event.target); const editingId = String(data.get('id') || ''); const item = { id: editingId || `custom:${Date.now()}`, title: String(data.get('title') || '').trim(), category: String(data.get('category') || '').trim() || 'Мои шаблоны', text: String(data.get('text') || '').trim(), color: 'purple', custom: true, favorite: false }; if (!item.title || !item.text) return; state = await root.PKFA.store.update((next) => { const index = next.templates.findIndex((entry) => entry.id === editingId); if (index >= 0) next.templates[index] = { ...next.templates[index], ...item }; else next.templates.push(item); return next; }); renderScreen(); notify(editingId ? 'Шаблон обновлён' : 'Шаблон добавлен', 'success'); return; }
    if (event.target?.matches?.('[data-tag-form]')) { event.preventDefault(); const data = new FormData(event.target); const title = String(data.get('title') || '').trim(); const text = String(data.get('text') || '').trim(); const group = String(data.get('group') || '').trim() || 'Общие'; if (!title || !text) return; const tag = { id: `tag:${Date.now()}`, title, text, group }; state = await root.PKFA.store.update((next) => { next.tags = [...(next.tags || []), tag].slice(-30); return next; }); renderScreen(); root.PKFA.inlineToolbar?.unmount?.(root.document); root.PKFA.inlineToolbar?.mount?.(root.document, { context, state, actionExecutor, replyController }); notify('Быстрый тег добавлен', 'success'); }
    if (event.target?.matches?.('[data-replacement-form]')) { event.preventDefault(); const data = new FormData(event.target); const item = { id: `replace:${Date.now()}`, from: String(data.get('from') || '').trim(), to: String(data.get('to') || '').trim(), enabled: true }; const checked = root.PKFA.productivity.validateReplacement(item); if (!checked.ok) return notify('Проверьте сокращение и текст замены', 'danger'); const setCheck = root.PKFA.productivity.validateReplacementSet([...(state.replacements || []), checked.value]); if (!setCheck.ok) return notify('Циклическая автозамена запрещена', 'danger'); state = await root.PKFA.store.update((next) => { next.replacements = [...(next.replacements || []), checked.value].slice(-100); return next; }); renderScreen(); notify('Автозамена добавлена', 'success'); return; }
    if (event.target?.matches?.('[data-rule-form]')) { event.preventDefault(); const data = new FormData(event.target); const item = { id: `rule:${Date.now()}`, title: String(data.get('title') || '').trim(), category: String(data.get('category') || '').trim(), text: String(data.get('text') || '').trim(), url: String(data.get('url') || '').trim() }; if (!item.title || !item.text) return notify('Заполните название и текст правила', 'danger'); state = await root.PKFA.store.update((next) => { next.rules = [...(next.rules || []), item].slice(-500); return next; }); renderScreen(); notify('Правило добавлено', 'success'); return; }
  }
  function renderShell() { const keepOpen = opened; host.innerHTML = shellTemplate(model, activeRoute, !!state.ui?.sidebarCollapsed); overlay = host.querySelector('[data-helper-overlay]'); screen = host.querySelector('[data-screen]'); toast = host.querySelector('[data-toast]'); host.dataset.accent = state.ui?.accent || 'gold'; host.dataset.scale = state.ui?.scale || 'normal'; if (keepOpen) setOpen(true); renderScreen(); }
  async function rememberRecentThread() {
    if (!context?.threadId || !root.PKFA?.store?.update) return;
    const current = (state.recentThreads || []).find((item) => String(item.threadId) === String(context.threadId));
    if (current?.title === context.title && current?.url === root.location.href) return;
    state = await root.PKFA.store.update((next) => { const item = { threadId: context.threadId, title: context.title, url: root.location.href }; next.recentThreads = [...(next.recentThreads || []).filter((x) => String(x.threadId) !== String(item.threadId)), item].slice(-12); return next; });
  }
  async function refreshContext() {
    const next = root.PKFA.context.inspectDocument(root.document, root.location); const pageChanged = next.threadId !== context.threadId || next.kind !== context.kind; context = next;
    if (context.threadId) state = await root.PKFA.store.update((current) => { const item = { threadId: context.threadId, title: context.title, url: root.location.href }; current.recentThreads = [...(current.recentThreads || []).filter((x) => x.threadId !== item.threadId), item].slice(-12); return current; }); else state = await root.PKFA.store.getState();
    model = dashboardModel(context, state); if (pageChanged || !model.routes.includes(activeRoute)) activeRoute = preferredRoute(context); renderShell(); root.PKFA.inlineToolbar?.unmount?.(root.document); root.PKFA.inlineToolbar?.mount?.(root.document, { context, state, actionExecutor, replyController });
  }
  async function boot(options = {}) {
    const doc = options.document || root.document;
    const existing = doc.getElementById('pkfa-root');
    if (existing) {
      const previousContext = context || {};
      state = options.state || await root.PKFA.store.getState();
      context = options.context || root.PKFA.context.inspectDocument(doc, root.location);
      const pageChanged = previousContext.threadId !== context.threadId || previousContext.kind !== context.kind;
      if (pageChanged) await rememberRecentThread();
      model = dashboardModel(context, state);
      if ((pageChanged || !model.routes.includes(activeRoute)) && !root.PKFA?.staff?.isDirty?.()) activeRoute = preferredRoute(context);
      if (!root.PKFA?.staff?.isDirty?.()) renderShell();
      return { mounted: false, updated: true, reason: 'exists', root: doc.getElementById('pkfa-app-root') || existing };
    }
    state = options.state || await root.PKFA.store.getState(); context = options.context || root.PKFA.context.inspectDocument(doc, root.location); await rememberRecentThread(); model = dashboardModel(context, state); activeRoute = model.routes.includes(state.ui?.lastRoute) ? state.ui.lastRoute : preferredRoute(context); actionExecutor = options.actionExecutor || new root.PKFA.actions.ActionExecutor(); replyController = options.replyController || new root.PKFA.replies.ReplyController();
    let appRoot = doc.getElementById('pkfa-app-root');
    if (!appRoot) { appRoot = doc.createElement('div'); appRoot.id = 'pkfa-app-root'; appRoot.dataset.pkfaOwned = 'true'; doc.documentElement.appendChild(appRoot); }
    host = doc.createElement('div'); host.id = 'pkfa-root'; host.dataset.pkfaOwned = 'true'; appRoot.appendChild(host); host.addEventListener('click', onClick); host.addEventListener('change', onChange); host.addEventListener('input', onInput); host.addEventListener('submit', onSubmit);
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && opened) { event.preventDefault?.(); close(); return; }
      if (event.key !== 'Tab' || !opened) return;
      const selector = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]';
      const focusable = [...(overlay?.querySelectorAll?.(selector) || [])].filter((item) => !item.hidden && item.getAttribute?.('aria-hidden') !== 'true');
      const staffHost = screen?.querySelector?.('[data-staff-workspace-host]')?.firstElementChild;
      focusable.push(...(staffHost?.shadowRoot?.querySelectorAll?.(selector) || []));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      const active = staffHost?.shadowRoot?.activeElement || root.document.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault?.(); last.focus?.(); }
      else if (!event.shiftKey && active === last) { event.preventDefault?.(); first.focus?.(); }
    });
    root.addEventListener('PKFA_TOGGLE_HELPER', () => { if (opened) close(); else open(); });
    root.chrome.runtime.onMessage.addListener((message, _sender, respond) => { if (message?.type === 'PKFA_TOGGLE') { if (opened) close(); else open(); respond?.({ ok: true }); } });
    renderShell(); root.PKFA.inlineToolbar?.mount?.(root.document, { context, state, actionExecutor, replyController });
    return { mounted: true, root: appRoot, host };
  }
  function mount(doc = root.document, deps = {}) { return boot({ ...deps, document: doc }); }
  return { tabsForKind, preferredTab, actionTone, layoutForWidth, debounce, esc, routesForContext, preferredRoute, sidebarMode, filterTemplates, templateVisible, filterHistory, nextConfirmState, analyticsBounds, closeDecision, dashboardModel, shellTemplate, staffViewTemplate, hasView, boot, mount, open, close };
});
