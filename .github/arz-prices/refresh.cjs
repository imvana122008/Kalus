'use strict';
const { chromium } = require('playwright-core');
const SITE = 'https://kalus-price-hub.imvana122008.chatgpt.site';
const num = (raw) => Number(String(raw || '').replace(/[^0-9]/g, '')) || 0;

function parseWikiPrices(doc, itemId) {
  const medianSale = num(doc.text.match(/Медиана продажи\s*([\d\s\u00a0]+\s*\$)/i)?.[1]);
  const m = doc.row.match(/продажа\s*([\d\s\u00a0]+)\s*\$.*?скупка\s*([\d\s\u00a0]+)\s*\$/i);
  const sellPrice = num(m?.[1]);
  const buyPrice = num(m?.[2]);
  if (!medianSale && !sellPrice && !buyPrice) throw new Error(`No prices for ${itemId}`);
  return { itemId, itemName: doc.name, medianSale, sellPrice, buyPrice,
    serverCount: Number(doc.text.match(/Цены есть на\s*(\d+)/i)?.[1] || 0), at: Date.now() };
}

async function githubIdentity() {
  const address = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  address.searchParams.set('audience', 'kalus-price-hub');
  const r = await fetch(address, { headers: { Authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  if (!r.ok) throw new Error(`GitHub identity HTTP ${r.status}`);
  const { value } = await r.json();
  if (!value) throw new Error('GitHub identity missing');
  return value;
}

async function scrape(browser, item) {
  const page = await browser.newPage();
  try {
    if (Number(item.itemId) === 1766) {
      page.on('response', async r => {
        try {
          const u = new URL(r.url());
          if (u.hostname !== 'wiki.arz-mcr.ru') return;
          const type = r.headers()['content-type'] || '';
          if (!/json|text\/html/.test(type)) return;
          const body = await r.text();
          let shape = '';
          if (/json/.test(type)) {
            try { const obj = JSON.parse(body); shape = Array.isArray(obj) ? `array:${obj.length}` : `keys:${Object.keys(obj).slice(0,10).join(',')}`; } catch (_) {}
          }
          console.log(`WIKI_RESPONSE ${r.status()} ${u.pathname} type=${type.split(';')[0]} bytes=${body.length} ${shape}`);
        } catch (_) {}
      });
    }
    const id = Number(item.itemId);
    if (!Number.isInteger(id) || id < 1 || id > 99999) throw new Error('Invalid item ID');
    await page.goto(`https://wiki.arz-mcr.ru/items/${id}`, { waitUntil: 'domcontentloaded', timeout: 19000 });
    const row = page.getByRole('button', { name: /4\.\s*Chandler.*продажа.*скупка/i });
    await row.waitFor({ state: 'visible', timeout: 19000 });
    const main = page.locator('main');
    const doc = {
      text: await main.innerText(),
      row: await row.getAttribute('aria-label') || await row.innerText(),
      name: await main.locator('h1').first().innerText()
    };
    return parseWikiPrices(doc, id);
  } finally { await page.close(); }
}

async function main() {
  const response = await fetch(SITE + '/api/watchlist', { headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error(`Watchlist HTTP ${response.status}`);
  const { items } = await response.json();
  if (!Array.isArray(items)) throw new Error('Invalid watchlist');
  const selected = items.slice(0, 6);
  if (!selected.length) throw new Error('Watchlist empty');
  const token = await githubIdentity();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  let successes = 0;
  try {
    let next = 0;
    const workers = Array.from({ length: Math.min(3, selected.length) }, async () => {
      while (next < selected.length) {
        const item = selected[next++];
        try {
          const data = await scrape(browser, item);
          const upload = await fetch(SITE + '/api/prices/import', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify(data)
          });
          if (!upload.ok) throw new Error(`Import HTTP ${upload.status}: ${(await upload.text()).slice(0,180)}`);
          successes++;
          console.log(`Updated item ${data.itemId}: median ${data.medianSale}, Chandler ${data.sellPrice}/${data.buyPrice}`);
        } catch (e) { console.warn(`Item ${item.itemId} failed: ${e.message}`); }
      }
    });
    await Promise.all(workers);
  } finally { await browser.close(); }
  if (!successes) throw new Error('No prices updated');
  console.log(`Updated ${successes}/${selected.length} items`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { parseWikiPrices };
