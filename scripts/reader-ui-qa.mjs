import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const args = new Map();
for (let i=2;i<process.argv.length;i+=2) args.set(process.argv[i],process.argv[i+1]);
if (!args.get('--isolated-vault') || !args.get('--output')) throw new Error('Usage: node scripts/reader-ui-qa.mjs --isolated-vault <absolute-path> --output <report.json> [--cdp http://127.0.0.1:43113]');
const target = new URL(args.get('--cdp') ?? 'http://127.0.0.1:43113');
if (!['127.0.0.1','localhost'].includes(target.hostname)) throw new Error('Only local isolated CDP endpoints are supported');
const pages = await (await fetch(new URL('/json/list',target))).json();
const page = pages.find(p=>p.type==='page'&&p.url.startsWith('app://obsidian'));
if (!page) throw new Error('No isolated Obsidian renderer found');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let id=0; const pending=new Map();
ws.onmessage=e=>{const message=JSON.parse(e.data),call=pending.get(message.id);if(call){pending.delete(message.id);message.error?call.reject(new Error(message.error.message)):call.resolve(message.result);}};
const command=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});
const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
try {
  const expected=await fs.realpath(args.get('--isolated-vault'));
  assert.equal(await evaluate('app.vault.adapter.getBasePath()'),expected,'CDP is attached to a different Vault; no test actions were run');
  assert.equal(await evaluate('document.visibilityState'),'visible','Raise the isolated Obsidian window first');
  await command('Emulation.setDeviceMetricsOverride',{width:1024,height:900,deviceScaleFactor:1,mobile:false});
  const results=await evaluate(`(async()=>{
    const p=app.plugins.plugins.qreader;
    if(!p)throw new Error('QReader not enabled');
    const settings=structuredClone(p.settings),rows=[],frame=()=>new Promise(r=>requestAnimationFrame(r));
    try {
      p.settings.reading.defaultMode='paginated';p.settings.reading.spread='single';
      const seen=new Set(),books=p.library.all().filter(b=>b.reading&&!b.damaged&&!seen.has(b.reading.book.format)&&seen.add(b.reading.book.format));
      for(const book of books){
        await p.openReader(book.id);const v=app.workspace.getMostRecentLeaf().view,e=v.engine;
        await frame();await frame();const original=e.captureLocation();
        const speech=e.format==='cbz'?{segments:[]}:await e.speechText(e.format==='pdf'?1:0);
        const query=speech.segments.map(s=>s.text).join(' ').match(/[A-Za-z]{4,}|[\u4e00-\u9fff]{2,4}/)?.[0];
        const hits=[];if(query)await e.search(query,new AbortController().signal,batch=>hits.push(...batch));
        let searchReturned=null;
        if(hits.length){await e.showSearchResult(hits.at(-1));await e.goToLocation(original);await frame();await frame();const current=e.captureLocation();
          searchReturned=e.format==='pdf'?current.pdfPage===original.pdfPage&&Math.abs(current.pageFraction-original.pageFraction)<.01:current.cfi===original.cfi;}
        const abort=new AbortController();abort.abort();let stale=0;await e.search(query??'fixture',abort.signal,batch=>stale+=batch.length);
        let double=null;
        if(e.reflowable){p.settings.reading.spread='double';await e.applyLayout(p.readingLayout(),v.resolvedTheme());await frame();await frame();
          double={divisor:e.rendition.manager.layout.divisor,anchorVisible:e.cfiIsVisible(original.cfi)};
          p.settings.reading.spread='single';await e.applyLayout(p.readingLayout(),v.resolvedTheme());}
        let zoom=null;
        if(e.format==='pdf'){await e.setZoom(3);await frame();const w=e.wrappers.get(e.currentPage),canvas=w.querySelector('canvas'),text=w.querySelector('.qr-pdf-text');
          zoom={canvasAligned:Math.abs(parseFloat(canvas.style.width)-text.clientWidth)<1,canPan:e.scroller.scrollWidth>e.scroller.clientWidth};
          await e.setZoom('page');zoom.fitsPage=e.wrappers.get(e.currentPage).clientHeight<=e.scroller.clientHeight;await e.setZoom('width');}
        await e.goToLocation(original);await frame();await frame();
        rows.push({format:e.format,hits:hits.length,hasText:!!query,searchReturned,cancelledResults:stale,double,zoom});
      }
      return {pluginVersion:p.manifest.version,userAgent:navigator.userAgent,rows};
    } finally {p.settings=settings;await p.saveSettings();p.notifySettingsChanged();}
  })()`);
  for(const row of results.rows){
    assert.equal(row.cancelledResults,0);
    if(row.hasText){assert.ok(row.hits>0);assert.equal(row.searchReturned,true);}
    if(row.double){assert.equal(row.double.divisor,2);assert.equal(row.double.anchorVisible,true);}
    if(row.zoom){assert.equal(row.zoom.canvasAligned,true);assert.equal(row.zoom.canPan,true);assert.equal(row.zoom.fitsPage,true);}
  }
  await fs.mkdir(path.dirname(args.get('--output')),{recursive:true});
  await fs.writeFile(args.get('--output'),JSON.stringify(results,null,2)+'\n');
  console.log(`Passed ${results.rows.length} format groups; report: ${args.get('--output')}`);
} finally {
  await command('Emulation.clearDeviceMetricsOverride').catch(()=>{});
  ws.close();
}
