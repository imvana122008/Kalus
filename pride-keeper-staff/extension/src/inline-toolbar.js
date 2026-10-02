(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.inlineToolbar = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const ROOT_ID = 'pkfa-inline-root';
  const ACTION_LABELS = {
    edit: 'Редактировать тему', close: 'Закрыть', open: 'Открыть', pin: 'Закрепить',
    unpin: 'Открепить', move: 'Переместить', delete: 'Удалить тему'
  };

  function esc(value = '') {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  function findQuickReply(doc = root.document) {
    const forms = [...(doc?.querySelectorAll?.('form') || [])];
    return forms.find((form) => {
      const action = form.getAttribute?.('action') || '';
      if (/\/posts\/\d+\/edit/i.test(action)) return false;
      const replyAction = /add-reply|quick-reply|\/reply(?:$|[/?#])/i.test(action) || /quick-reply/i.test(form.getAttribute?.('data-xf-init') || '');
      const editor = form.querySelector?.('textarea[name="message"], textarea[name="message_html"], .fr-element[contenteditable="true"], [contenteditable="true"][role="textbox"]');
      return replyAction && !!editor;
    }) || null;
  }

  function toolbarModel(context = {}, state = {}, actions = context.actions || []) {
    const statuses = context.isComplaint ? (root.PKFA?.complaints?.STATUSES || [
      { id: 'resolved', label: 'Рассмотрено', tone: 'success' },
      { id: 'denied', label: 'Отказано', tone: 'danger' },
      { id: 'pending', label: 'На рассмотрении', tone: 'info' },
      { id: 'senior-review', label: 'На рассмотрение ГА', tone: 'purple' },
      { id: 'punishment-removed', label: 'Наказание снято', tone: 'neutral' },
      { id: 'punishment-reduced', label: 'Наказание снижено', tone: 'warning' }
    ]) : [];
    const unique = [...new Map(actions.map((item) => {
      const key = item.fingerprint || [item.type, item.href, item.threadId, item.postId, item.controlName].map((value) => String(value || '')).join('|');
      return [key, { ...item, fingerprint: key }];
    })).values()];
    const templates = Array.isArray(state.templates) ? state.templates : [];
    return {
      actions: unique,
      statuses,
      tags: Array.isArray(state.tags) ? state.tags : [],
      templates,
      threadId: context.threadId || ''
    };
  }

  function placementForState(state = {}) {
    return state?.ui?.inlinePosition === 'above' ? 'above' : 'below';
  }

  function render(model) {
    const actions = model.actions.map((action) => {
      const label = action.type === 'edit' && /\/posts\/\d+\/edit/i.test(action.href || '') ? `Изменить сообщение${action.postId ? ` #${action.postId}` : ''}` : (ACTION_LABELS[action.type] || action.type);
      return `<button type="button" class="pkfa-inline__chip" data-pkfa-owned="true" data-pkfa-action-key="${esc(action.fingerprint)}">${esc(label)}</button>`;
    }).join('');
    const statuses = model.statuses.map((status) => `<button type="button" class="pkfa-inline__chip pkfa-inline__chip--${esc(status.tone)}" data-pkfa-owned="true" data-pkfa-status="${esc(status.id)}">${esc(status.label)}</button>`).join('');
    const tags = model.tags.map((tag) => `<button type="button" class="pkfa-inline__tag" data-pkfa-owned="true" data-pkfa-tag="${esc(tag.id)}">${esc(tag.title || tag.text)}</button>`).join('');
    const templates = (model.templates || []).map((template) => `<button type="button" class="pkfa-inline__tag pkfa-inline__template" data-pkfa-owned="true" data-pkfa-template="${esc(template.id)}">${esc(template.title || template.text)}</button>`).join('');
    return `<div class="pkfa-inline__row pkfa-inline__row--actions"><button type="button" class="pkfa-inline__helper" data-pkfa-owned="true" data-pkfa-open>PK</button>${actions || '<span class="pkfa-inline__muted">Нет доступных команд темы</span>'}</div>${statuses ? `<div class="pkfa-inline__row pkfa-inline__row--statuses">${statuses}</div>` : ''}${templates ? `<div class="pkfa-inline__row pkfa-inline__row--templates"><span class="pkfa-inline__label">Быстрые ответы</span>${templates}</div>` : ''}${tags ? `<div class="pkfa-inline__row pkfa-inline__row--tags">${tags}</div>` : ''}<span class="pkfa-inline__notice" data-pkfa-notice role="status" aria-live="polite"></span>`;
  }

  function mount(doc = root.document, deps = {}) {
    const form = findQuickReply(doc);
    if (!form) return { mounted: false, reason: 'missing-reply' };
    const context = deps.context || root.PKFA?.context?.inspectDocument?.(doc, root.location) || {};
    const state = deps.state || {};
    const registryActions = deps.registry?.list?.() || context.actions || [];
    const model = toolbarModel(context, state, registryActions);
    const executor = deps.actionExecutor || (root.PKFA?.actions?.ActionExecutor ? new root.PKFA.actions.ActionExecutor() : null);
    const replies = deps.replyController || (root.PKFA?.replies?.ReplyController ? new root.PKFA.replies.ReplyController() : null);
    const history = deps.history || root.PKFA?.history;
    const existing = doc?.getElementById?.(ROOT_ID);
    if (existing) {
      existing.innerHTML = render(model);
      if (existing.__pkfaController) {
        Object.assign(existing.__pkfaController, { model, state, executor, replies, history, context });
        for (const key of existing.__pkfaController.busy || []) {
          const pending = [...(existing.querySelectorAll?.('[data-pkfa-action-key]') || [])].find((item) => item.getAttribute('data-pkfa-action-key') === key);
          if (pending) { pending.disabled = true; pending.setAttribute('aria-busy', 'true'); }
        }
      }
      return { mounted: false, updated: true, reason: 'exists', root: existing, model };
    }
    const element = doc.createElement('section');
    element.id = ROOT_ID;
    element.className = 'pkfa-inline';
    element.dataset.pkfaOwned = 'true';
    element.innerHTML = render(model);
    const controller = { model, state, executor, replies, history, context, busy: new Set() };
    element.__pkfaController = controller;
    const notice = (message, tone = 'info') => {
      const target = element.querySelector?.('[data-pkfa-notice]');
      if (!target) return;
      target.textContent = message;
      target.dataset.tone = tone;
    };
    element.addEventListener('click', async (event) => {
      const button = event.target?.closest?.('button');
      if (!button) return;
      if (button.hasAttribute('data-pkfa-open')) {
        root.dispatchEvent?.(new Event('PKFA_TOGGLE_HELPER'));
        return;
      }
      if (button.hasAttribute('data-pkfa-action-key')) {
        const action = controller.model.actions.find((item) => item.fingerprint === button.getAttribute('data-pkfa-action-key'));
        if (!action || !controller.executor) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        controller.busy.add(action.fingerprint);
        try {
          const result = await controller.executor.run(action);
          notice(result?.status === 'success' ? 'Команда выполнена' : result?.error || 'Команда отклонена', result?.status === 'success' ? 'success' : 'danger');
        } catch (error) { notice(error?.message || 'Ошибка команды', 'danger'); }
        finally { controller.busy.delete(action.fingerprint); const current = [...(element.querySelectorAll?.('[data-pkfa-action-key]') || [])].find((item) => item.getAttribute('data-pkfa-action-key') === action.fingerprint); if (current) { current.disabled = false; current.removeAttribute('aria-busy'); } }
        return;
      }
      if (button.hasAttribute('data-pkfa-status')) {
        const status = button.getAttribute('data-pkfa-status');
        const template = (controller.state.templates || []).find((item) => item.status === status || item.id === `complaint-${status}`);
        if (template && controller.replies) await controller.replies.insertTemplate(template, root.PKFA?.replies?.collectVariables?.(doc, controller.context) || {}, { applyReplacements: true, rules: controller.state.replacements || [] });
        await controller.history?.add?.({ action: 'complaint-status', status, threadId: controller.context.threadId || '', title: controller.context.title || '', section: root.PKFA?.complaints?.buildCard?.(doc, controller.context)?.section || '', ok: true });
        element.querySelectorAll?.('[data-pkfa-status]').forEach((item) => item.classList.toggle('is-active', item === button));
        notice('Статус сохранён', 'success');
        return;
      }
      if (button.hasAttribute('data-pkfa-template')) {
        const template = (controller.model.templates || []).find((item) => item.id === button.getAttribute('data-pkfa-template'));
        if (!template || !controller.replies) return;
        const result = await controller.replies.insertTemplate(template, root.PKFA?.replies?.collectVariables?.(doc, controller.context) || {}, { applyReplacements: true, rules: controller.state.replacements || [] });
        notice(result?.unknown?.length ? `Вставлено; не заполнено: ${result.unknown.join(', ')}` : 'Быстрый ответ вставлен', result?.unknown?.length ? 'warning' : 'success');
        return;
      }
      if (button.hasAttribute('data-pkfa-tag')) {
        const tag = controller.model.tags.find((item) => item.id === button.getAttribute('data-pkfa-tag'));
        if (tag && controller.replies) { await controller.replies.insert(tag.text || tag.title || '', { applyReplacements: true, rules: controller.state.replacements || [] }); notice('Тег вставлен', 'success'); }
      }
    });
    if (placementForState(state) === 'above') form.parentNode?.insertBefore?.(element, form);
    else if (form.nextSibling && form.parentNode?.insertBefore) form.parentNode.insertBefore(element, form.nextSibling);
    else form.parentNode?.appendChild?.(element);
    return { mounted: true, root: element, model };
  }

  function unmount(doc = root.document) {
    const element = doc?.getElementById?.(ROOT_ID);
    element?.remove?.();
    return !!element;
  }

  return { ROOT_ID, ACTION_LABELS, findQuickReply, toolbarModel, placementForState, render, mount, unmount };
});
