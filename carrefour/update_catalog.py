#!/usr/bin/env python3
"""Best effort public catalog HTML/browser extraction. Keeps verified seed if source unavailable."""
import asyncio,json,re,datetime
from pathlib import Path
from playwright.async_api import async_playwright
FILE=Path(__file__).with_name('catalog.json')
URL='https://www.carrefour.es/supermercado/ofertas50qvoctubre26/ofertas50qvoctubre26/g'
async def extract(page):
 return await page.evaluate("""() => {
 const result=[];
 for(const a of document.querySelectorAll('a[href*="/supermercado/"][href*="/p"]')){
  let name=(a.innerText||a.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ');
  if(name.length<8||name.length>220)continue;
  let price;
  for(let n=a.parentElement,i=0;n&&i<7;n=n.parentElement,i++){
   const t=(n.innerText||'').replace(/\\s+/g,' ');
   if(t.length>1600)break;
   const m=t.match(/(?:\\d{1,3}(?:\\.\\d{3})*,\\d{2})\\s*€/);
   if(m){price=m[0];break}
  }
  if(price)result.push({name,url:a.href,price});
 }
 return result; }""")
async def main():
 doc=json.loads(FILE.read_text(encoding='utf-8')); seed=doc['products']
 found={}
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(args=['--no-sandbox'])
  ctx=await browser.new_context(locale='es-ES',timezone_id='Europe/Madrid',viewport={'width':1400,'height':1000})
  page=await ctx.new_page()
  response=await page.goto(URL,wait_until='domcontentloaded',timeout=60000)
  print('Retail HTTP',response.status if response else '?','URL',page.url,flush=True)
  await page.wait_for_timeout(4000)
  print('Retail title',await page.title(),flush=True)
  print('Retail body',repr((await page.locator('body').inner_text())[:700]),flush=True)
  print('Anchor sample',await page.eval_on_selector_all('a','els=>els.slice(0,8).map(x=>({text:x.innerText.slice(0,25),href:x.href}))'),flush=True)
  for item in await extract(page):found[item['url']]=item
  for i in range(2,32):
   moved=False
   for loc in [page.get_by_role('button',name=re.compile('siguiente|next',re.I)),page.locator('[aria-label*="siguiente"],[aria-label*="Siguiente"],a[rel="next"]'),page.locator('button[aria-label="'+str(i)+'"]')]:
    try:
     if await loc.count():await loc.last.click(timeout=2000);moved=True;break
    except Exception:pass
   if not moved:break
   await page.wait_for_timeout(1300)
   for item in await extract(page):found[item['url']]=item
  print('Raw product links',len(found),flush=True)
  old={p.get('url'):p for p in seed if p.get('url')}
  output={p.get('url') or p['id']:p for p in seed}
  if len(found)<15:
   print('Insufficient source extraction; preserving seeded cache',flush=True)
   await browser.close();return
  for r in found.values():
   try:price=float(r['price'].replace('€','').replace('.','').replace(',','.').strip())
   except ValueError:continue
   if not .05<=price<=999:continue
   prev=old.get(r['url'],{})
   output[r['url']]={'id':prev.get('id') or r['url'].split('/')[-2], 'ean':prev.get('ean',''),
    'name':r['name'],'price':price,'category':prev.get('category') or 'Каталог','url':r['url']}
  items=list(output.values())
  # Conservative GTIN lookup: never derive EAN from product name or URL.
  sem=asyncio.Semaphore(4)
  async def ean(item):
   if item.get('ean') or not item.get('url'):return
   async with sem:
    tab=await ctx.new_page()
    try:
     await tab.goto(item['url'],wait_until='domcontentloaded',timeout=16000)
     html=await tab.content()
     m=re.search(r'["\x27](?:gtin13|gtin|ean)["\x27]\s*:\s*["\x27](\d{13})',html,re.I)
     if m:item['ean']=m.group(1)
    except Exception:pass
    finally:await tab.close()
  await asyncio.gather(*(ean(p) for p in [x for x in items if not x.get('ean')][:40]))
  await browser.close()
 if len(items)<len(seed):return
 doc['products']=items;doc['updatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 doc['note']='Публичный автоматический снимок Carrefour; товары и цены El Saler могут отличаться. EAN только из метаданных.'
 FILE.write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print('Cached',len(items),'products; EANs',sum(bool(i.get('ean')) for i in items),flush=True)
if __name__=='__main__':asyncio.run(main())
