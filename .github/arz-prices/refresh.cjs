'use strict';
const {chromium}=require('playwright-core');
const SITE='https://kalus-price-hub.imvana122008.chatgpt.site';

function parseWikiPagePrice(doc,itemId,at=Date.now()) {
  const number=raw=>Number(String(raw||'').replace(/[^0-9]/g,''))||0;
  const medianSale=number(doc.text.match(/Медиана продажи\s*([\d\s\u00a0]+\s*\$)/i)?.[1]);
  const chandler=doc.row.match(/продажа\s*([\d\s\u00a0]+)\s*\$.*?скупка\s*([\d\s\u00a0]+)\s*\$/i);
  const sellPrice=number(chandler?.[1]),buyPrice=number(chandler?.[2]);
  if(!medianSale&&!sellPrice&&!buyPrice)return null;
  return {itemId,itemName:String(doc.name||`Предмет ${itemId}`).slice(0,180),medianSale,sellPrice,buyPrice,serverCount:Number(doc.text.match(/Цены есть на\s*(\d+)/i)?.[1]||0),at};
}

function selectForRefresh(catalog,watched,cursor,scanCount,watchedCount=2,watchCursor=0){
  const byId=new Map(catalog.map(x=>[x.id,x])),selected=new Map(),watchedItems=[],scanItems=[];
  for(let i=0;i<Math.min(watchedCount,watched.length);i++){
    const x=watched[(watchCursor+i)%watched.length],id=Number(x.itemId);
    if(id>0&&!selected.has(id)){
      const item=byId.get(id)||{id,name:x.itemName||`Предмет ${id}`};
      selected.set(id,item);watchedItems.push(item);
    }
  }
  for(let i=0;i<Math.min(scanCount,catalog.length);i++){
    const x=catalog[(cursor+i)%catalog.length];
    scanItems.push(x);
    if(!selected.has(x.id))selected.set(x.id,x);
  }
  return {items:[...selected.values()],watchedItems,scanItems,nextCursor:catalog.length?(cursor+scanCount)%catalog.length:0};
}

async function githubIdentity(){
  const address=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  address.searchParams.set('audience','kalus-price-hub');
  const r=await fetch(address,{headers:{Authorization:`bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}});
  if(!r.ok)throw Error(`GitHub identity HTTP ${r.status}`);
  const {value}=await r.json();if(!value)throw Error('GitHub identity missing');return value;
}

async function scrapeRenderedItem(page,itemId){
  let rateLimited=false;
  const onResponse=r=>{if(r.status()===429&&new URL(r.url()).hostname==='wiki.arz-mcr.ru')rateLimited=true;};
  page.on('response',onResponse);
  try{
    const response=await page.goto(`https://wiki.arz-mcr.ru/items/${itemId}`,{waitUntil:'domcontentloaded',timeout:20000});
    if(response?.status()===404)return null;
    const row=page.getByRole('button',{name:/4\.\s*Chandler.*продажа.*скупка/i});
    try{await row.waitFor({state:'visible',timeout:6000});}
    catch(e){if(rateLimited)throw Error('Wiki rate limit (429)');return null;}
    if(rateLimited)throw Error('Wiki rate limit (429)');
    const main=page.locator('main');
    return parseWikiPagePrice({
      text:await main.innerText(),
      row:await row.getAttribute('aria-label')||await row.innerText(),
      name:await main.locator('h1').first().innerText()
    },itemId);
  }finally{page.off('response',onResponse);}
}

function getCandidateIds(){return Array.from({length:12000},(_,i)=>({id:i+1,name:`Предмет ${i+1}`}));}

async function importBatch(items,token){
  if(!items.length)return;
  const r=await fetch(SITE+'/api/prices/import',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({items})});
  if(!r.ok)throw Error(`Import HTTP ${r.status}: ${(await r.text()).slice(0,150)}`);
}
async function advanceCursor(previousId,token){
  const nextId=previousId%12000+1;
  const r=await fetch(SITE+'/api/sync-state',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({previousId,nextId})});
  if(!r.ok)throw Error(`Cursor HTTP ${r.status}: ${(await r.text()).slice(0,120)}`);
}

async function main(){
  const [watchResponse,cursorResponse]=await Promise.all([
    fetch(SITE+'/api/watchlist',{headers:{'Cache-Control':'no-cache'}}),
    fetch(SITE+'/api/sync-state',{headers:{'Cache-Control':'no-cache'}})
  ]);
  if(!watchResponse.ok||!cursorResponse.ok)throw Error(`Site HTTP ${watchResponse.status}/${cursorResponse.status}`);
  const {items:watched}=await watchResponse.json(),state=await cursorResponse.json(),token=await githubIdentity();
  if(!Number.isInteger(state.nextId)||state.nextId<1||state.nextId>12000)throw Error('Invalid saved cursor');
  if(process.env.GITHUB_EVENT_NAME==='schedule' && state.updatedAt && Date.now()-state.updatedAt<20*60*1000){
    console.log('Recent scan already finished; skip duplicate scheduled run');
    return;
  }
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage();
    const catalog=getCandidateIds(),cursor=state.nextId-1;
    const selected=selectForRefresh(catalog,watched||[],cursor,6,1,Math.floor(Date.now()/1800000));
    console.log(`Sequential range 1..${catalog.length}; next ID ${state.nextId}; priority ${selected.watchedItems.length}; scanning ${selected.scanItems.length}`);
    let updated=0,unknown=0,scanned=0;
    const checked=new Map();
    for(const item of [...selected.watchedItems,...selected.scanItems]){
      let record;
      if(checked.has(item.id))record=checked.get(item.id);
      else{
        try{record=await scrapeRenderedItem(page,item.id);}
        catch(e){
          if(String(e.message).includes('Wiki rate limit (429)')){
            console.log(`Wiki rate limited; saved progress through ${scanned} sequential IDs; will continue next run`);
            break;
          }
          throw e;
        }
        checked.set(item.id,record);
        if(record){await importBatch([record],token);updated++;}else unknown++;
        await new Promise(resolve=>setTimeout(resolve,900));
      }
      if(selected.scanItems[scanned]?.id===item.id && item===selected.scanItems[scanned]){
        await advanceCursor(item.id,token);scanned++;
      }
    }
    console.log(`Complete: ${updated} prices, ${unknown} without price, ${scanned} sequential IDs checked`);
  }finally{await browser.close();}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={parseWikiPagePrice,selectForRefresh};
