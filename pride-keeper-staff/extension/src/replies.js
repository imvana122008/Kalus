(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.replies = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  'use strict';

  function renderTemplate(template = '', variables = {}) {
    const unknown = [];
    const text = String(template).replace(/\{([a-z_][a-z0-9_]*)\}/gi, (match, key) => {
      const value = variables[key];
      if (value === undefined || value === null || value === '') {
        if (!unknown.includes(key)) unknown.push(key);
        return match;
      }
      return String(value);
    });
    return { text, unknown };
  }

  function findReplyForm(doc = root.document) {
    const forms = [...(doc?.querySelectorAll?.('form') || [])];
    return forms.find((form) => {
      const action = form.getAttribute('action') || '';
      const hasEditor = !!form.querySelector('textarea[name="message"], textarea[name="message_html"], .fr-element[contenteditable="true"], [contenteditable="true"][role="textbox"]');
      return hasEditor && (/add-reply|\/reply|quick-reply/i.test(action) || /quick-reply/i.test(form.getAttribute('data-xf-init') || ''));
    }) || null;
  }

  function setNativeValue(element, value) {
    if (!element) return false;
    if ('value' in element && /^(TEXTAREA|INPUT)$/i.test(element.tagName || '')) {
      const proto = /TEXTAREA/i.test(element.tagName) ? root.HTMLTextAreaElement?.prototype : root.HTMLInputElement?.prototype;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(element, value); else element.value = value;
    } else if (element.isContentEditable || element.getAttribute?.('contenteditable') === 'true') {
      element.innerText = value;
    } else return false;
    element.dispatchEvent?.(new Event('input', { bubbles: true }));
    element.dispatchEvent?.(new Event('change', { bubbles: true }));
    return true;
  }

  function setReplyText(text, form = findReplyForm()) {
    if (!form) throw new Error('Форма ответа не найдена');
    const editors = [...form.querySelectorAll('textarea[name="message"], textarea[name="message_html"], .fr-element[contenteditable="true"], [contenteditable="true"][role="textbox"]')];
    if (!editors.length) throw new Error('Редактор ответа не найден');
    editors.forEach((editor) => setNativeValue(editor, text));
    const visible = editors.find((editor) => !!(editor.offsetWidth || editor.offsetHeight || editor.getClientRects?.().length));
    visible?.focus?.();
  }

  function submitReply(form = findReplyForm()) {
    if (!form) throw new Error('Форма ответа не найдена');
    const buttons = [...form.querySelectorAll('button[type="submit"], input[type="submit"]')];
    const submit = buttons.find((button) => /ответить|отправить|reply|submit/i.test(button.value || button.textContent || '')) || buttons[0];
    if (!submit) throw new Error('Кнопка отправки не найдена');
    if (form.requestSubmit) form.requestSubmit(submit); else submit.click();
  }

  function collectVariables(doc = root.document, context = {}) {
    const firstPost = doc?.querySelector?.('article.message, .message, [id^="post-"]');
    const author = firstPost?.querySelector?.('[data-xf-init="member-tooltip"], .message-name a, .username')?.textContent?.trim() || '';
    const admin = doc?.querySelector?.('a[href="/account/"], .p-navgroup-link--user')?.textContent?.trim() || '';
    return {
      author,
      accused: '',
      admin,
      thread_id: context.threadId || '',
      thread_title: context.title || '',
      date: new Date().toLocaleDateString('ru-RU')
    };
  }

  class ReplyController {
    constructor(options = {}) {
      this.setText = options.setText || ((text) => setReplyText(text));
      this.submit = options.submit || (() => submitReply());
      this.onHistory = options.onHistory || ((entry) => root.PKFA.history?.add?.(entry));
      this.sending = false;
    }

    async insert(text, options = {}) {
      const transformed = options.applyReplacements
        ? root.PKFA?.productivity?.applyReplacements?.(text, options.rules || []) ?? text
        : text;
      const clean = String(transformed || '').trim();
      if (!clean) return { status: 'empty' };
      await this.setText(clean);
      return { status: 'inserted', text: clean };
    }

    async send(text, meta = {}) {
      const clean = String(text || '').trim();
      if (!clean) return { status: 'empty' };
      if (this.sending) return { status: 'blocked' };
      this.sending = true;
      try {
        await this.setText(clean);
        await this.submit();
        await this.onHistory?.({ action: 'reply', threadId: meta.threadId || '', title: meta.title || '', ok: true, text: clean });
        return { status: 'sent', text: clean };
      } catch (error) {
        await this.onHistory?.({ action: 'reply', threadId: meta.threadId || '', title: meta.title || '', ok: false, error: error?.message || String(error) });
        return { status: 'error', error: error?.message || String(error) };
      } finally {
        this.sending = false;
      }
    }

    async insertTemplate(template, variables, options = {}) {
      const rendered = renderTemplate(template?.text || template || '', variables);
      await this.insert(rendered.text, options);
      return { status: 'inserted', ...rendered };
    }

    async sendTemplate(template, variables, meta = {}) {
      const rendered = renderTemplate(template?.text || template || '', variables);
      if (rendered.unknown.length) return { status: 'unknown-variables', ...rendered };
      return this.send(rendered.text, meta);
    }
  }

  return { renderTemplate, findReplyForm, setNativeValue, setReplyText, submitReply, collectVariables, ReplyController };
});
