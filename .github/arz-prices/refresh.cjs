'use strict';
const {chromium}=require('playwright-core');
const SITE='https://kalus-price-hub.imvana122008.chatgpt.site';

function parseWikiApiPrice(data,itemId,at=Date.now()) {
  if(data?.itemId!==itemId||data.unknown||!Array.isArray(data.servers))return null;
  const servers=data.servers.filter(s=>s.server>0&&s.status==='ok'&&(s.sell?.avg>0||s.buy?.avg>0));
  const sells=servers.map(s=>Math.round(s.sell?.avg||0)).filter(Boolean).sort((a,b)=>a-b);
  const mid=Math.floor(sells.length/2);
  const medianSale=sells.length?Math.round(sells.length%2?sells[mid]:(sells[mid-1]+sells[mid])/2):0;
  const chandler=data.servers.find(s=>s.server===4);
  const sellPrice=Math.round(chandler?.sell?.avg||0),buyPrice=Math.round(chandler?.buy?.avg||0);
  if(!medianSale&&!sellPrice&&!buyPrice)return null;
  return {itemId,itemName:String(data.name||`Предмет ${itemId}`).slice(0,180),medianSale,sellPrice,buyPrice,serverCount:servers.length,at};
}

function selectForRefresh(catalog,watched,cursor,limit){
  const byId=new Map(catalog.map(x=>[x.id,x])),selected=new Map();
  for(const x of watched){const id=Number(x.itemId);if(id>0&&!selected.has(id)&&selected.size<limit)selected.set(id,byId.get(id)||{id,name:x.itemName||`Предмет ${id}`});}
  let checked=0;
  while(checked<catalog.length&&selected.size<limit){const x=catalog[(cursor+checked)%catalog.length];if(!selected.has(x.id))selected.set(x.id,x);checked++;}
  return {items:[...selected.values()],nextCursor:catalog.length?(cursor+checked)%catalog.length:0};
}

async function githubIdentity(){
  const address=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  address.searchParams.set('audience','kalus-price-hub');
  const r=await fetch(address,{headers:{Authorization:`bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}});
  if(!r.ok)throw Error(`GitHub identity HTTP ${r.status}`);
  const {value}=await r.json();if(!value)throw Error('GitHub identity missing');return value;
}

async function wikiGet(page,path){
  return page.evaluate(async path=>{const r=await fetch(path,{headers:{accept:'application/json'}});if(!r.ok)throw Error(`${path.split('?')[0]} HTTP ${r.status}`);return r.json();},path);
}

async function getCatalog(page){
  const first=await wikiGet(page,'/api/items?offset=0&limit=60&slot=all&type=all');
  if(!Number.isInteger(first.total)||first.total<1||!Array.isArray(first.items))throw Error('Invalid catalog');
  const all=[...first.items],offsets=Array.from({length:Math.ceil(first.total/60)-1},(_,i)=>(i+1)*60);
  for(let i=0;i<offsets.length;i+=4){
    const pages=await Promise.all(offsets.slice(i,i+4).map(offset=>wikiGet(page,`/api/items?offset=${offset}&limit=60&slot=all&type=all`)));
    for(const data of pages)all.push(...data.items);
  }
  const catalog=[...new Map(all.filter(x=>Number.isInteger(x.id)&&x.id>0).map(x=>[x.id,x])).values()];
  if(catalog.length!==first.total)throw Error(`Catalog incomplete: ${catalog.length}/${first.total}`);
  return catalog;
}

async function importBatch(items,token){
  if(!items.length)return;
  const r=await fetch(SITE+'/api/prices/import',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({items})});
  if(!r.ok)throw Error(`Import HTTP ${r.status}: ${(await r.text()).slice(0,150)}`);
}

async function main(){
  const r=await fetch(SITE+'/api/watchlist',{headers:{'Cache-Control':'no-cache'}});
  if(!r.ok)throw Error(`Watchlist HTTP ${r.status}`);
  const {items:watched}=await r.json(),token=await githubIdentity();
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage();
    await page.goto('https://wiki.arz-mcr.ru/items/1766',{waitUntil:'domcontentloaded',timeout:25000});
    const catalog=await getCatalog(page),full=process.env.FULL_SCAN==='true';
    const batchSize=full?catalog.length:Math.min(300,catalog.length);
    const cursor=full?0:(Math.floor(Date.now()/1800000)*batchSize)%catalog.length;
    const {items}=selectForRefresh(catalog,watched||[],cursor,full?catalog.length+100:batchSize);
    console.log(`Catalog ${catalog.length}; selected ${items.length}; full scan ${full}; cursor ${cursor}`);
    let updated=0,unknown=0,failed=0,pending=[];
    for(let i=0;i<items.length;i+=4){
      const group=items.slice(i,i+4);
      const results=await Promise.all(group.map(async item=>{try{return {item,data:await wikiGet(page,`/api/items/prices?id=${item.id}`)}}catch(e){return {item,error:e.message}}}));
      for(const {item,data,error} of results){
        if(error){failed++;if(failed<12)console.warn(`ID ${item.id}: ${error}`);continue;}
        const record=parseWikiApiPrice(data,item.id);
        if(!record){unknown++;continue;}pending.push(record);
      }
      if(pending.length>=40||i+4>=items.length){while(pending.length){const batch=pending.splice(0,40);await importBatch(batch,token);updated+=batch.length;}}
      if((i+4)%100===0)console.log(`Progress ${Math.min(i+4,items.length)}/${items.length}; prices ${updated}; unknown ${unknown}; errors ${failed}`);
    }
    console.log(`Complete: ${updated} prices, ${unknown} without price, ${failed} errors of ${items.length}`);
    if(failed>items.length/4)throw Error('Wiki price API failed for over 25% of items');
  }finally{await browser.close();}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={parseWikiApiPrice,selectForRefresh};
