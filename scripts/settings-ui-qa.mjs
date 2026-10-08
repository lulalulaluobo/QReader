import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
if(!args.get('--isolated-vault')||!args.get('--output'))throw new Error('Usage: node scripts/settings-ui-qa.mjs --isolated-vault <absolute-path> --output <report.json> [--cdp http://127.0.0.1:43113]');
const endpoint=new URL(args.get('--cdp')??'http://127.0.0.1:43113');
if(!['127.0.0.1','localhost'].includes(endpoint.hostname))throw new Error('Only local isolated CDP endpoints are supported');
const pages=await(await fetch(new URL('/json/list',endpoint))).json(),page=pages.find(p=>p.type==='page'&&p.url.startsWith('app://obsidian'));
if(!page)throw new Error('No isolated Obsidian renderer found');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let id=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}};
const command=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});
const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
try{
  const expected=await fs.realpath(args.get('--isolated-vault'));
  assert.equal(await evaluate('app.vault.adapter.getBasePath()'),expected,'Different Vault; no test actions were run');
  assert.equal(await evaluate('document.visibilityState'),'visible','Raise the isolated Obsidian window first');
  const result=await evaluate(`(async()=>{
    const p=app.plugins.plugins.qreader;if(!p)throw new Error('QReader not enabled');
    const settings=structuredClone(p.settings),rows=[],frame=()=>new Promise(r=>requestAnimationFrame(r));
    p.openSettings();const tab=app.setting.pluginTabs.find(t=>t.id==='qreader');
    let body,bodyClasses,rootStyle;
    try{
      for(const language of ['zh-CN','en'])for(const theme of ['light','dark'])for(const mobile of [false,true])for(const width of [320,375,414,768,1024,1280,1440]){
        p.settings.language=language;tab.display();const root=tab.containerEl;
        if(!body){body=root.ownerDocument.body;bodyClasses=body.className;rootStyle=root.getAttribute('style');}
        body.classList.toggle('is-mobile',mobile);body.classList.toggle('theme-light',theme==='light');body.classList.toggle('theme-dark',theme==='dark');
        root.style.width=(width-48)+'px';root.style.maxWidth='100%';await frame();await frame();
        const buttons=[...root.querySelectorAll('[role=tab]')],input=root.querySelector('#qr-settings-basic input');
        input.value='Unsaved path draft';input.dispatchEvent(new Event('input',{bubbles:true}));
        const pages=[];
        for(const button of buttons){
          button.click();await frame();await frame();
          const visible=[...root.querySelectorAll('[role=tabpanel]')].filter(p=>p.getBoundingClientRect().height>0),panel=visible[0];
          const items=[...panel.querySelectorAll('.setting-item')].map(item=>{
            const info=item.querySelector('.setting-item-info'),control=item.querySelector('.setting-item-control'),ir=info.getBoundingClientRect(),cr=control.getBoundingClientRect();
            const infoChildren=[...info.children].map(e=>e.getBoundingClientRect()).filter(r=>r.height>0);
            const controlChildren=[...control.children].filter(e=>getComputedStyle(e).visibility!=='hidden').map(e=>e.getBoundingClientRect()).filter(r=>r.height>0);
            return {height:item.getBoundingClientRect().height,display:getComputedStyle(item).display,infoHeight:ir.height,controlHeight:cr.height,
              blankInfo:infoChildren.length?ir.bottom-Math.max(...infoChildren.map(r=>r.bottom)):0,
              blankControl:controlChildren.length?cr.height-(Math.max(...controlChildren.map(r=>r.bottom))-Math.min(...controlChildren.map(r=>r.top))):0};
          });
          pages.push({id:button.dataset.page,visible:visible.length,active:button.getAttribute('aria-selected'),width:panel.clientWidth,scrollWidth:panel.scrollWidth,items});
        }
        buttons[0].click();const draft=input.value;
        buttons[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
        const keyboard=root.querySelector('[data-page=reading]').getAttribute('aria-selected')==='true';
        const version=root.querySelector('.qr-settings-version')?.textContent;
        rows.push({language,theme,mobile,width,contentWidth:root.clientWidth,version,draft,keyboard,pages});
      }
      return {pluginVersion:p.manifest.version,obsidianUserAgent:navigator.userAgent,physicalMobileDevice:false,rows};
    }finally{
      p.settings=settings;tab.display();if(body)body.className=bodyClasses;
      if(rootStyle===null)tab.containerEl.removeAttribute('style');else if(rootStyle!==undefined)tab.containerEl.setAttribute('style',rootStyle);
      p.app.setting.close();
    }
  })()`);
  await fs.mkdir(path.dirname(args.get('--output')),{recursive:true});await fs.writeFile(args.get('--output'),JSON.stringify(result,null,2)+'\n');
  for(const row of result.rows){
    const label=row.language+' '+row.theme+' mobile='+row.mobile+' width='+row.width;
    assert.equal(row.version,result.pluginVersion,label+' version');assert.equal(row.draft,'Unsaved path draft',label+' draft');assert.equal(row.keyboard,true,label+' keyboard');assert.equal(row.pages.length,6);
    for(const page of row.pages){assert.equal(page.visible,1,label+' visible');assert.equal(page.active,'true');assert.ok(page.scrollWidth<=page.width+1,label+' '+page.id+' overflow');
      for(const item of page.items){assert.equal(item.display,'grid');assert.ok(item.blankInfo<=8,label+' '+page.id+' empty info space');assert.ok(item.blankControl<=28,label+' '+page.id+' empty control space');}}
  }
  console.log('Passed '+result.rows.length+' settings layout groups; report: '+args.get('--output'));
}finally{ws.close();}
