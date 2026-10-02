const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadLogic() {
  const scriptPath = path.join(__dirname, '..', 'src', 'staff.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const marker = '  // ---------------- UI ----------------';
  const beforeUi = source.slice(0, source.indexOf(marker));

  class FakeElement {
    constructor({ text = '', value = '', attrs = {}, rect = { width: 10, height: 10 } } = {}) {
      this.textContent = text;
      this.value = value;
      this.attrs = attrs;
      this.rect = rect;
      this.isContentEditable = false;
      this.clicked = 0;
      this.classList = { contains: () => false };
    }

    getAttribute(name) { return this.attrs[name] ?? null; }
    getBoundingClientRect() { return this.rect; }
    dispatchEvent() {}
    click() { this.clicked += 1; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
  }

  class FakeTextArea extends FakeElement {}

  class FakeForm extends FakeElement {
    constructor({ action, editor = null, save = null, sourceToggle = null }) {
      super({ attrs: { action } });
      this.editor = editor;
      this.save = save;
      this.sourceToggle = sourceToggle;
    }

    querySelector(selector) {
      if (selector === 'input[name="title"], input[name="subject"]') return null;
      if (selector === 'button[data-cmd="xfBbCode"]') return this.sourceToggle;
      return null;
    }

    querySelectorAll(selector) {
      if (selector.includes('textarea[name="message"]')) {
        return this.editor ? [this.editor] : [];
      }
      if (selector.includes('button[type="submit"]')) {
        return this.save ? [this.save] : [];
      }
      return [];
    }
  }

  const forms = [];
  const memory = {};
  const documentMock = {
    querySelector: () => null,
    querySelectorAll: (selector) => selector === 'form' ? forms : []
  };
  const locationMock = { href: 'https://forum.pridekeeper.tech/posts/4425/edit#pkfa-staff-publish', pathname: '/posts/4425/edit', hash: '#pkfa-staff-publish', origin: 'https://forum.pridekeeper.tech' };
  const sandbox = {
    window: {},
    document: documentMock,
    location: locationMock,
    chrome: { storage: { local: {
      get: async (keys) => Object.fromEntries((keys || []).filter((key) => key in memory).map((key) => [key, memory[key]])),
      set: async (values) => Object.assign(memory, values),
      remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete memory[key]; }
    } } },
    CSS: { escape: (value) => value },
    Element: FakeElement,
    HTMLTextAreaElement: FakeTextArea,
    HTMLInputElement: class extends FakeElement {},
    Event: class {},
    InputEvent: class {},
    Image: class {},
    URL,
    setTimeout,
    clearTimeout,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    console,
    __staffExports: {}
  };
  sandbox.window = sandbox;

  const instrumented = `${beforeUi}\nObject.assign(__staffExports, { serializeCode, mergeSnapshot, findPostEditForm, completePendingPublishOnEditPage, autoSaveCodeToForum, findFirstPostEdit, mountWorkspace, isDirty, discardChanges, preparePublish, allowedSection, getState, setState, buildSelectModel: typeof buildSelectModel === 'function' ? buildSelectModel : undefined, nextSelectIndex: typeof nextSelectIndex === 'function' ? nextSelectIndex : undefined });\n})();`;
  vm.runInNewContext(instrumented, sandbox, { filename: 'PRIDE_KEEPER_Staff.js' });

  return { ...sandbox.__staffExports, forms, memory, documentMock, locationMock, FakeElement, FakeTextArea, FakeForm };
}

test('custom staff dropdown exposes dark menu options with one selected item', () => {
  const { buildSelectModel } = loadLogic();
  const model = buildSelectModel?.([
    { value: 'management', label: 'Руководство', tone: '#ff5365' },
    { value: 'main-mod', label: 'Главная модерация', tone: '#4ed35d' }
  ], 'main-mod');

  assert.deepEqual(JSON.parse(JSON.stringify(model)), {
    selected: { value: 'main-mod', label: 'Главная модерация', tone: '#4ed35d', selected: true },
    options: [
      { value: 'management', label: 'Руководство', tone: '#ff5365', selected: false },
      { value: 'main-mod', label: 'Главная модерация', tone: '#4ed35d', selected: true }
    ]
  });
});

test('custom staff dropdown keyboard navigation wraps around', () => {
  const { nextSelectIndex } = loadLogic();
  assert.equal(nextSelectIndex?.(0, -1, 5), 4);
  assert.equal(nextSelectIndex?.(4, 1, 5), 0);
  assert.equal(nextSelectIndex?.(2, 1, 5), 3);
});

test('serializeCode removes redundant forum bbWrapper shells', () => {
  const { serializeCode } = loadLogic();
  const inner = {
    outerHTML: '<div class="bbWrapper"><section id="management">staff</section></div>',
    classList: { contains: (name) => name === 'bbWrapper' },
    childNodes: [],
    querySelector: (selector) => selector.includes('#management') ? {} : null
  };
  const middle = {
    outerHTML: `<div class="bbWrapper">${inner.outerHTML}</div>`,
    classList: { contains: (name) => name === 'bbWrapper' },
    childNodes: [inner],
    querySelector: (selector) => selector.includes('#management') ? {} : null
  };
  const outer = {
    outerHTML: `<div class="bbWrapper">${middle.outerHTML}</div>`,
    classList: { contains: (name) => name === 'bbWrapper' },
    childNodes: [middle],
    querySelector: (selector) => selector.includes('#management') ? {} : null
  };

  assert.equal(
    serializeCode(outer),
    '[PARSEHTML]\n<div class="bbWrapper"><section id="management">staff</section></div>\n[/PARSEHTML]'
  );
});

test('publish accepts only the first visible post edit href in thread 1623', () => {
  const { findFirstPostEdit } = loadLogic();
  const context = { threadId: '1623', postIds: ['4425', '4426'], actions: [
    { type: 'edit', postId: '4426', href: '/posts/4426/edit' },
    { type: 'edit', postId: '4425', href: '/posts/4425/edit' }
  ] };

  assert.equal(findFirstPostEdit(context).href, '/posts/4425/edit');
  assert.equal(findFirstPostEdit({ ...context, threadId: '77' }), null);
  assert.equal(findFirstPostEdit({ ...context, actions: [{ type: 'edit', postId: '4425', href: 'https://evil.example/posts/4425/edit' }] }), null);
});

test('findPostEditForm fails closed when only another post edit form is ready', () => {
  const { findPostEditForm, forms, FakeElement, FakeTextArea, FakeForm } = loadLogic();
  forms.push(new FakeForm({
    action: '/posts/9999/edit',
    editor: new FakeTextArea(),
    save: new FakeElement({ text: 'Сохранить' })
  }));
  assert.equal(findPostEditForm('4425'), null);
});

test('staff publishing is disabled on later thread pages', () => {
  const { findFirstPostEdit } = loadLogic();
  const context = { threadId: '1623', isFirstThreadPage: false, postIds: ['9000'], actions: [
    { type: 'edit', postId: '9000', href: '/posts/9000/edit' }
  ] };
  assert.equal(findFirstPostEdit(context), null);
});

test('mounts staff inside the supplied helper container without a legacy modal', () => {
  const { mountWorkspace } = loadLogic();
  const workspace = { dataset: {}, classList: { add() {} } };
  const container = {
    children: [],
    replaceChildren(...children) { this.children = children; },
    querySelectorAll(selector) { return selector === '[data-staff-workspace]' ? this.children.filter((item) => item.dataset.staffWorkspace === 'true') : []; }
  };

  mountWorkspace(container, { workspaceElement: workspace });

  assert.equal(container.querySelectorAll('[data-staff-workspace]').length, 1);
});

test('staff workspace uses the shared v5 store and tracks draft input', async () => {
  const { mountWorkspace, getState, setState, isDirty, memory } = loadLogic();
  let full = { version: 5, staff: { overrides: { shared: { name: 'Shared' } }, added: [], ui: {}, autoPublish: { enabled: false } } };
  const store = {
    getState: async () => full,
    update: async (mutator) => { full = await mutator(full); return full; }
  };
  const listeners = {};
  const workspace = { dataset: {}, classList: { add() {} }, addEventListener(type, fn) { listeners[type] = fn; } };
  const container = { replaceChildren() {} };
  mountWorkspace(container, { workspaceElement: workspace, store });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await getState()).overrides.shared.name, 'Shared');
  listeners.input({ isTrusted: true });
  assert.equal(isDirty(), true);
  await setState({ overrides: { saved: { name: 'Saved' } }, added: [], ui: {}, autoPublish: { enabled: false } });
  assert.equal(full.staff.overrides.saved.name, 'Saved');
  assert.equal(isDirty(), false);
  assert.equal(memory.kalusStaffEditorState, undefined);
});

test('developer sections remain outside editable staff sections', () => {
  const { allowedSection } = loadLogic();
  const section = { id: 'developers', querySelector: () => ({ textContent: 'Разработчики' }) };
  assert.equal(allowedSection(section), false);
});

test('mergeSnapshot does not duplicate a previously saved added member after F5', () => {
  const { mergeSnapshot } = loadLogic();
  const base = {
    sections: [{ id: 'junior-mod', title: 'Модераторы' }],
    items: [{
      key: 'forum:/members/test.777/',
      kind: 'existing',
      section: 'junior-mod',
      name: 'Test_User',
      forum: 'https://forum.pridekeeper.tech/members/test.777/',
      forumId: '777',
      role: 'Модераторы'
    }]
  };
  const state = {
    overrides: {},
    added: [{
      id: 'added-1',
      section: 'junior-mod',
      name: 'Test_User',
      forum: 'https://forum.pridekeeper.tech/members/test.777/',
      forumId: '777',
      role: 'Модераторы'
    }]
  };

  const merged = mergeSnapshot(base, state);

  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].kind, 'existing');
});

test('mergeSnapshot does not resurrect a saved added member deleted after reload', () => {
  const { mergeSnapshot } = loadLogic();
  const base = {
    sections: [{ id: 'junior-mod', title: 'Модераторы' }],
    items: []
  };
  const state = {
    overrides: {
      'forum:/members/test.777/': { hidden: true }
    },
    added: [{
      id: 'added-1',
      section: 'junior-mod',
      name: 'Test_User',
      forum: 'https://forum.pridekeeper.tech/members/test.777/',
      forumId: '777',
      role: 'Модераторы'
    }]
  };

  const merged = mergeSnapshot(base, state);

  assert.equal(merged.items.length, 0);
});

test('findPostEditForm waits until the exact edit form has an editor and Save button', () => {
  const { findPostEditForm, forms, FakeForm } = loadLogic();
  forms.push(new FakeForm({ action: '/posts/4425/edit' }));

  assert.equal(findPostEditForm('4425'), null);
});

test('findPostEditForm accepts the exact edit form once controls are ready', () => {
  const { findPostEditForm, forms, FakeElement, FakeForm } = loadLogic();
  const editor = new FakeElement();
  const save = new FakeElement({ text: 'Сохранить' });
  const form = new FakeForm({ action: '/posts/4425/edit', editor, save });
  forms.push(form);

  assert.equal(findPostEditForm('4425'), form);
});

test('pending publish switches XenForo to BBCode mode before replacing the post', async () => {
  const {
    completePendingPublishOnEditPage,
    forms,
    memory,
    FakeElement,
    FakeTextArea,
    FakeForm
  } = loadLogic();

  const editor = new FakeTextArea();
  const save = new FakeElement({ text: 'Сохранить' });
  const sourceToggle = new FakeElement();
  sourceToggle.classList = { contains: () => false };
  sourceToggle.click = () => {
    sourceToggle.clicked += 1;
    sourceToggle.classList = { contains: (name) => name === 'fr-active' };
  };
  forms.push(new FakeForm({
    action: '/posts/4425/edit',
    editor,
    save,
    sourceToggle
  }));

  memory.kalusStaffEditorState = {
    overrides: {},
    added: [],
    ui: {},
    autoPublish: { enabled: true }
  };
  memory.prideKeeperStaffPublishJob = {
    postId: '4425',
    code: '[PARSEHTML]\n<div>updated</div>\n[/PARSEHTML]',
    createdAt: Date.now()
  };

  const completed = await completePendingPublishOnEditPage();

  assert.equal(completed, true);
  assert.equal(sourceToggle.clicked, 1);
  assert.equal(editor.value, '[PARSEHTML]\n<div>updated</div>\n[/PARSEHTML]');
  assert.equal(save.clicked, 1);
});

test('auto-save fails closed before generating code when first-post edit is missing', async () => {
  const { autoSaveCodeToForum, memory, documentMock, locationMock } = loadLogic();
  locationMock.href = 'https://forum.pridekeeper.tech/threads/1623/';
  locationMock.pathname = '/threads/1623/';
  let cloneCount = 0;
  const clone = {
    outerHTML: '<div class="bbWrapper"></div>',
    classList: { contains: (name) => name === 'bbWrapper' },
    childNodes: [],
    querySelector: () => null
  };
  const sourceWrapper = {
    cloneNode: () => {
      cloneCount += 1;
      return clone;
    }
  };
  documentMock.querySelector = (selector) => selector === '.bbWrapper' ? sourceWrapper : null;

  memory.kalusStaffEditorState = {
    overrides: {},
    added: [],
    ui: {},
    autoPublish: { enabled: true }
  };

  await autoSaveCodeToForum();
  await autoSaveCodeToForum();

  assert.equal(cloneCount, 0);
});
