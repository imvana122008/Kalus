(() => {
  const staffPathAllowed = window.PKFA?.staffGate?.shouldRunStaff
    ? window.PKFA.staffGate.shouldRunStaff(location.pathname, location.hash)
    : (/\/threads\/(?:[^/?#]+\.)?1623(?:\/|$)/i.test(location.pathname) || (/\/posts\/\d+\/edit\/?$/i.test(location.pathname) && location.hash === "#pkfa-staff-publish"));
  if (!staffPathAllowed) return;
  if (window.__PRIDE_KEEPER_STAFF__) return;
  window.__PRIDE_KEEPER_STAFF__ = "5.0.0";

  // ============================================================
  // PRIDE KEEPER STAFF — ОСНОВНЫЕ НАСТРОЙКИ
  // ЭТОТ БЛОК МОЖНО МЕНЯТЬ БЕЗ ПОИСКА ПО ВСЕМУ СКРИПТУ.
  // Если ты кидаешь мне правки в чат, я дальше меняю именно этот файл.
  // ============================================================
  const CONFIG = {
    version: "5.0.0",

    storageKey: "kalusStaffEditorState",
    codeCacheKey: "prideKeeperStaffGeneratedCode",

    brand: {
      title: "PRIDE KEEPER",
      subtitle: "STAFF EDITOR",
      headerVersionText: "v5.0 • STAFF ENGINE",
      launcherTitle: "PRIDE KEEPER Staff"
    },

    sections: [
      { id: "management", title: "Руководство", color: "#ff5365" },
      { id: "main-mod", title: "Главная модерация", color: "#4ed35d" },
      { id: "curator", title: "Кураторы модерации", color: "#9173ff" },
      { id: "senior-mod", title: "Старшие модераторы", color: "#f0ca2f" },
      { id: "junior-mod", title: "Модераторы", color: "#42c4ff" }
    ],

    roles: [
      "Руководство",
      "Главная модерация",
      "Кураторы модерации",
      "Старшие модераторы",
      "Модераторы"
    ],

    autoPublish: {
      enabledByDefault: true,
      editButtonTexts: ["Изменить", "Редактировать"],
      saveButtonTexts: ["Сохранить", "Save"],
      debounceMs: 900,
      editorWaitMs: 9000,
      saveWaitMs: 12000
    },

    forum: {
      origin: "https://forum.pridekeeper.tech",
      avatarSizes: ["o", "l", "h", "m", "s"]
    }
  };

  const STORAGE_KEY = CONFIG.storageKey;
  const CODE_CACHE_KEY = CONFIG.codeCacheKey;
  const PUBLISH_JOB_KEY = "prideKeeperStaffPublishJob";
  const ALLOWED_SECTIONS = CONFIG.sections.map(x => x.id);
  const ROLE_OPTIONS = [...CONFIG.roles];
  const SECTION_COLORS = Object.fromEntries(CONFIG.sections.map(x => [x.id, x.color]));
  let staffDirty = false;
  let workspaceBaseline = null;
  let staffStore = null;

  const asset = (name) => chrome.runtime.getURL(`assets/${name}`);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function defaultState() {
    return {
      overrides: {},
      added: [],
      ui: { position: "right-bottom", size: "standard" },
      autoPublish: {
        enabled: CONFIG.autoPublish.enabledByDefault,
        targetPostId: "",
        lastStatus: "idle",
        lastSavedAt: 0
      }
    };
  }

  async function getState() {
    const store = staffStore || window.PKFA?.store;
    if (store?.getState) {
      const full = await store.getState();
      const state = full?.staff || defaultState();
      return JSON.parse(JSON.stringify(state));
    }
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const state = result?.[STORAGE_KEY] || defaultState();
    state.overrides ||= {};
    state.added ||= [];
    state.ui ||= { position: "right-bottom", size: "standard" };
    state.autoPublish ||= {
      enabled: CONFIG.autoPublish.enabledByDefault,
      targetPostId: "",
      lastStatus: "idle",
      lastSavedAt: 0
    };
    return state;
  }

  async function persistStaffState(state) {
    const store = staffStore || window.PKFA?.store;
    if (store?.update) await store.update(full => { full.staff = JSON.parse(JSON.stringify(state)); return full; });
    else await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  async function setState(state) {
    await persistStaffState(state);
    workspaceBaseline = JSON.parse(JSON.stringify(state));
    staffDirty = false;
    queueCodeSync();
    queueForumAutoSave();
  }

  function esc(v = "") {
    return String(v)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeUrl(value) {
    const v = String(value || "").trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    return "https://" + v.replace(/^\/+/, "");
  }

  function extractForumId(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\d+$/.test(raw)) return raw;

    const memberMatch =
      raw.match(/\/members\/(?:[^/?#]*[.\-])?(\d+)\/?(?:[?#].*)?$/i) ||
      raw.match(/\/members\/(\d+)\/?/i);
    if (memberMatch) return memberMatch[1];

    const avatarMatch = raw.match(/\/data\/avatars\/[a-z]\/\d+\/(\d+)\.[a-z0-9]+/i);
    return avatarMatch ? avatarMatch[1] : "";
  }

  function avatarPath(id, size = "o") {
    const clean = extractForumId(id);
    if (!clean) return "";
    const bucket = Math.floor(Number(clean) / 1000);
    return `/data/avatars/${size}/${bucket}/${clean}.jpg`;
  }

  function avatarUrl(id, size = "o") {
    const path = avatarPath(id, size);
    return path ? location.origin + path : "";
  }

  async function resolveAvatarPath(id) {
    const clean = extractForumId(id);
    if (!clean) return "";

    for (const size of CONFIG.forum.avatarSizes) {
      const url = avatarUrl(clean, size);
      try {
        const ok = await new Promise((resolve) => {
          const img = new Image();
          const timer = setTimeout(() => resolve(false), 2200);
          img.onload = () => { clearTimeout(timer); resolve(true); };
          img.onerror = () => { clearTimeout(timer); resolve(false); };
          img.src = url + `?kalus_probe=${Date.now()}`;
        });
        if (ok) return avatarPath(clean, size);
      } catch (_) {}
    }
    return avatarPath(clean, "l");
  }

  function allowedSection(section) {
    if (!section || !ALLOWED_SECTIONS.includes(section.id)) return false;
    const title = section.querySelector("h2")?.textContent?.toLowerCase() || "";
    return !title.includes("разработ") && !title.includes("developer");
  }

  function getSectionTitle(sectionId, root = document) {
    const section = root.querySelector(`#${CSS.escape(sectionId)}`);
    return section?.querySelector("h2")?.textContent?.trim() || sectionId;
  }

  function getForumLink(card) {
    return card.querySelector('.links a[href*="/members/"]');
  }

  function getVkLink(card) {
    const links = [...card.querySelectorAll(".links a[href]")];
    return links.find((a) => {
      try {
        const host = new URL(a.getAttribute("href") || "", location.href).hostname;
        return /(^|\.)vk\.(com|ru)$/i.test(host);
      } catch (_) {
        return false;
      }
    }) || links.find((a) => /vk\.(com|ru)/i.test(a.getAttribute("href") || "")) || null;
  }

  function getCardKey(card, sectionId) {
    const forum = getForumLink(card);
    const href = forum?.getAttribute("href") || "";

    if (href) {
      try {
        const u = new URL(href, location.href);
        return "forum:" + u.pathname.replace(/\/+$/, "/");
      } catch (_) {}
    }

    const name = card.querySelector(".name")?.textContent?.trim() || "unknown";
    return `fallback:${sectionId}:${name}`;
  }

  function getCardData(card, sectionId, root = document) {
    const nameEl = card.querySelector(".name");
    const avatar = card.querySelector(".avatar");
    const role = card.querySelector("strong");
    const vk = getVkLink(card);
    const forum = getForumLink(card);

    const forumHref = forum?.getAttribute("href") || "";
    const avatarSrc = avatar?.getAttribute("src") || "";

    return {
      key: getCardKey(card, sectionId),
      kind: "existing",
      section: sectionId,
      sectionTitle: getSectionTitle(sectionId, root),
      name: nameEl?.textContent?.trim() || "",
      vk: vk ? new URL(vk.getAttribute("href") || "", location.href).href : "",
      forum: forum ? new URL(forumHref, location.href).href : "",
      forumId: extractForumId(forumHref) || extractForumId(avatarSrc),
      avatar: avatarSrc ? new URL(avatarSrc, location.href).href : "",
      avatarPath: avatarSrc || "",
      role: role?.textContent?.trim() || ""
    };
  }

  function scanRoot(root = document) {
    const items = [];
    const sections = [];

    for (const id of ALLOWED_SECTIONS) {
      const section = root.querySelector(`#${CSS.escape(id)}`);
      if (!allowedSection(section)) continue;

      sections.push({ id, title: section.querySelector("h2")?.textContent?.trim() || id });
      section.querySelectorAll(".cards > .card").forEach((card) => {
        items.push(getCardData(card, id, root));
      });
    }

    return { sections, items };
  }

  function memberIdentity(item) {
    const forumId = item?.forumId || extractForumId(item?.forum);
    if (forumId) return `forum-id:${forumId}`;

    if (item?.forum) {
      try {
        const path = new URL(item.forum, location.href).pathname.replace(/\/+$/, "/").toLowerCase();
        if (path) return `forum-path:${path}`;
      } catch (_) {}
    }

    const name = String(item?.name || "").trim().toLowerCase();
    const section = String(item?.section || "").trim().toLowerCase();
    return name ? `name:${section}:${name}` : "";
  }

  function hiddenOverrideIdentities(overrides = {}) {
    const identities = new Set();

    for (const [key, value] of Object.entries(overrides || {})) {
      if (!value?.hidden) continue;

      let identity = memberIdentity(value);
      if (!identity && key.startsWith("forum:")) {
        identity = memberIdentity({ forum: key.slice("forum:".length) });
      }
      if (identity) identities.add(identity);
    }

    return identities;
  }

  function mergeSnapshot(base, state) {
    const items = base.items.map((item) => {
      const o = state.overrides[item.key] || {};
      return {
        ...item,
        ...o,
        kind: "existing",
        key: item.key,
        forumId: o.forumId || extractForumId(o.forum) || item.forumId,
        hidden: !!o.hidden
      };
    });

    const existingIdentities = new Set(items.map(memberIdentity).filter(Boolean));
    const deletedIdentities = hiddenOverrideIdentities(state.overrides);

    for (const added of state.added) {
      const identity = memberIdentity(added);
      if (identity && deletedIdentities.has(identity)) continue;
      if (identity && existingIdentities.has(identity)) continue;

      items.push({
        ...added,
        kind: "added",
        key: added.id,
        forumId: added.forumId || extractForumId(added.forum),
        hidden: !!added.hidden
      });
      if (identity) existingIdentities.add(identity);
    }

    return { sections: base.sections, items };
  }

  function patchLink(link, href) {
    if (!link) return;
    const clean = normalizeUrl(href);
    if (!clean) {
      link.remove();
      return;
    }
    link.setAttribute("href", clean);
  }

  async function patchCard(card, data) {
    const nameEl = card.querySelector(".name");
    const role = card.querySelector("strong");
    const avatar = card.querySelector(".avatar");
    const vk = getVkLink(card);
    const forum = getForumLink(card);

    if (nameEl) nameEl.textContent = data.name || "";
    if (role) role.textContent = data.role || "";

    patchLink(vk, data.vk);
    patchLink(forum, data.forum);

    if (avatar) {
      const id = data.forumId || extractForumId(data.forum);
      if (id) {
        const resolved = data.avatarPathResolved || await resolveAvatarPath(id);
        if (resolved) avatar.setAttribute("src", resolved);
      }
      if (data.name) avatar.setAttribute("alt", data.name);
    }
  }

  function findTemplateCard(root, sectionId) {
    const section = root.querySelector(`#${CSS.escape(sectionId)}`);
    if (!allowedSection(section)) return null;
    return section.querySelector(".cards > .card");
  }

  function makeCardFromTemplate(root, sectionId, fallbackCard = null) {
    const template = findTemplateCard(root, sectionId) || fallbackCard;
    if (!template) return null;
    const card = template.cloneNode(true);
    card.removeAttribute("style");
    return card;
  }

  function getStableContentWrapper(wrapperClone) {
    let current = wrapperClone;

    // XenForo сам добавляет внешний .bbWrapper вокруг содержимого сообщения.
    // Старые версии клонировали и его тоже, поэтому после каждого сохранения
    // появлялся ещё один вложенный .bbWrapper. Оставляем только самый глубокий
    // корневой wrapper, который действительно содержит разделы состава.
    while (current?.classList?.contains("bbWrapper")) {
      const nodes = [...(current.childNodes || [])];
      const hasMeaningfulText = nodes.some((node) =>
        node?.nodeType === 3 && String(node.textContent || "").trim()
      );
      const elementChildren = nodes.filter((node) =>
        node?.nodeType === 1 || !!node?.classList
      );

      if (hasMeaningfulText || elementChildren.length !== 1) break;

      const child = elementChildren[0];
      const isManagedWrapper =
        child?.classList?.contains("bbWrapper") &&
        ALLOWED_SECTIONS.some((id) => child.querySelector?.(`#${CSS.escape(id)}`));

      if (!isManagedWrapper) break;
      current = child;
    }

    return current || wrapperClone;
  }

  function serializeCode(wrapperClone) {
    const stableWrapper = getStableContentWrapper(wrapperClone);
    return `[PARSEHTML]\n${stableWrapper.outerHTML.trim()}\n[/PARSEHTML]`;
  }

  function findPostById(postId) {
    if (!postId) return null;
    return [...document.querySelectorAll('article.message, .message, .message--post, [data-content="post"], [id^="post-"]')]
      .find(post => String(post.id || '').match(/(?:post[-_])(?:[^/?#]+\.)?(\d+)/i)?.[1] === String(postId)
        || [...(post.querySelectorAll?.('a[href*="/posts/"]') || [])].some(link => String(link.getAttribute?.('href') || '').match(/\/posts\/(\d+)/i)?.[1] === String(postId))) || null;
  }

  async function generateCode(state, sourcePostId = "") {
    const sourcePost = sourcePostId ? findPostById(sourcePostId) : null;
    const sourceWrapper = sourcePostId ? sourcePost?.querySelector?.(".bbWrapper") : document.querySelector(".bbWrapper");
    if (!sourceWrapper) {
      return { ok: false, error: "Не найден блок состава (.bbWrapper). Открой страницу с составом." };
    }

    const clone = sourceWrapper.cloneNode(true);
    const base = scanRoot(clone);
    const cardByKey = new Map();

    for (const id of ALLOWED_SECTIONS) {
      const section = clone.querySelector(`#${CSS.escape(id)}`);
      if (!allowedSection(section)) continue;
      section.querySelectorAll(".cards > .card").forEach((card) => {
        cardByKey.set(getCardKey(card, id), { card, sectionId: id });
      });
    }

    for (const baseItem of base.items) {
      const entry = cardByKey.get(baseItem.key);
      if (!entry) continue;

      const o = state.overrides?.[baseItem.key];
      if (!o) continue;

      if (o.hidden) {
        entry.card.remove();
        continue;
      }

      const data = {
        ...baseItem,
        ...o,
        forumId: o.forumId || extractForumId(o.forum) || baseItem.forumId
      };

      if (data.forumId && (o.forum || o.forumId)) {
        data.avatarPathResolved = await resolveAvatarPath(data.forumId);
      }

      const targetId = ALLOWED_SECTIONS.includes(data.section) ? data.section : baseItem.section;

      if (targetId === entry.sectionId) {
        await patchCard(entry.card, data);
      } else {
        const targetSection = clone.querySelector(`#${CSS.escape(targetId)}`);
        const targetCards = targetSection?.querySelector(".cards");
        if (!allowedSection(targetSection) || !targetCards) continue;

        const newCard = makeCardFromTemplate(clone, targetId, entry.card);
        if (!newCard) continue;
        await patchCard(newCard, data);
        targetCards.appendChild(newCard);
        entry.card.remove();
      }
    }

    const baseIdentities = new Set(base.items.map(memberIdentity).filter(Boolean));
    const deletedIdentities = hiddenOverrideIdentities(state.overrides);

    for (const item of state.added || []) {
      if (!item || item.hidden || !ALLOWED_SECTIONS.includes(item.section)) continue;
      const identity = memberIdentity(item);
      if (identity && deletedIdentities.has(identity)) continue;
      if (identity && baseIdentities.has(identity)) continue;

      const targetSection = clone.querySelector(`#${CSS.escape(item.section)}`);
      const targetCards = targetSection?.querySelector(".cards");
      if (!allowedSection(targetSection) || !targetCards) continue;

      const fallback = clone.querySelector(".cards > .card");
      const newCard = makeCardFromTemplate(clone, item.section, fallback);
      if (!newCard) continue;

      const data = {
        ...item,
        forumId: item.forumId || extractForumId(item.forum)
      };
      if (data.forumId) data.avatarPathResolved = await resolveAvatarPath(data.forumId);

      await patchCard(newCard, data);
      targetCards.appendChild(newCard);
      if (identity) baseIdentities.add(identity);
    }

    return { ok: true, code: serializeCode(clone) };
  }


  let codeSyncTimer = null;
  let codeSyncRunning = false;
  let codeSyncRequested = false;

  function queueCodeSync(delay = 320) {
    clearTimeout(codeSyncTimer);
    codeSyncTimer = setTimeout(() => {
      refreshGeneratedCodeCache().catch(() => {});
    }, delay);
  }

  async function refreshGeneratedCodeCache() {
    if (codeSyncRunning) {
      codeSyncRequested = true;
      return;
    }

    codeSyncRunning = true;
    try {
      const state = await getState();
      const result = await generateCode(state);

      if (result?.ok && result.code) {
        const cache = {
          code: result.code,
          updatedAt: Date.now()
        };

        await chrome.storage.local.set({ [CODE_CACHE_KEY]: cache });

        // Если экран кода сейчас открыт, обновляем текст прямо на глазах.
        try {
          if (
            typeof screen !== "undefined" &&
            screen === "code" &&
            typeof content !== "undefined"
          ) {
            const area = content.querySelector("[data-code]");
            const info = content.querySelector("[data-codeinfo]");
            if (area) {
              currentCode = result.code;
              area.value = result.code;
            }
            if (info) {
              info.textContent =
                `LIVE-код обновлён автоматически • ${result.code.length.toLocaleString("ru-RU")} символов`;
              info.style.color = "#9c8cff";
            }
          }
        } catch (_) {}
      }
    } finally {
      codeSyncRunning = false;
      if (codeSyncRequested) {
        codeSyncRequested = false;
        queueCodeSync(80);
      }
    }
  }


  // ============================================================
  // АВТОСОХРАНЕНИЕ ГОТОВОГО КОДА В ПОСТ ФОРУМА
  // После правки состава:
  // 1) пересобирает PARSEHTML;
  // 2) находит "Изменить";
  // 3) открывает редактор;
  // 4) заменяет содержимое;
  // 5) нажимает "Сохранить".
  // ============================================================
  let forumSaveTimer = null;
  let forumSaveRunning = false;
  let forumSaveQueued = false;

  function normText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function getPostContainer(el) {
    return el?.closest(
      'article.message, .message, .message--post, [data-content="post"], [id^="post-"], [data-author]'
    ) || null;
  }

  function extractPostIdFromNode(node) {
    if (!node) return "";
    const candidates = [
      node.id,
      node.getAttribute?.("data-content"),
      node.getAttribute?.("data-lb-id"),
      node.getAttribute?.("data-message-id"),
      node.getAttribute?.("data-post-id")
    ].filter(Boolean).join(" ");
    const m = candidates.match(/(?:post[-_: ]?|posts\/)(\d+)/i);
    return m ? m[1] : "";
  }

  function textMatches(el, texts) {
    const txt = normText(el?.textContent);
    return texts.some(t => {
      const q = normText(t);
      return txt === q || txt.startsWith(q + " ") || txt.includes(q);
    });
  }

  function findEditButton(targetPostId = "") {
    // ВАЖНО: берём только настоящую ссылку редактирования поста.
    // Никаких кнопок ответа/быстрого редактора, чтобы не отправить новый пост.
    const links = [...document.querySelectorAll('a[href*="/posts/"][href*="/edit"]')]
      .filter(isVisible)
      .filter(a => /\/posts\/\d+\/edit(?:$|[?#])/i.test(new URL(a.href, location.href).pathname + new URL(a.href, location.href).search));

    if (!links.length) return null;

    if (targetPostId) {
      const exact = links.find(a => {
        const u = new URL(a.href, location.href);
        return u.pathname.includes(`/posts/${targetPostId}/edit`);
      });
      if (exact) return exact;
    }

    // Ищем ссылку «Изменить» внутри самого сообщения со списком модерации.
    const compositionPost = [...document.querySelectorAll(
      'article.message, .message, .message--post, [data-content="post"], [id^="post-"]'
    )].find(post => {
      const txt = normText(post.textContent);
      return (
        txt.includes("список модерации") ||
        txt.includes("кураторы модерации") ||
        txt.includes("старшие модераторы")
      );
    });

    if (compositionPost) {
      const inside = links.find(a => compositionPost.contains(a));
      if (inside) return inside;
    }

    // В теме состава нужный список обычно находится в первом сообщении.
    const inPost = links.find(a => getPostContainer(a));
    return inPost || links[0];
  }

  function findFirstPostEdit(context = {}) {
    if (String(context.threadId || "") !== "1623") return null;
    if (context.isFirstThreadPage === false) return null;
    const firstPostId = String(context.postIds?.[0] || "");
    if (!firstPostId) return null;
    return (context.actions || []).find(item => {
      if (item.type !== "edit" || String(item.postId || "") !== firstPostId) return false;
      try {
        const url = new URL(item.href || "", location.href);
        return url.origin === location.origin && url.pathname.replace(/\/+$/, "") === `/posts/${firstPostId}/edit`;
      } catch (_) { return false; }
    }) || null;
  }

  function getCurrentEditPostId() {
    return location.pathname.match(/\/posts\/(\d+)\/edit\/?$/i)?.[1] || "";
  }

  function findPostEditForm(expectedPostId = "") {
    const forms = [...document.querySelectorAll('form')];

    // Сначала строго по action /posts/ID/edit.
    if (expectedPostId) {
      const exact = forms.find(form => {
        const action = form.getAttribute('action') || '';
        try {
          const u = new URL(action, location.href);
          return u.origin === location.origin && u.pathname.replace(/\/+$/, '') === `/posts/${expectedPostId}/edit`;
        } catch (_) {
          return false;
        }
      });
      if (exact && findEditableControl(exact) && findSaveButton(exact)) return exact;
    }

    const pagePostId = expectedPostId || getCurrentEditPostId();
    if (!pagePostId) return null;
    return null;
  }

  function findEditableControl(root) {
    if (!root) return null;
    const selectors = [
      'textarea[name="message"]',
      'textarea[name="message_html"]',
      'textarea[data-xf-init*="editor"]',
      '.fr-element[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]'
    ];

    for (const sel of selectors) {
      const els = [...root.querySelectorAll(sel)];
      const visible = els.find(isVisible);
      if (visible) return visible;
      if (els[0]) return els[0];
    }
    return null;
  }

  function htmlToEditorText(code) {
    return String(code || "");
  }

  function setNativeValue(el, value) {
    if (!el) return false;

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    if (el.isContentEditable) {
      el.focus();
      el.innerText = value;
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value
      }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    return false;
  }

  function syncKnownEditorMirrors(root, code) {
    if (!root) return;

    const areas = [...root.querySelectorAll(
      'textarea[name="message"], textarea[name="message_html"], textarea[data-xf-init*="editor"]'
    )];
    for (const ta of areas) setNativeValue(ta, code);

    const edits = [...root.querySelectorAll(
      '.fr-element[contenteditable="true"], [contenteditable="true"][role="textbox"]'
    )];
    for (const ed of edits) setNativeValue(ed, code);
  }

  async function ensureBbCodeMode(root) {
    const toggle = root?.querySelector?.('button[data-cmd="xfBbCode"]');
    if (!toggle || toggle.classList.contains("fr-active")) return true;

    toggle.click();
    return !!(await waitFor(
      () => toggle.classList.contains("fr-active"),
      1800,
      60
    ));
  }

  function findSaveButton(root) {
    if (!root) return null;
    const candidates = [...root.querySelectorAll(
      'button[type="submit"], input[type="submit"], button, .button--primary'
    )].filter(isVisible);

    // Только «Сохранить». Никаких «Ответить», «Отправить ответ» и document fallback.
    return candidates.find(el => {
      const txt = normText(el.value || el.textContent);
      return txt === "сохранить" || txt.startsWith("сохранить ");
    }) || null;
  }

  async function waitFor(fn, timeoutMs, interval = 120) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const v = fn();
        if (v) return v;
      } catch (_) {}
      await sleep(interval);
    }
    return null;
  }

  async function updateAutoPublishStatus(status, extra = {}) {
    const state = await getState();
    state.autoPublish ||= {};
    state.autoPublish.lastStatus = status;
    Object.assign(state.autoPublish, extra);
    // Не используем setState(), иначе это снова запустит автосохранение.
    await persistStaffState(state);
    try {
      if (typeof toast !== "undefined") {
        const map = {
          waiting: "Автосохранение: жду…",
          editing: "Автосохранение: перехожу в редактирование поста…",
          replacing: "Автосохранение: заменяю код…",
          saving: "Автосохранение: нажимаю «Сохранить»…",
          success: "✓ Существующий пост обновлён",
          no_edit_button: "Не нашёл кнопку «Изменить»",
          no_editor: "Не нашёл редактор сообщения",
          no_save_button: "Не нашёл кнопку «Сохранить»",
          error: "Ошибка автосохранения"
        };
        say(map[status] || status, ["error","no_edit_button","no_editor","no_save_button"].includes(status));
      }
    } catch (_) {}
  }

  function queueForumAutoSave(delay = CONFIG.autoPublish.debounceMs) {
    clearTimeout(forumSaveTimer);
    forumSaveTimer = setTimeout(() => {
      autoSaveCodeToForum().catch(() => {});
    }, delay);
  }

  async function autoSaveCodeToForum() {
    const state = await getState();
    if (!state.autoPublish?.enabled) return;

    if (forumSaveRunning) {
      forumSaveQueued = true;
      return;
    }

    forumSaveRunning = true;
    await updateAutoPublishStatus("waiting");

    try {
      // Если мы уже на /posts/ID/edit, публикацию завершает отдельный обработчик ниже.
      if (getCurrentEditPostId()) return;

      const liveContext = window.PKFA?.context?.inspectDocument?.(document, location) || {};
      const firstAction = findFirstPostEdit(liveContext);
      if (!firstAction) {
        await updateAutoPublishStatus("no_edit_button");
        return;
      }
      const result = await generateCode(state, firstAction.postId);
      if (!result?.ok || !result.code) {
        throw new Error(result?.error || "Не удалось собрать код");
      }

      const code = result.code;
      await chrome.storage.local.set({
        [CODE_CACHE_KEY]: { code, updatedAt: Date.now() }
      });

      const editLink = firstAction.element || null;
      if (!editLink) {
        await updateAutoPublishStatus("no_edit_button");
        return;
      }

      const editUrl = new URL(editLink.href, location.href);
      const postId = editUrl.pathname.match(/\/posts\/(\d+)\/edit/i)?.[1] || "";
      if (!postId) {
        await updateAutoPublishStatus("no_edit_button");
        return;
      }

      const job = {
        postId,
        editUrl: editUrl.href,
        returnUrl: location.href,
        code,
        createdAt: Date.now()
      };

      const fresh = await getState();
      fresh.autoPublish.targetPostId = postId;
      fresh.autoPublish.lastStatus = "editing";
      await persistStaffState(fresh);
      await chrome.storage.local.set({ [PUBLISH_JOB_KEY]: job });

      // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ:
      // не пытаемся редактировать quick-reply на текущей странице.
      // Переходим ровно на /posts/ID/edit, как ты делаешь вручную.
      editUrl.hash = "pkfa-staff-publish";
      location.href = editUrl.href;

    } catch (e) {
      console.error("[PRIDE KEEPER Staff] auto-save error:", e);
      await updateAutoPublishStatus("error");
    } finally {
      forumSaveRunning = false;
      if (forumSaveQueued) {
        forumSaveQueued = false;
        queueForumAutoSave(120);
      }
    }
  }

  async function completePendingPublishOnEditPage() {
    const postId = getCurrentEditPostId();
    if (!postId) return false;

    const stored = await chrome.storage.local.get([PUBLISH_JOB_KEY]);
    const job = stored?.[PUBLISH_JOB_KEY];
    if (!job || String(job.postId) !== String(postId) || !job.code) return false;

    // Защита от старого зависшего задания.
    if (Date.now() - Number(job.createdAt || 0) > 2 * 60 * 1000) {
      await chrome.storage.local.remove([PUBLISH_JOB_KEY]);
      return false;
    }

    try {
      await updateAutoPublishStatus("replacing", { targetPostId: postId });

      const editForm = await waitFor(
        () => findPostEditForm(postId),
        CONFIG.autoPublish.editorWaitMs,
        120
      );

      if (!editForm) {
        await updateAutoPublishStatus("no_editor");
        return false;
      }

      const editor = findEditableControl(editForm);
      if (!editor) {
        await updateAutoPublishStatus("no_editor");
        return false;
      }

      // В визуальном режиме Froala превращает [PARSEHTML] в набор <p> и
      // может сохранить код как обычный текст. Сначала включаем BBCode-режим,
      // затем заменяем содержимое существующего сообщения.
      await ensureBbCodeMode(editForm);

      syncKnownEditorMirrors(editForm, htmlToEditorText(job.code));
      setNativeValue(editor, htmlToEditorText(job.code));

      await sleep(350);

      // Ищем «Сохранить» ТОЛЬКО внутри формы редактирования поста.
      // Это полностью исключает кнопку быстрого ответа внизу темы.
      const saveButton = findSaveButton(editForm);
      if (!saveButton) {
        await updateAutoPublishStatus("no_save_button");
        return false;
      }

      await updateAutoPublishStatus("saving", { targetPostId: postId });

      // Задание удаляем перед нажатием, чтобы после редиректа не повторить сохранение.
      await chrome.storage.local.remove([PUBLISH_JOB_KEY]);

      saveButton.click();
      staffDirty = false;

      // Если XenForo по какой-то причине не перешёл обратно сам, ждём,
      // но новый ответ нигде не создаём и никакую другую форму не трогаем.
      await sleep(900);
      return true;

    } catch (e) {
      console.error("[PRIDE KEEPER Staff] edit-page save error:", e);
      await updateAutoPublishStatus("error");
      return false;
    }
  }

  function isDirty() {
    return staffDirty;
  }

  async function discardChanges() {
    if (workspaceBaseline) {
      await persistStaffState(JSON.parse(JSON.stringify(workspaceBaseline)));
    }
    staffDirty = false;
    if (typeof refreshData === "function") await refreshData();
    return true;
  }

  async function preparePublish(doc = document, context = {}) {
    const action = findFirstPostEdit(context);
    if (!action) return { ok: false, reason: "first-post-edit-missing" };
    const state = await getState();
    const generated = await generateCode(state, action.postId);
    if (!generated?.ok || !generated.code) return { ok: false, reason: generated?.error || "code-generation-failed" };
    return { ok: true, action, postId: action.postId, code: generated.code, document: doc };
  }

  function buildSelectModel(options = [], selectedValue = "") {
    const normalized = options.map(option => ({
      value: String(option?.value || ""),
      label: String(option?.label || option?.value || ""),
      tone: String(option?.tone || "#8a73ff")
    }));
    const active = normalized.find(option => option.value === String(selectedValue)) || normalized[0] || { value: "", label: "", tone: "#8a73ff" };
    const items = normalized.map(option => ({ ...option, selected: option.value === active.value }));
    return { selected: items.find(option => option.selected) || { ...active, selected: true }, options: items };
  }

  function nextSelectIndex(current, direction, length) {
    if (!Number.isInteger(length) || length <= 0) return -1;
    const index = Number.isInteger(current) ? current : 0;
    return (index + direction + length) % length;
  }

  function mountWorkspace(container, options = {}) {
    if (!container) throw new Error("STAFF container is required");
    staffStore = options.store || staffStore || window.PKFA?.store || null;
    const workspaceElement = options.workspaceElement || (typeof host !== "undefined" ? host : null);
    if (!workspaceElement) throw new Error("STAFF workspace is unavailable");
    workspaceElement.dataset ||= {};
    workspaceElement.dataset.staffWorkspace = "true";
    container.replaceChildren(workspaceElement);
    if (!workspaceBaseline) getState().then(state => { workspaceBaseline = JSON.parse(JSON.stringify(state)); }).catch(() => {});
    if (!workspaceElement.__pkfaDirtyListener) {
      const markDirty = event => { if (event?.isTrusted !== false) staffDirty = true; };
      workspaceElement.addEventListener?.('input', markDirty, true);
      workspaceElement.addEventListener?.('change', markDirty, true);
      workspaceElement.__pkfaDirtyListener = true;
    }
    if (typeof backdrop !== "undefined" && workspaceElement === host) {
      launcher.hidden = true;
      backdrop.classList.add("embedded");
      backdrop.classList.remove("hidden");
      Promise.resolve(render()).catch(() => {});
    }
    return { isDirty, discardChanges, preparePublish };
  }


  // ---------------- UI ----------------

  const host = document.createElement("div");
  host.id = "kalus-staff-builder-host";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial}
    *,*::before,*::after{box-sizing:border-box}
    .k-launcher{
      position:fixed;z-index:2147483645;width:48px;height:48px;border-radius:50%;
      border:1px solid #3c2d66;background:linear-gradient(180deg,#151221,#0f0c18);
      box-shadow:0 12px 34px rgba(0,0,0,.55),0 0 0 5px rgba(103,84,199,.12),0 0 18px rgba(103,84,199,.25);
      padding:0;cursor:pointer;overflow:hidden;display:grid;place-items:center;transition:.18s
    }
    .k-launcher:hover{transform:translateY(-2px) scale(1.04);border-color:#7c62ff;box-shadow:0 14px 42px rgba(0,0,0,.68),0 0 26px rgba(124,98,255,.38)}
    .k-launcher img{width:100%;height:100%;object-fit:cover}
    .k-launcher.right-bottom{right:22px;bottom:22px}
    .k-launcher.right-top{right:22px;top:110px}
    .k-launcher.left-bottom{left:22px;bottom:22px}
    .k-launcher.left-top{left:22px;top:110px}
    .k-launcher.small{width:40px;height:40px}
    .k-launcher.standard{width:48px;height:48px}
    .k-launcher.large{width:58px;height:58px}

    .k-backdrop{
      position:fixed;inset:0;z-index:2147483644;background:rgba(4,3,9,.66);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#f4f3ff
    }
    .hidden{display:none!important}
    .k-window{
      width:min(700px,calc(100vw - 48px));height:min(620px,calc(100vh - 48px));
      background:
        radial-gradient(circle at 86% 2%, rgba(93,69,191,.16), transparent 25%),
        radial-gradient(circle at 18% 96%, rgba(93,69,191,.10), transparent 28%),
        linear-gradient(180deg,#0a0a10,#07080d);
      border:1px solid #2f2649;border-radius:14px;
      box-shadow:0 28px 90px rgba(0,0,0,.78), inset 0 1px 0 rgba(255,255,255,.02);
      overflow:hidden;display:flex;flex-direction:column
    }
    .k-header{
      height:62px;padding:10px 14px;border-bottom:1px solid #241e37;display:flex;align-items:center;justify-content:space-between;
      background:linear-gradient(180deg,rgba(17,14,27,.94),rgba(10,10,16,.94))
    }
    .k-brand{display:flex;align-items:center;gap:10px;min-width:0}
    .k-brand-wordmark{width:96px;height:42px;object-fit:contain;object-position:left center;filter:drop-shadow(0 0 9px rgba(133,105,255,.18))}
    .k-titlebox strong{display:block;font-size:13px;line-height:1.1;color:#f0eefc}
    .k-titlebox span{display:block;margin-top:3px;color:#8177a4;font-size:9px}
    .k-head-actions{display:flex;align-items:center;gap:7px}
    .k-head-dot{width:26px;height:26px;border-radius:9px;border:1px solid #31284f;background:#151122;display:grid;place-items:center}
    .k-head-dot img{width:22px;height:22px;border-radius:50%;object-fit:cover}
    .k-x{width:28px;height:28px;border:1px solid #332852;border-radius:9px;background:#120f1c;color:#b7afd8;cursor:pointer;font-size:17px}

    .k-body{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
    .k-scroll{flex:1;overflow:auto;padding:12px}
    .k-scroll::-webkit-scrollbar{width:6px}
    .k-scroll::-webkit-scrollbar-thumb{background:#30274a;border-radius:10px}
    .k-topcard{
      border:1px solid #2b2343;background:linear-gradient(180deg,rgba(22,18,34,.98),rgba(15,12,24,.98));border-radius:10px;padding:10px 12px;
      display:flex;align-items:center;gap:10px;margin-bottom:10px
    }
    .k-topicon{width:32px;height:32px;border-radius:10px;background:#1c1930;color:#8d7cff;display:grid;place-items:center;font-size:15px}
    .k-toptext strong{display:block;font-size:11px;color:#f1effc}
    .k-toptext span{display:block;margin-top:2px;color:#83799f;font-size:9px;line-height:1.35}
    .k-menu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .k-menu-card{
      min-height:74px;border:1px solid #2b2343;border-radius:9px;background:linear-gradient(180deg,#161321,#100d19);
      color:#ecf2ff;cursor:pointer;padding:11px;display:flex;align-items:center;gap:10px;text-align:left
    }
    .k-menu-card:hover{border-color:#5846a6;transform:translateY(-1px);box-shadow:0 8px 22px rgba(0,0,0,.25)}
    .k-menu-ico{width:34px;height:34px;border-radius:10px;background:#211b35;display:grid;place-items:center;color:#9d8dff;font-size:16px;flex:0 0 auto}
    .k-menu-card:nth-child(2) .k-menu-ico{background:#221934;color:#c58cff}
    .k-menu-card:nth-child(3) .k-menu-ico{background:#162723;color:#65d8a4}
    .k-menu-card:nth-child(4) .k-menu-ico{background:#211b35;color:#8ea5ff}
    .k-menu-card strong{display:block;font-size:11px;color:#f2f0fc}
    .k-menu-card span{display:block;margin-top:3px;color:#81779f;font-size:9px;line-height:1.25}

    .k-toolbar{display:flex;gap:8px;margin-bottom:10px}
    .k-search{flex:1;position:relative}
    .k-search input,.k-field input,.k-field select,.k-codearea,.k-importarea{
      width:100%;border:1px solid #2d2447;background:linear-gradient(180deg,#13101d,#0f0c18);color:#edf4ff;border-radius:9px;padding:9px 10px;outline:none;font:11px Inter,Segoe UI,Arial,sans-serif
    }
    .k-search input:focus,.k-field input:focus,.k-field select:focus,.k-codearea:focus,.k-importarea:focus{border-color:#7b66ff;box-shadow:0 0 0 3px rgba(123,102,255,.14)}
    .k-btn{
      border:1px solid #342a51;background:#130f1d;color:#d1cae8;border-radius:9px;padding:8px 11px;font:700 10px Inter,Segoe UI,Arial,sans-serif;cursor:pointer
    }
    .k-btn:hover{border-color:#6251ae;color:#fff}
    .k-btn.primary{background:linear-gradient(135deg,#6e56f4,#8a73ff);border-color:#8a73ff;color:white}
    .k-btn.green{border-color:#285341;color:#7ae2b5;background:#102018}
    .k-btn.danger{border-color:#5f2b36;color:#ff9cac;background:#241116}
    .k-btn:disabled{opacity:.5;cursor:wait}

    .k-section{--sec:#9070ff;border:1px solid #26203a;background:linear-gradient(180deg,#13101d,#0e0c16);border-radius:10px;padding:9px;margin-bottom:9px}
    .k-section[data-sec="management"]{--sec:#ff5365}
    .k-section[data-sec="main-mod"]{--sec:#4ed35d}
    .k-section[data-sec="curator"]{--sec:#9173ff}
    .k-section[data-sec="senior-mod"]{--sec:#f0ca2f}
    .k-section[data-sec="junior-mod"]{--sec:#42c4ff}
    .k-sec-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
    .k-sec-title{display:flex;align-items:center;gap:7px;font-weight:900;font-size:11px;color:var(--sec)}
    .k-sec-dot{width:7px;height:7px;border-radius:50%;background:var(--sec);box-shadow:0 0 9px var(--sec)}
    .k-count{font-size:8px;color:#8a80aa;background:#090810;border:1px solid #27213a;border-radius:999px;padding:2px 6px}
    .k-add{border:1px solid color-mix(in srgb,var(--sec) 40%,#2d2447);background:color-mix(in srgb,var(--sec) 9%,#100d19);color:var(--sec);border-radius:7px;padding:5px 8px;font:800 9px Inter;cursor:pointer}
    .k-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
    .k-person,.k-new{
      min-height:125px;border:1px solid color-mix(in srgb,var(--sec) 18%,#2f2649);background:linear-gradient(180deg,#171321,#110e1a);border-radius:9px;
      padding:8px;display:flex;flex-direction:column;align-items:center;text-align:center;position:relative
    }
    .k-person.off{opacity:.45;filter:saturate(.6)}
    .k-avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;border:1px solid color-mix(in srgb,var(--sec) 35%,#40345f);background:#0b0a11;margin-bottom:7px}
    .k-fallback{display:grid;place-items:center;color:#d5dcea;font-weight:900}
    .k-name{font-size:9px;font-weight:900;color:var(--sec);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .k-role{margin-top:5px;max-width:95%;padding:3px 6px;border-radius:6px;background:color-mix(in srgb,var(--sec) 65%,#121212);color:#fff;border:1px solid var(--sec);font-size:7px;font-weight:900;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .k-actions{display:flex;gap:5px;margin-top:auto;padding-top:8px}
    .k-mini{min-width:24px;height:24px;border-radius:7px;border:1px solid #342a51;background:#0f0c18;color:#beb5d7;cursor:pointer;font-size:10px;padding:0 6px}
    .k-mini:hover{color:#fff;border-color:var(--sec)}
    .k-new{border-style:dashed;justify-content:center;color:#857ca3;cursor:pointer}
    .k-new:hover{color:#efeaff;border-color:#6251ae}
    .k-new b{font-size:20px;line-height:1}
    .k-new span{font-size:9px;margin-top:5px}
    .k-person:hover{box-shadow:0 8px 18px rgba(0,0,0,.25)}

    .k-form{display:grid;grid-template-columns:1fr 1fr;gap:11px;padding:12px;border:1px solid #2b2343;border-radius:12px;background:linear-gradient(145deg,rgba(18,15,28,.96),rgba(11,9,18,.98));box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}
    .k-field{display:grid;gap:6px;min-width:0}
    .k-field.full{grid-column:1/-1}
    .k-field label{font-size:9px;font-weight:800;color:#c9c2df;letter-spacing:.015em}
    .k-field input{min-height:39px;background:#0d0b14;border-color:#31284a;transition:border-color .16s,box-shadow .16s,background .16s}
    .k-field input:hover{border-color:#4b3d6f;background:#100d19}
    .k-hint{font-size:8px;color:#7b7297;line-height:1.3}
    .k-native-select{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}
    .k-select{position:relative;min-width:0}
    .k-select__button{width:100%;min-height:39px;display:grid;grid-template-columns:8px minmax(0,1fr) 18px;align-items:center;gap:9px;padding:8px 10px;border:1px solid #3a2e58;border-radius:9px;background:linear-gradient(180deg,#151120,#0d0b14);color:#f2effa;text-align:left;font:700 10px Inter,Segoe UI,Arial,sans-serif;cursor:pointer;transition:.16s}
    .k-select__button:hover,.k-select.is-open .k-select__button{border-color:#8068ef;background:#171226;box-shadow:0 0 0 3px rgba(123,102,255,.12)}
    .k-select__dot,.k-select__option i{width:7px;height:7px;border-radius:50%;background:var(--tone,#8a73ff);box-shadow:0 0 8px color-mix(in srgb,var(--tone,#8a73ff) 65%,transparent)}
    .k-select__chevron{color:#8f85ad;font-size:13px;text-align:center;transition:transform .16s}.k-select.is-open .k-select__chevron{transform:rotate(180deg);color:#bbaeff}
    .k-select__menu{position:absolute;z-index:40;left:0;right:0;top:calc(100% + 5px);display:none;padding:5px;border:1px solid #403360;border-radius:10px;background:#0d0b14;box-shadow:0 18px 38px rgba(0,0,0,.55),0 0 0 1px rgba(139,112,255,.08);max-height:220px;overflow:auto}
    .k-select.is-open .k-select__menu{display:grid;gap:3px}
    .k-select__option{display:grid;grid-template-columns:8px minmax(0,1fr) 16px;align-items:center;gap:9px;width:100%;padding:9px;border:0;border-radius:7px;background:transparent;color:#bdb5d2;text-align:left;font:700 10px Inter,Segoe UI,Arial,sans-serif;cursor:pointer}
    .k-select__option:hover,.k-select__option:focus-visible{outline:none;background:#1a1527;color:#fff}.k-select__option[aria-selected="true"]{background:linear-gradient(90deg,rgba(112,82,245,.3),rgba(112,82,245,.12));color:#fff}.k-select__option b{color:#9f8cff;text-align:center;opacity:0}.k-select__option[aria-selected="true"] b{opacity:1}
    .k-preview{grid-column:1/-1;border:1px solid #34294f;background:linear-gradient(135deg,#120e1c,#0d0b14);border-radius:11px;padding:11px;display:flex;align-items:center;gap:11px}
    .k-preview img,.k-preview-fallback{width:46px;height:46px;border-radius:14px;border:1px solid #4a3b6d;background:#181322}
    .k-preview img{object-fit:cover;display:none}
    .k-preview-fallback{display:grid;place-items:center;color:#ad9df1;font-weight:900}
    .k-preview strong{display:block;font-size:10px;color:#f0eefc}
    .k-preview span{display:block;margin-top:3px;color:#82799f;font-size:8px}
    .k-status-good{color:#70e1b0!important}.k-status-bad{color:#ff9dad!important}

    .k-settings{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .k-setting-card{border:1px solid #2b2343;background:#110e1a;border-radius:9px;padding:10px}
    .k-setting-card h4{font-size:10px;margin:0 0 9px;color:#f2effc}
    .k-choice-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .k-choice{border:1px solid #31284c;background:#0f0c18;color:#8f86ac;border-radius:8px;padding:8px;font-size:9px;cursor:pointer}
    .k-choice.active{border-color:#7c62ff;background:#251f39;color:#fff}
    .k-choice.size{display:flex;flex-direction:column;gap:2px;text-align:left}
    .k-choice.size b{font-size:9px}.k-choice.size span{font-size:7px;color:#7f769b}

    .k-codearea{height:330px;resize:none;font-family:Consolas,monospace;font-size:9px;line-height:1.4;white-space:pre}
    .k-codeinfo{border:1px solid #2b2343;background:#100d18;border-radius:9px;padding:9px;font-size:9px;color:#847b9f;line-height:1.4;margin-bottom:8px}
    .k-importarea{height:150px;resize:none;font-family:Consolas,monospace;font-size:9px;line-height:1.4}

    .k-bottom{
      height:50px;border-top:1px solid #241e37;background:#0b0a10;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px
    }
    .k-bottom-left,.k-bottom-right{display:flex;gap:7px;align-items:center}
    .k-toast{font-size:9px;color:#72e2b0;max-width:270px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .k-backdrop.embedded{position:relative;inset:auto;z-index:auto;background:transparent;backdrop-filter:none;display:block;padding:0;width:100%;min-height:620px}
    .k-backdrop.embedded .k-window{width:100%;height:620px;max-width:none;box-shadow:none}

    @media(max-width:760px){
      .k-window{width:calc(100vw - 20px);height:calc(100vh - 20px)}
      .k-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      .k-menu-grid,.k-settings,.k-form{grid-template-columns:1fr}
    }
`;
  shadow.appendChild(style);

  const launcher = document.createElement("button");
  launcher.className = "k-launcher right-bottom standard";
  launcher.title = CONFIG.brand.launcherTitle;
  launcher.innerHTML = `<img src="${asset("pridekeeper-paw.png")}" alt="">`;
  const hasUnifiedShell = !!window.PKFA?.version;
  const showLegacyLauncher = window.PKFA?.staffGate?.shouldShowLegacyLauncher
    ? window.PKFA.staffGate.shouldShowLegacyLauncher(hasUnifiedShell)
    : !hasUnifiedShell;
  launcher.hidden = !showLegacyLauncher;
  if (window.PKFA?.staffGate?.appendLegacyLauncher) {
    window.PKFA.staffGate.appendLegacyLauncher(shadow, launcher, hasUnifiedShell);
  } else if (showLegacyLauncher) shadow.appendChild(launcher);

  const backdrop = document.createElement("div");
  backdrop.className = "k-backdrop hidden";
  backdrop.innerHTML = `
    <div class="k-window" role="dialog" aria-modal="true">
      <div class="k-header">
        <div class="k-brand">
          <img class="k-brand-wordmark" src="${asset("pridekeeper-wordmark.png")}" alt="PRIDE KEEPER">
          <div class="k-titlebox">
            <strong>${CONFIG.brand.subtitle}</strong>
            <span>${CONFIG.brand.headerVersionText}</span>
          </div>
        </div>
        <div class="k-head-actions">
          <div class="k-head-dot"><img src="${asset("pridekeeper-paw.png")}" alt=""></div>
          <button class="k-x" data-act="close">×</button>
        </div>
      </div>
      <div class="k-body">
        <div class="k-scroll" data-slot="content"></div>
        <div class="k-bottom">
          <div class="k-bottom-left">
            <button class="k-btn" data-act="back">← Назад</button>
            <span class="k-toast" data-slot="toast"></span>
          </div>
          <div class="k-bottom-right" data-slot="bottomActions"></div>
        </div>
      </div>
    </div>
  `;
  shadow.appendChild(backdrop);

  const content = backdrop.querySelector('[data-slot="content"]');
  const toast = backdrop.querySelector('[data-slot="toast"]');
  const bottomActions = backdrop.querySelector('[data-slot="bottomActions"]');
  const backBtn = backdrop.querySelector('[data-act="back"]');

  let screen = "home";
  let history = [];
  let baseSnapshot = { sections: [], items: [] };
  let snapshot = { sections: [], items: [] };
  let searchText = "";
  let editContext = null;
  let currentCode = "";

  function say(msg, bad = false) {
    toast.textContent = msg || "";
    toast.style.color = bad ? "#ff9dad" : "#72e2b0";
    if (msg) setTimeout(() => { if (toast.textContent === msg) toast.textContent = ""; }, 3200);
  }

  async function applyLauncherSettings() {
    const state = await getState();
    const ui = state.ui || defaultState().ui;
    launcher.className = `k-launcher ${ui.position || "right-bottom"} ${ui.size || "standard"}`;
  }

  async function refreshData() {
    baseSnapshot = scanRoot(document);
    const state = await getState();
    snapshot = mergeSnapshot(baseSnapshot, state);
  }

  function setScreen(next, push = true) {
    if (push && screen !== next) history.push(screen);
    screen = next;
    render();
  }

  function goBack() {
    if (!history.length) return setScreen("home", false);
    screen = history.pop();
    render();
  }

  function openUI() {
    backdrop.classList.remove("hidden");
    refreshData().then(() => render());
  }

  function closeUI() {
    if (backdrop.classList.contains("embedded")) {
      window.PKFA?.panel?.close?.();
      return;
    }
    backdrop.classList.add("hidden");
    history = [];
    screen = "home";
    editContext = null;
  }

  launcher.addEventListener("click", openUI);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeUI();
  });
  backdrop.querySelector('[data-act="close"]').addEventListener("click", closeUI);
  backBtn.addEventListener("click", goBack);

  function sectionTitle(id) {
    return snapshot.sections.find(s => s.id === id)?.title || id;
  }

  function roleForSection(id) {
    const title = sectionTitle(id);
    return ROLE_OPTIONS.includes(title) ? title : ROLE_OPTIONS[0];
  }

  function findItem(key, kind) {
    return snapshot.items.find(x => x.key === key && x.kind === kind);
  }

  function roleOptions(selected) {
    const pick = ROLE_OPTIONS.includes(selected) ? selected : ROLE_OPTIONS[0];
    return ROLE_OPTIONS.map(v => `<option value="${esc(v)}"${v === pick ? " selected" : ""}>${esc(v)}</option>`).join("");
  }

  function sectionOptions(selected) {
    return snapshot.sections.map(s => `<option value="${esc(s.id)}"${s.id === selected ? " selected" : ""}>${esc(s.title)}</option>`).join("");
  }

  function roleTone(label) {
    return CONFIG.sections.find(section => section.title === label)?.color || "#8a73ff";
  }

  function enhanceStyledSelect(select, toneFor = () => "#8a73ff") {
    if (!select || select.__pkfaStyledSelect) return select?.__pkfaStyledSelect || null;
    const shell = document.createElement("div");
    shell.className = "k-select";
    select.parentNode.insertBefore(shell, select);
    shell.appendChild(select);
    select.classList.add("k-native-select");
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "k-select__button";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "k-select__menu";
    menu.setAttribute("role", "listbox");
    shell.append(button, menu);

    const close = () => {
      shell.classList.remove("is-open");
      button.setAttribute("aria-expanded", "false");
    };
    const refresh = () => {
      const options = [...select.options].map(option => ({ value: option.value, label: option.textContent, tone: toneFor(option.value, option.textContent) }));
      const model = buildSelectModel(options, select.value);
      button.innerHTML = `<i class="k-select__dot" style="--tone:${esc(model.selected.tone)}"></i><span>${esc(model.selected.label)}</span><b class="k-select__chevron">⌄</b>`;
      menu.innerHTML = model.options.map(option => `<button type="button" class="k-select__option" role="option" aria-selected="${option.selected}" data-k-option="${esc(option.value)}"><i style="--tone:${esc(option.tone)}"></i><span>${esc(option.label)}</span><b>✓</b></button>`).join("");
    };
    const commit = value => {
      if (select.value === value) return close();
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      refresh();
      close();
    };

    button.addEventListener("click", () => {
      const open = !shell.classList.contains("is-open");
      shell.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector('[aria-selected="true"]')?.focus();
    });
    menu.addEventListener("click", event => {
      const option = event.target.closest("[data-k-option]");
      if (option) commit(option.dataset.kOption);
    });
    shell.addEventListener("keydown", event => {
      if (event.key === "Escape") { close(); button.focus(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const index = nextSelectIndex(select.selectedIndex, event.key === "ArrowDown" ? 1 : -1, select.options.length);
      if (index >= 0) commit(select.options[index].value);
      button.focus();
    });
    shell.addEventListener("focusout", event => {
      if (!event.relatedTarget || !shell.contains(event.relatedTarget)) close();
    });
    select.addEventListener("change", refresh);
    select.__pkfaSelectRefresh = refresh;
    select.__pkfaStyledSelect = shell;
    refresh();
    return shell;
  }

  function displayAvatar(item) {
    if (item.forumId) return avatarUrl(item.forumId, "o");
    return item.avatar || "";
  }

  function cardHtml(item) {
    const src = displayAvatar(item);
    const fallback = esc((item.name || "?")[0]?.toUpperCase() || "?");
    const av = src
      ? `<img class="k-avatar k-avatar-img" data-forum-id="${esc(item.forumId || "")}" data-size="0" src="${esc(src)}"><div class="k-avatar k-fallback" style="display:none">${fallback}</div>`
      : `<div class="k-avatar k-fallback">${fallback}</div>`;

    return `
      <div class="k-person${item.hidden ? " off" : ""}" data-key="${esc(item.key)}" data-kind="${esc(item.kind)}">
        ${av}
        <div class="k-name">${esc(item.name || "Без ника")}</div>
        <div class="k-role">${item.hidden ? "БУДЕТ УБРАН" : esc(item.role || "Без должности")}</div>
        <div class="k-actions">
          <button class="k-mini" data-do="edit">✎</button>
          <button class="k-mini" data-do="${item.hidden ? "restore" : "remove"}">${item.hidden ? "↩" : "×"}</button>
        </div>
      </div>
    `;
  }

  function bindAvatarFallbacks(scope = content) {
    scope.querySelectorAll(".k-avatar-img").forEach(img => {
      img.addEventListener("error", () => {
        const id = img.dataset.forumId;
        const sizes = CONFIG.forum.avatarSizes;
        const next = Number(img.dataset.size || 0) + 1;
        if (id && next < sizes.length) {
          img.dataset.size = String(next);
          img.src = avatarUrl(id, sizes[next]);
        } else {
          img.style.display = "none";
          if (img.nextElementSibling) img.nextElementSibling.style.display = "grid";
        }
      });
    });
  }

  function renderHome() {
    backBtn.style.visibility = "hidden";
    bottomActions.innerHTML = "";
    content.innerHTML = `
      <div class="k-topcard">
        <div class="k-topicon">☰</div>
        <div class="k-toptext">
          <strong>${CONFIG.brand.title} • СОСТАВ</strong>
          <span>Редактор состава с автоматическим обновлением готового кода. Страница форума визуально не подменяется.</span>
        </div>
      </div>
      <div class="k-menu-grid">
        <button class="k-menu-card" data-go="staff">
          <div class="k-menu-ico">👥</div>
          <div><strong>Управление составом</strong><span>Добавить, убрать или изменить человека</span></div>
        </button>
        <button class="k-menu-card" data-go="code">
          <div class="k-menu-ico">⌘</div>
          <div><strong>Готовый код</strong><span>LIVE-код + ручное копирование при необходимости</span></div>
        </button>
        <button class="k-menu-card" data-go="backup">
          <div class="k-menu-ico">☁</div>
          <div><strong>Экспорт / импорт</strong><span>Резервная копия черновика</span></div>
        </button>
        <button class="k-menu-card" data-go="settings">
          <div class="k-menu-ico">⚙</div>
          <div><strong>Настройки кнопки</strong><span>Положение и размер круглой кнопки</span></div>
        </button>
      </div>
    `;
    content.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => setScreen(b.dataset.go)));
  }

  function renderStaff() {
    backBtn.style.visibility = "visible";
    bottomActions.innerHTML = `<button class="k-btn primary" data-go-code>Готовый код</button>`;
    const q = searchText.trim().toLowerCase();

    content.innerHTML = `
      <div class="k-topcard">
        <div class="k-topicon">👥</div>
        <div class="k-toptext"><strong>Управление составом</strong><span>Каждый раздел редактируется отдельно. Разработчики не затрагиваются.</span></div>
      </div>
      <div class="k-toolbar">
        <div class="k-search"><input data-search value="${esc(searchText)}" placeholder="Поиск по нику / должности"></div>
        <button class="k-btn green" data-add-any>＋ Добавить</button>
      </div>
      <div data-staff-list></div>
    `;

    const list = content.querySelector("[data-staff-list]");
    list.innerHTML = snapshot.sections.map(sec => {
      const all = snapshot.items.filter(i => i.section === sec.id);
      const shown = all.filter(i => !q || `${i.name} ${i.role} ${sec.title}`.toLowerCase().includes(q));
      if (q && !shown.length) return "";
      const active = all.filter(i => !i.hidden).length;
      return `
        <section class="k-section" data-sec="${esc(sec.id)}">
          <div class="k-sec-head">
            <div class="k-sec-title"><span class="k-sec-dot"></span>${esc(sec.title)} <span class="k-count">${active}</span></div>
            <button class="k-add" data-add-sec="${esc(sec.id)}">＋ Добавить</button>
          </div>
          <div class="k-grid">
            ${shown.map(cardHtml).join("")}
            <button class="k-new" data-add-sec="${esc(sec.id)}"><b>＋</b><span>Добавить человека</span></button>
          </div>
        </section>
      `;
    }).join("") || `<div class="k-topcard"><div class="k-toptext"><strong>Ничего не найдено</strong><span>Измени строку поиска.</span></div></div>`;

    content.querySelector("[data-search]").addEventListener("input", e => {
      searchText = e.target.value;
      renderStaff();
      const inp = content.querySelector("[data-search]");
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    });

    content.querySelector("[data-add-any]").addEventListener("click", () => {
      editContext = { item: null, section: snapshot.sections[0]?.id || "management" };
      setScreen("edit");
    });

    content.querySelectorAll("[data-add-sec]").forEach(btn => btn.addEventListener("click", () => {
      editContext = { item: null, section: btn.dataset.addSec };
      setScreen("edit");
    }));

    content.querySelectorAll(".k-person").forEach(card => {
      const item = findItem(card.dataset.key, card.dataset.kind);
      if (!item) return;
      card.querySelector('[data-do="edit"]').addEventListener("click", () => {
        editContext = { item, section: item.section };
        setScreen("edit");
      });
      const second = card.querySelector('[data-do="remove"],[data-do="restore"]');
      second?.addEventListener("click", async () => {
        const state = await getState();
        if (item.kind === "added") {
          if (item.hidden || second.dataset.do === "remove") {
            state.added = state.added.filter(x => x.id !== item.key);
          }
        } else {
          const cur = state.overrides[item.key] || {};
          state.overrides[item.key] = { ...cur, hidden: second.dataset.do === "remove" };
        }
        await setState(state);
        await refreshData();
        renderStaff();
        say(second.dataset.do === "remove" ? "Изменение добавлено в черновик" : "Человек возвращён");
      });
    });

    content.querySelector("[data-go-code]").addEventListener("click", () => setScreen("code"));
    bindAvatarFallbacks();
  }

  function renderEdit() {
    backBtn.style.visibility = "visible";
    const item = editContext?.item || null;
    const isNew = !item;
    const selectedSection = item?.section || editContext?.section || snapshot.sections[0]?.id || "management";
    const selectedRole = ROLE_OPTIONS.includes(item?.role) ? item.role : roleForSection(selectedSection);

    bottomActions.innerHTML = `
      ${!isNew ? `<button class="k-btn danger" data-remove>${item.kind === "added" ? "Удалить" : item.hidden ? "Вернуть" : "Убрать"}</button>` : ""}
      <button class="k-btn" data-save>Сохранить</button>
      <button class="k-btn primary" data-save-close>Сохранить и закрыть</button>
    `;

    content.innerHTML = `
      <div class="k-topcard">
        <div class="k-topicon">${isNew ? "＋" : "✎"}</div>
        <div class="k-toptext"><strong>${isNew ? "Добавление человека" : "Редактирование человека"}</strong><span>Аватар определяется автоматически по ID из ссылки профиля форума.</span></div>
      </div>
      <div class="k-form">
        <div class="k-field">
          <label>Раздел</label>
          <select data-f="section">${sectionOptions(selectedSection)}</select>
        </div>
        <div class="k-field">
          <label>Должность</label>
          <select data-f="role">${roleOptions(selectedRole)}</select>
        </div>
        <div class="k-field">
          <label>Форумный ник</label>
          <input data-f="name" value="${esc(item?.name || "")}" placeholder="Aiden_Legion">
        </div>
        <div class="k-field">
          <label>VK</label>
          <input data-f="vk" value="${esc(item?.vk || "")}" placeholder="https://vk.com/id...">
        </div>
        <div class="k-field full">
          <label>Профиль форума</label>
          <input data-f="forum" value="${esc(item?.forum || "")}" placeholder="https://forum.pridekeeper.tech/members/5/">
          <div class="k-hint">ID для аватарки вытягивается автоматически из /members/ID/ или /members/name.ID/.</div>
        </div>
        <div class="k-preview">
          <img data-preview-img>
          <div class="k-preview-fallback" data-preview-fallback>?</div>
          <div><strong>Аватар с форума</strong><span data-preview-status>Вставь ссылку профиля.</span></div>
        </div>
      </div>
    `;

    const sectionSel = content.querySelector('[data-f="section"]');
    const roleSel = content.querySelector('[data-f="role"]');
    sectionSel.addEventListener("change", () => {
      const suggested = roleForSection(sectionSel.value);
      if (ROLE_OPTIONS.includes(suggested)) {
        roleSel.value = suggested;
        roleSel.__pkfaSelectRefresh?.();
      }
    });
    enhanceStyledSelect(sectionSel, value => SECTION_COLORS[value] || "#8a73ff");
    enhanceStyledSelect(roleSel, (_value, label) => roleTone(label));

    async function updatePreview() {
      const forum = content.querySelector('[data-f="forum"]').value;
      const id = extractForumId(forum);
      const img = content.querySelector("[data-preview-img]");
      const fb = content.querySelector("[data-preview-fallback]");
      const st = content.querySelector("[data-preview-status]");

      img.style.display = "none";
      fb.style.display = "grid";
      fb.textContent = id ? id.slice(-2) : "?";
      st.className = "";

      if (!id) {
        st.textContent = "Вставь ссылку профиля.";
        return;
      }

      st.textContent = `ID ${id} • ищу аватар...`;
      const resolved = await resolveAvatarPath(id);
      img.onload = () => {
        img.style.display = "block";
        fb.style.display = "none";
        st.textContent = `ID ${id} • аватар найден`;
        st.className = "k-status-good";
      };
      img.onerror = () => {
        img.style.display = "none";
        fb.style.display = "grid";
        st.textContent = `ID ${id} • использую резервный путь`;
        st.className = "k-status-bad";
      };
      img.src = resolved ? location.origin + resolved : avatarUrl(id, "l");
    }

    content.querySelector('[data-f="forum"]').addEventListener("input", () => {
      clearTimeout(content.__pvTimer);
      content.__pvTimer = setTimeout(updatePreview, 250);
    });
    updatePreview();

    const collect = () => ({
      section: content.querySelector('[data-f="section"]').value,
      role: content.querySelector('[data-f="role"]').value,
      name: content.querySelector('[data-f="name"]').value.trim(),
      vk: content.querySelector('[data-f="vk"]').value.trim(),
      forum: content.querySelector('[data-f="forum"]').value.trim(),
      forumId: extractForumId(content.querySelector('[data-f="forum"]').value)
    });

    async function save(closeAfter = false) {
      const data = collect();
      if (!data.name) {
        say("Укажи форумный ник", true);
        content.querySelector('[data-f="name"]').focus();
        return false;
      }
      if (!data.forumId) {
        say("Не удалось определить ID из профиля форума", true);
        content.querySelector('[data-f="forum"]').focus();
        return false;
      }

      const state = await getState();

      if (item?.kind === "existing") {
        const cur = state.overrides[item.key] || {};
        state.overrides[item.key] = { ...cur, ...data, hidden: !!cur.hidden };
      } else {
        const id = item?.key || `added:${Date.now()}:${Math.random().toString(36).slice(2,8)}`;
        const rec = { id, kind: "added", ...data, hidden: false };
        const idx = state.added.findIndex(x => x.id === id);
        if (idx >= 0) state.added[idx] = rec;
        else state.added.push(rec);
      }

      await setState(state);
      await refreshData();
      say("Сохранено • LIVE-код обновляется автоматически");
      if (closeAfter) closeUI();
      else goBack();
      return true;
    }

    bottomActions.querySelector("[data-save]").addEventListener("click", () => save(false));
    bottomActions.querySelector("[data-save-close]").addEventListener("click", () => save(true));

    const removeBtn = bottomActions.querySelector("[data-remove]");
    if (removeBtn) removeBtn.addEventListener("click", async () => {
      const state = await getState();
      if (item.kind === "added") {
        state.added = state.added.filter(x => x.id !== item.key);
      } else {
        const cur = state.overrides[item.key] || {};
        state.overrides[item.key] = { ...cur, hidden: !item.hidden };
      }
      await setState(state);
      await refreshData();
      say(item.hidden ? "Человек возвращён" : "Убран из итогового кода");
      goBack();
    });
  }

  async function renderCode() {
    backBtn.style.visibility = "visible";
    bottomActions.innerHTML = `
      <button class="k-btn green" data-publish>Сохранить на форум сейчас</button>
      <button class="k-btn" data-copy>Копировать</button>
      <button class="k-btn primary" data-copy-close>Копировать и закрыть</button>
    `;
    content.innerHTML = `
      <div class="k-topcard">
        <div class="k-topicon">⌘</div>
        <div class="k-toptext"><strong>Генерация готового кода</strong><span>Собираю текущую страницу + все изменения черновика. Раздел разработчиков остаётся как в исходнике.</span></div>
      </div>
      <div class="k-codeinfo" data-codeinfo>Подготавливаю код...</div>
      <textarea class="k-codearea" data-code readonly></textarea>
    `;
    const info = content.querySelector("[data-codeinfo]");
    const area = content.querySelector("[data-code]");

    // Показываем последнюю автоматически собранную версию сразу.
    try {
      const cached = (await chrome.storage.local.get([CODE_CACHE_KEY]))?.[CODE_CACHE_KEY];
      if (cached?.code) {
        currentCode = cached.code;
        area.value = cached.code;
        const ageSec = Math.max(0, Math.round((Date.now() - (cached.updatedAt || Date.now())) / 1000));
        info.textContent = `LIVE-код из черновика • обновлён ${ageSec} сек. назад • сейчас сверяю с текущей страницей...`;
        info.style.color = "#9c8cff";
        bottomActions.querySelectorAll("button").forEach(b => b.disabled = false);
      } else {
        bottomActions.querySelectorAll("button").forEach(b => b.disabled = true);
      }
    } catch (_) {
      bottomActions.querySelectorAll("button").forEach(b => b.disabled = true);
    }

    try {
      const state = await getState();
      const result = await generateCode(state);
      if (!result.ok) throw new Error(result.error || "Ошибка генерации");

      currentCode = result.code;
      area.value = currentCode;
      await chrome.storage.local.set({
        [CODE_CACHE_KEY]: {
          code: currentCode,
          updatedAt: Date.now()
        }
      });

      info.textContent = `LIVE-код актуален • ${currentCode.length.toLocaleString("ru-RU")} символов • меняется автоматически после твоих правок`;
      info.style.color = "#9c8cff";
      bottomActions.querySelectorAll("button").forEach(b => b.disabled = false);
    } catch (e) {
      info.textContent = e.message || "Не удалось собрать код.";
      info.style.color = "#ff9dad";
    }

    async function copy(closeAfter) {
      if (!currentCode) return;
      try {
        await navigator.clipboard.writeText(currentCode);
      } catch (_) {
        area.focus(); area.select(); document.execCommand("copy");
      }
      say("Весь код скопирован");
      if (closeAfter) setTimeout(closeUI, 250);
    }

    bottomActions.querySelector("[data-publish]").addEventListener("click", async () => {
      say("Ищу «Изменить» и сохраняю...");
      await autoSaveCodeToForum();
    });

    bottomActions.querySelector("[data-copy]").addEventListener("click", () => copy(false));
    bottomActions.querySelector("[data-copy-close]").addEventListener("click", () => copy(true));
  }

  function renderBackup() {
    backBtn.style.visibility = "visible";
    bottomActions.innerHTML = "";
    content.innerHTML = `
      <div class="k-topcard">
        <div class="k-topicon">☁</div>
        <div class="k-toptext"><strong>Экспорт / импорт черновика</strong><span>Можно перенести свои изменения на другой браузер или сохранить резервную копию.</span></div>
      </div>
      <div class="k-menu-grid">
        <button class="k-menu-card" data-export>
          <div class="k-menu-ico">⇩</div><div><strong>Экспорт черновика</strong><span>Скопировать JSON с настройками и изменениями</span></div>
        </button>
        <button class="k-menu-card" data-import-toggle>
          <div class="k-menu-ico">⇧</div><div><strong>Импорт черновика</strong><span>Вставить ранее сохранённый JSON</span></div>
        </button>
      </div>
      <div style="margin-top:10px" class="hidden" data-import-box>
        <textarea class="k-importarea" data-import-text placeholder="Вставь JSON сюда..."></textarea>
        <div style="margin-top:8px;display:flex;justify-content:flex-end"><button class="k-btn primary" data-import>Импортировать</button></div>
      </div>
    `;

    content.querySelector("[data-export]").addEventListener("click", async () => {
      const state = await getState();
      const payload = JSON.stringify({ format: "kalus-staff-v2", exportedAt: new Date().toISOString(), state }, null, 2);
      await navigator.clipboard.writeText(payload);
      say("Резервная копия скопирована");
    });

    content.querySelector("[data-import-toggle]").addEventListener("click", () => {
      content.querySelector("[data-import-box]").classList.toggle("hidden");
    });

    content.querySelector("[data-import]").addEventListener("click", async () => {
      const raw = content.querySelector("[data-import-text]").value.trim();
      try {
        const parsed = JSON.parse(raw);
        const imported = parsed?.state || parsed;
        if (!imported || typeof imported !== "object") throw new Error("bad");
        imported.overrides ||= {};
        imported.added ||= [];
        imported.ui ||= defaultState().ui;
        await setState(imported);
        await applyLauncherSettings();
        await refreshData();
        say("Черновик импортирован • LIVE-код обновляется");
      } catch (_) {
        say("Некорректный JSON", true);
      }
    });
  }

  async function renderSettings() {
    backBtn.style.visibility = "visible";
    const state = await getState();
    const ui = state.ui || defaultState().ui;
    bottomActions.innerHTML = `
      <button class="k-btn" data-save-settings>Сохранить</button>
      <button class="k-btn primary" data-save-settings-close>Сохранить и закрыть</button>
    `;

    content.innerHTML = `
      <div class="k-topcard">
        <div class="k-topicon">⚙</div>
        <div class="k-toptext"><strong>Настройки кнопки меню</strong><span>Положение и размер плавающей paw-кнопки на форуме.</span></div>
      </div>
      <div class="k-settings">
        <div class="k-setting-card">
          <h4>Положение</h4>
          <div class="k-choice-grid" data-position>
            ${[
              ["right-top","Справа сверху"],
              ["right-bottom","Справа снизу"],
              ["left-top","Слева сверху"],
              ["left-bottom","Слева снизу"]
            ].map(([v,t]) => `<button class="k-choice${ui.position===v?" active":""}" data-v="${v}">${t}</button>`).join("")}
          </div>
        </div>
        <div class="k-setting-card">
          <h4>Размер кнопки</h4>
          <div class="k-choice-grid" data-size>
            ${[
              ["small","Маленькая","Компактная"],
              ["standard","Стандарт","По умолчанию"],
              ["large","Большая","Увеличенная"]
            ].map(([v,t,s]) => `<button class="k-choice size${ui.size===v?" active":""}" data-v="${v}"><b>${t}</b><span>${s}</span></button>`).join("")}
          </div>
        </div>
        <div class="k-setting-card" style="grid-column:1/-1">
          <h4>Автосохранение в пост форума</h4>
          <div class="k-choice-grid">
            <button class="k-choice${state.autoPublish?.enabled ? " active" : ""}" data-auto="on">
              Включено
            </button>
            <button class="k-choice${!state.autoPublish?.enabled ? " active" : ""}" data-auto="off">
              Выключено
            </button>
          </div>
          <div class="k-hint" style="margin-top:8px">
            После каждой правки скрипт сам ищет «Изменить», вставляет новый код и нажимает «Сохранить».
            ${state.autoPublish?.targetPostId ? `Привязанный post ID: ${esc(state.autoPublish.targetPostId)}` : "Post ID определится автоматически при первом сохранении."}
          </div>
        </div>
      </div>
    `;

    let draft = { ...ui };
    let autoDraft = {
      enabled: state.autoPublish?.enabled ?? CONFIG.autoPublish.enabledByDefault
    };

    content.querySelectorAll("[data-position] .k-choice").forEach(b => b.addEventListener("click", () => {
      draft.position = b.dataset.v;
      content.querySelectorAll("[data-position] .k-choice").forEach(x => x.classList.toggle("active", x === b));
    }));
    content.querySelectorAll("[data-size] .k-choice").forEach(b => b.addEventListener("click", () => {
      draft.size = b.dataset.v;
      content.querySelectorAll("[data-size] .k-choice").forEach(x => x.classList.toggle("active", x === b));
    }));

    content.querySelectorAll("[data-auto]").forEach(b => b.addEventListener("click", () => {
      autoDraft.enabled = b.dataset.auto === "on";
      content.querySelectorAll("[data-auto]").forEach(x => x.classList.toggle("active", x === b));
    }));

    async function saveSettings(closeAfter) {
      const st = await getState();
      st.ui = draft;
      st.autoPublish ||= {};
      st.autoPublish.enabled = autoDraft.enabled;
      // Сохраняем настройки напрямую, чтобы само включение настройки
      // не запускало публикацию лишний раз.
      await persistStaffState(st);
      workspaceBaseline = JSON.parse(JSON.stringify(st));
      staffDirty = false;
      await applyLauncherSettings();
      say(autoDraft.enabled ? "Автосохранение включено" : "Автосохранение выключено");
      if (closeAfter) setTimeout(closeUI, 200);
    }

    bottomActions.querySelector("[data-save-settings]").addEventListener("click", () => saveSettings(false));
    bottomActions.querySelector("[data-save-settings-close]").addEventListener("click", () => saveSettings(true));
  }

  function render() {
    if (screen === "home") return renderHome();
    if (screen === "staff") return renderStaff();
    if (screen === "edit") return renderEdit();
    if (screen === "code") return renderCode();
    if (screen === "backup") return renderBackup();
    if (screen === "settings") return renderSettings();
    return renderHome();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "KALUS_TOGGLE_UI") {
      if (backdrop.classList.contains("hidden")) openUI();
      else closeUI();
      sendResponse({ ok: true });
    }
  });

  window.addEventListener(window.PKFA?.staffGate?.OPEN_EVENT || "PKFA_OPEN_STAFF", () => {
    openUI();
  });

  window.PKFA = window.PKFA || {};
  window.PKFA.staff = { mountWorkspace, isDirty, discardChanges, preparePublish, findFirstPostEdit };

  // Если страница открылась как /posts/ID/edit после автоперехода,
  // сразу продолжаем именно редактирование существующего поста.
  if (getCurrentEditPostId()) {
    completePendingPublishOnEditPage().catch(err => {
      console.error("[PRIDE KEEPER Staff] pending publish failed:", err);
    });
  }

  applyLauncherSettings();
})();
