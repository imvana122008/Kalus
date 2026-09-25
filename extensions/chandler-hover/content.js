(function () {
  'use strict';

  const PRICE_CACHE_KEY = 'ktsAutoPriceCacheV7BackgroundSync';
  const PRICE_REFRESH_MS = 30 * 60 * 1000;
  const wikiRetryQueue = new Map();
  const wikiRetryAttempts = new Map();
  let wikiCooldownUntil = 0;
  let wikiNextRetrySlot = 0;

  function normalizeSpace(s) {
    return String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseNum(s) {
    const n = Number(String(s || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function moneyFmt(n) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(n || 0));
  }

  let priceCache = {};
  chrome.storage.local.get(PRICE_CACHE_KEY).then(saved => {
    const value = saved[PRICE_CACHE_KEY];
    if (value && typeof value === 'object') priceCache = { ...value, ...priceCache };
  }).catch(() => {});

  function getPriceCache() {
    return priceCache;
  }

  function savePriceCache() {
    chrome.storage.local.set({ [PRICE_CACHE_KEY]: priceCache }).catch(() => {});
  }

  function cachePrice(itemId, value) {
    priceCache[String(itemId)] = { ...value, at: Number(value.at || Date.now()) };
    savePriceCache();
  }

  function cachedPrice(itemId) {
    const c = getPriceCache()[String(itemId)];
    if (!c || !(c.price || c.sellPrice || c.buyPrice || c.medianSale)) return null;
    return Date.now() - Number(c.at || 0) < PRICE_REFRESH_MS ? c : null;
  }

  const hoverPriceState = {
    host: null,
    key: '',
    item: null,
    token: 0,
    x: 0,
    y: 0,
    hideTimer: null,
  };

  function ensureHoverPriceTooltip() {
    let tip = document.querySelector('#kts-hover-price');
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'kts-hover-price';
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);
    return tip;
  }

  function parseHoverTrade(text) {
    const s = normalizeSpace(text);
    const idm = s.match(/\[id:\s*(\d+)\]/i);
    if (!idm) return null;
    const itemId = Number(idm[1]);

    let qty = 1;
    const qm = s.match(/(?:в\s+количестве|количеств[оае])\s*[:=]?\s*(\d+)/i);
    if (qm) qty = Math.max(1, Number(qm[1]) || 1);

    // Название ровно перед [id: N]. Убираем служебные части фразы LogsParser.
    const before = s.slice(0, s.search(/\[id:\s*\d+\]/i)).trim();
    let itemName = '';
    const patterns = [
      /в\s+инвентарь\s+(.+)$/i,
      /положил\s+в\s+трейлер\s*№?\s*\d+\s+(.+)$/i,
      /(?:получил|передал|выдал|забрал|купил|продал)\s+(?:в\s+инвентарь\s+)?(.+)$/i,
    ];
    for (const rx of patterns) {
      const m = before.match(rx);
      if (m?.[1]) {
        itemName = normalizeSpace(m[1])
          .replace(/^от\s+игрока\s+[A-Za-z0-9_]+\s+/i, '')
          .replace(/^игроку\s+[A-Za-z0-9_]+\s+/i, '');
        break;
      }
    }
    if (!itemName) {
      // Последний кусок перед ID обычно и есть название предмета.
      const m = before.match(/([A-Za-zА-Яа-яЁё0-9][^|]{1,90})$/);
      itemName = normalizeSpace(m?.[1] || `Предмет ${itemId}`);
    }
    itemName = itemName.replace(/\s+(?:в\s+количестве|количеств[оае])\s*[:=]?\s*\d+$/i, '');
    return { itemId, item: itemName, qty };
  }

  function pointerOnItemName(row, item, x, y) {
    const name = normalizeSpace(item.item);
    if (!name || !row) return false;
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    const positions = [];
    let content = '';
    let node;
    while ((node = walker.nextNode())) {
      for (let i = 0; i < node.textContent.length; i++) {
        const char = /\s|\u00a0/.test(node.textContent[i]) ? ' ' : node.textContent[i];
        if (char === ' ' && content.endsWith(' ')) continue;
        content += char;
        positions.push({ node, offset: i });
      }
    }
    const marker = content.search(new RegExp(`\\[id:\\s*${item.itemId}\\]`, 'i'));
    if (marker < 0) return false;
    const start = content.lastIndexOf(name, marker);
    if (start < 0) return false;
    const range = document.createRange();
    range.setStart(positions[start].node, positions[start].offset);
    const last = positions[start + name.length - 1];
    range.setEnd(last.node, last.offset + 1);
    return [...range.getClientRects()].some(rect =>
      rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }

  function candidateUnderPointer(x, y) {
    const roots = document.elementsFromPoint(x, y);
    const seen = new Set();

    for (const root of roots) {
      let el = root;
      for (let depth = 0; el && el !== document.body && depth < 10; depth++, el = el.parentElement) {
        if (!(el instanceof Element) || seen.has(el)) continue;
        seen.add(el);
        if (el.closest('#kts-panel, #kts-hover-price')) continue;

        const t = normalizeSpace(el.innerText || el.textContent || '');
        if (!t || t.length > 3500 || !/\[id:\s*\d+\]/i.test(t)) continue;

        // Если курсор оказался прямо над маленьким span с ID, всё равно берём
        // полный текст строки, чтобы корректно вытащить название предмета.
        const row = el.closest('tr');
        const rowText = row ? normalizeSpace(row.innerText || row.textContent || '') : t;
        const sourceText = (rowText && rowText.length < 5000 && /\[id:\s*\d+\]/i.test(rowText)) ? rowText : t;
        const item = parseHoverTrade(sourceText);
        if (!item?.itemId) continue;

        if (!pointerOnItemName(row || el, item, x, y)) continue;
        return { host: row || el, item, text: sourceText };
      }
    }
    return null;
  }

  function positionHoverPriceTooltip(x, y) {
    hoverPriceState.x = x;
    hoverPriceState.y = y;
    const tip = document.querySelector('#kts-hover-price');
    if (!tip || !tip.classList.contains('show')) return;

    const gap = 18;
    const pad = 10;
    let left = x + gap;
    let top = y + gap;
    const rect = tip.getBoundingClientRect();

    if (left + rect.width > window.innerWidth - pad) left = x - rect.width - gap;
    if (top + rect.height > window.innerHeight - pad) top = y - rect.height - gap;
    left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - rect.height - pad));

    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  function showHoverPriceTooltip(html, x = hoverPriceState.x, y = hoverPriceState.y) {
    clearTimeout(hoverPriceState.hideTimer);
    const tip = ensureHoverPriceTooltip();
    tip.innerHTML = html;
    tip.classList.add('show');
    tip.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => positionHoverPriceTooltip(x, y));
  }

  function hideHoverPriceTooltip(delay = 0) {
    clearTimeout(hoverPriceState.hideTimer);
    hoverPriceState.hideTimer = setTimeout(() => {
      const itemId = hoverPriceState.item?.itemId;
      const pending = wikiRetryQueue.get(itemId);
      if (pending) {
        clearTimeout(pending.timer);
        wikiRetryQueue.delete(itemId);
      }
      const tip = document.querySelector('#kts-hover-price');
      if (tip) {
        tip.classList.remove('show');
        tip.setAttribute('aria-hidden', 'true');
      }
      hoverPriceState.host = null;
      hoverPriceState.key = '';
      hoverPriceState.item = null;
      hoverPriceState.token++;
    }, delay);
  }

  function hoverPriceHtml(item, info, loading = false) {
    const sell = Number(info?.sellPrice || 0);
    const buy = Number(info?.buyPrice || 0);
    const medianSale = Number(info?.medianSale || 0);
    const qty = Math.max(1, Number(item.qty || 1));
    const serverCount = Number(info?.serverCount || info?.serverRows?.length || 0);
    const volume = Number(info?.chandlerVolume || 0);

    if (loading) {
      return `
        <div class="kts-hover-head"><span>📦 ${esc(item.item || `Предмет ${item.itemId}`)}</span><span class="kts-hover-id">ID ${item.itemId}</span></div>
        <div class="kts-hover-loading"><span class="kts-hover-universe" aria-hidden="true"><span class="kts-hover-orbit"><i class="kts-hover-moon"></i><i class="kts-hover-moon kts-hover-moon-second"></i></span><span class="kts-hover-planet"></span></span><span><b>Загружаю цены…</b><br><small>все серверы + Chandler</small></span></div>`;
    }

    const medianText = medianSale ? `${moneyFmt(medianSale)} $` : 'нет данных';
    const sellText = sell ? `${moneyFmt(sell)} $` : 'нет данных';
    const buyText = buy ? `${moneyFmt(buy)} $` : 'нет данных';
    const qtyHtml = qty > 1
      ? `<div class="kts-hover-total">Количество x${qty}: <b>${sell ? moneyFmt(sell * qty) + ' $' : '—'}</b> продажа • <b>${buy ? moneyFmt(buy * qty) + ' $' : '—'}</b> скупка</div>`
      : '';

    return `
      <div class="kts-hover-head"><span>📦 ${esc(info?.itemName || item.item || `Предмет ${item.itemId}`)}</span><span class="kts-hover-id">ID ${item.itemId}</span></div>
      <div class="kts-hover-median">
        <span>Медиана продажи · все серверы</span>
        <b>${medianText}</b>
        ${serverCount ? `<small>${serverCount} серверов</small>` : ''}
      </div>
      <div class="kts-hover-chandler-title"><b>4. Chandler</b>${volume ? `<span>объём ${moneyFmt(volume)}</span>` : ''}</div>
      <div class="kts-hover-prices">
        <div><span>Продажа</span><b class="kts-hover-sell">${sellText}</b></div>
        <div><span>Скупка</span><b class="kts-hover-buy">${buyText}</b></div>
      </div>
      ${qtyHtml}
      <div class="kts-hover-source">wiki.arz-mcr.ru/items/${item.itemId}${info?.at && Date.now() - Number(info.at) > PRICE_REFRESH_MS ? ' • старые данные' : info?.cached ? ' • кэш' : ' • live'}${info?.source ? ` • ${esc(info.source)}` : ''}</div>`;
  }

  function parseFastWikiPrice(data, itemId) {
    if (Number(data?.itemId) !== Number(itemId) || data.unknown || !Array.isArray(data.servers)) return null;
    const servers = data.servers.filter(s => Number(s.server) > 0 && s.status === 'ok');
    const sales = servers.map(s => Math.round(Number(s.sell?.avg) || 0)).filter(n => n > 0).sort((a, b) => a - b);
    const mid = Math.floor(sales.length / 2);
    const medianSale = sales.length ? Math.round(sales.length % 2 ? sales[mid] : (sales[mid - 1] + sales[mid]) / 2) : 0;
    const chandler = data.servers.find(s => Number(s.server) === 4 && s.status === 'ok');
    const sellPrice = Math.round(Number(chandler?.sell?.avg) || 0);
    const buyPrice = Math.round(Number(chandler?.buy?.avg) || 0);
    if (!medianSale && !sellPrice && !buyPrice) return null;
    return { itemId, itemName: String(data.name || `Предмет ${itemId}`), price: sellPrice || medianSale || buyPrice,
      medianSale, sellPrice, buyPrice, serverCount: servers.length, at: Date.now(), source: 'Wiki • быстро' };
  }

  function retryAfterMs(headers) {
    const raw = String(headers || '').match(/^retry-after:\s*([^\r\n]+)/im)?.[1]?.trim();
    if (!raw) return 60000;
    if (/^\d+$/.test(raw)) return Math.max(1000, Number(raw) * 1000);
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 60000;
  }

  function fastWikiPrice(itemId) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'getItemPrice', itemId }, response => {
          if (chrome.runtime.lastError || !response) {
            resolve({ price: null, retryable: true });
            return;
          }
          if (response.status === 429) {
            const delay = retryAfterMs(response.retryAfter ? `retry-after: ${response.retryAfter}` : '');
            wikiCooldownUntil = Math.max(wikiCooldownUntil, Date.now() + delay);
            resolve({ price: null, retryable: true, retryAfter: delay });
            return;
          }
          if (response.status !== 200) {
            resolve({ price: null, retryable: !response.status || response.status >= 500 });
            return;
          }
          try {
            resolve({ price: parseFastWikiPrice(response.data, itemId), retryable: false });
          } catch (_) {
            resolve({ price: null, retryable: true });
          }
        });
      } catch (_) {
        resolve({ price: null, retryable: true });
      }
    });
  }

  function within(promise, ms) {
    return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
  }

  function showRetriedPrice(itemId, info) {
    if (hoverPriceState.item?.itemId === itemId && hoverPriceState.host &&
        document.querySelector('#kts-hover-price')?.classList.contains('show')) {
      showHoverPriceTooltip(hoverPriceHtml(hoverPriceState.item, info), hoverPriceState.x, hoverPriceState.y);
    }
  }

  function scheduleWikiRetry(itemId, itemName, retryAfter = 0) {
    if (wikiRetryQueue.has(itemId)) return wikiRetryQueue.get(itemId).nextAt;
    if (wikiRetryQueue.size >= 20) return null;
    const attempt = (wikiRetryAttempts.get(itemId) || 0) + 1;
    wikiRetryAttempts.set(itemId, attempt);
    const wait = Math.min(30 * 60000, 30000 * 2 ** Math.min(attempt, 6));
    const nextAt = Math.max(Date.now() + wait, Date.now() + retryAfter, wikiCooldownUntil, wikiNextRetrySlot);
    wikiNextRetrySlot = nextAt + 2000;
    const timer = setTimeout(async () => {
      wikiRetryQueue.delete(itemId);
      if (hoverPriceState.item?.itemId !== itemId ||
          !document.querySelector('#kts-hover-price')?.classList.contains('show')) return;
      if (Date.now() < wikiCooldownUntil) {
        scheduleWikiRetry(itemId, itemName, wikiCooldownUntil - Date.now());
        return;
      }
      const result = await within(fastWikiPrice(itemId), 1650);
      if (result?.price) {
        cachePrice(itemId, result.price);
        wikiRetryAttempts.delete(itemId);
        showRetriedPrice(itemId, result.price);
      } else if (!result || result.retryable) {
        scheduleWikiRetry(itemId, itemName, result?.retryAfter);
      } else {
        wikiRetryAttempts.delete(itemId);
      }
    }, Math.max(0, nextAt - Date.now()));
    timer?.unref?.();
    wikiRetryQueue.set(itemId, { timer, nextAt });
    return nextAt;
  }

  async function loadHoverPrice(candidate, mouseX, mouseY) {
    const { host, item } = candidate;
    const key = `${item.itemId}|${item.item}|${item.qty || 1}`;
    if (hoverPriceState.key === key && hoverPriceState.host === host) {
      positionHoverPriceTooltip(mouseX, mouseY);
      return;
    }

    hoverPriceState.host = host;
    hoverPriceState.key = key;
    hoverPriceState.item = item;
    const token = ++hoverPriceState.token;

    const cached = cachedPrice(item.itemId);
    if (cached) {
      showHoverPriceTooltip(hoverPriceHtml(item, { ...cached, cached: true }), mouseX, mouseY);
      return;
    }

    const old = getPriceCache()[String(item.itemId)];
    if (old?.sellPrice || old?.buyPrice || old?.medianSale) {
      showHoverPriceTooltip(hoverPriceHtml(item, { ...old, cached: true, stale: true }), mouseX, mouseY);
    } else showHoverPriceTooltip(hoverPriceHtml(item, null, true), mouseX, mouseY);

    const miss = old?.missUntil > Date.now();
    let info = null;
    if (!miss && token === hoverPriceState.token) {
      if (Date.now() < wikiCooldownUntil) {
        scheduleWikiRetry(item.itemId, item.item, wikiCooldownUntil - Date.now());
      } else if (!wikiRetryQueue.has(item.itemId)) {
        const result = await within(fastWikiPrice(item.itemId), 1650);
        if (result?.price) {
          cachePrice(item.itemId, result.price);
          info = result.price;
        } else if (!result || result.retryable) {
          scheduleWikiRetry(item.itemId, item.item, result?.retryAfter);
        }
      }
    }
    if (!info) {
      const c = getPriceCache();
      c[String(item.itemId)] = { ...(old || {}), missUntil: Date.now() + 30000 };
      savePriceCache();
    }
    const oldHasPrice = old?.sellPrice || old?.buyPrice || old?.medianSale;
    const pendingRetry = wikiRetryQueue.has(item.itemId);
    info = info || (oldHasPrice ? { ...old, cached: true } : {
      sellPrice: 0, buyPrice: 0, medianSale: 0,
      source: pendingRetry ? 'Wiki временно недоступна — повторю автоматически' : 'Цена пока не найдена; попробуй позже',
    });
    if (pendingRetry && (info.sellPrice || info.buyPrice || info.medianSale)) {
      info = { ...info, source: `${info.source || 'кэш'} • Wiki обновится автоматически` };
    }

    if (token !== hoverPriceState.token || hoverPriceState.key !== key) return;
    showHoverPriceTooltip(hoverPriceHtml(item, info), hoverPriceState.x, hoverPriceState.y);
  }

  function startHoverPriceCards() {
    ensureHoverPriceTooltip();

    const handlePointer = (e) => {
      if (!(e.target instanceof Element)) return;
      const c = candidateUnderPointer(e.clientX, e.clientY);
      if (!c) {
        hideHoverPriceTooltip(120);
        return;
      }
      loadHoverPrice(c, e.clientX, e.clientY);
    };

    document.addEventListener('pointermove', handlePointer, true);
    document.addEventListener('mousemove', handlePointer, true); // резерв для старых браузеров
    document.addEventListener('mouseleave', () => hideHoverPriceTooltip(0), true);
    window.addEventListener('blur', () => hideHoverPriceTooltip(0));
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  if (location.hostname !== 'arizonarp.logsparser.info') return;

  function boot() {
    if (!document.body || window.__ktsHoverBooted) return;
    window.__ktsHoverBooted = true;
    startHoverPriceCards();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
