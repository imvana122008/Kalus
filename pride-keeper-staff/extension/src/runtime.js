(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PKFA = root.PKFA || {};
  root.PKFA.runtime = api;
  if (root.document && root.chrome?.runtime?.id) api.start();
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  'use strict';

  function debounce(fn, delay = 150) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function createRuntime(options = {}) {
    const contextApi = options.context || root.PKFA?.context;
    const Registry = root.PKFA?.actionRegistry?.ActionRegistry;
    const registry = options.registry || (Registry ? new Registry() : null);
    const store = options.store || root.PKFA?.store;
    const panel = options.panel || root.PKFA?.panel;
    const inlineToolbar = options.inlineToolbar || root.PKFA?.inlineToolbar;
    const actionExecutor = options.actionExecutor || (root.PKFA?.actions?.ActionExecutor ? new root.PKFA.actions.ActionExecutor() : null);
    const replyController = options.replyController || (root.PKFA?.replies?.ReplyController ? new root.PKFA.replies.ReplyController() : null);
    let observer = null;
    let started = false;

    function nodeIsOwned(node) {
      return node?.nodeType === 1 && !!contextApi?.isOwnedNode?.(node);
    }

    function mutationNeedsRefresh(record = {}) {
      if (nodeIsOwned(record.target)) return false;
      const changed = [...(record.addedNodes || []), ...(record.removedNodes || [])]
        .filter((node) => node?.nodeType === 1);
      return changed.length === 0 || changed.some((node) => !nodeIsOwned(node));
    }

    function ensureSingleRoot(doc, id, create) {
      const matches = [...(doc?.querySelectorAll?.(`#${id}`) || [])];
      let first = matches.shift() || null;
      if (!first && create) first = create();
      matches.forEach((duplicate) => duplicate.remove?.());
      if (first?.dataset) first.dataset.pkfaOwned = 'true';
      return first;
    }

    function ensureSingleSelector(doc, selector) {
      const matches = [...(doc?.querySelectorAll?.(selector) || [])];
      const first = matches.shift() || null;
      matches.forEach((duplicate) => duplicate.remove?.());
      return first;
    }

    async function refresh(doc = root.document, loc = root.location) {
      if (!contextApi?.inspectDocument) throw new Error('ContextScanner недоступен');
      if (!registry?.replace) throw new Error('ActionRegistry недоступен');
      const context = contextApi.inspectDocument(doc, loc);
      context.actions = registry.replace(context.actions || []);
      const state = await store?.getState?.() || {};
      await panel?.mount?.(doc, { context, state, registry, actionExecutor, replyController });
      await inlineToolbar?.mount?.(doc, { context, state, registry, actionExecutor, replyController });
      ensureSingleRoot(doc, 'pkfa-app-root');
      ensureSingleRoot(doc, 'pkfa-inline-root');
      ensureSingleSelector(doc, '[data-pkfa-launcher]');
      return { context, state, actions: registry.list() };
    }

    async function start(doc = root.document, loc = root.location) {
      if (started) return { started: false, reason: 'already-started', registry };
      started = true;
      await refresh(doc, loc);
      const schedule = debounce(() => refresh(doc, root.location), 150);
      const Observer = options.MutationObserver || root.MutationObserver;
      if (Observer && doc?.body) {
        observer = new Observer((records) => {
          if (records.some(mutationNeedsRefresh)) schedule();
        });
        observer.observe(doc.body, { childList: true, subtree: true });
      }
      root.addEventListener?.('popstate', schedule);
      return { started: true, registry };
    }

    return { registry, nodeIsOwned, mutationNeedsRefresh, ensureSingleRoot, refresh, start, stop: () => observer?.disconnect?.() };
  }

  const singleton = createRuntime();
  return { createRuntime, ...singleton };
});
