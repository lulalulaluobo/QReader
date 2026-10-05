import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const bundle = await build({ stdin: { contents: "export * from './src/reader/speech'; export {sentenceSlices,pdfSpeechSegments} from './src/reader/speech-text';", resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', plugins: [{ name: 'obsidian-test', setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const requestUrl = (o) => globalThis.qrSpeechRequest(o);', loader: 'js' }));
  } }] });
const mod = {exports:{}}; new Function('exports', 'require', 'module', bundle.outputFiles[0].text)(mod.exports, createRequire(import.meta.url), mod);
const { SpeechPlayer, BingSpeech, loadSpeechSettings, sentenceSlices, pdfSpeechSegments } = mod.exports;
assert.deepEqual(loadSpeechSettings(undefined), { provider: 'auto', rate: 1, voice: 'auto' });
assert.equal(loadSpeechSettings({rate: Infinity}).rate, 1);
assert.equal(loadSpeechSettings({rate: 3}).rate, 2);
assert.equal(loadSpeechSettings({provider: 'bad'}).provider, 'auto');
const sentences = sentenceSlices(' 第一段。 Second sentence! Third sentence? 最后一段。');
assert.deepEqual(sentences.map(s => s.text), ['第一段。', 'Second sentence!', 'Third sentence?', '最后一段。']);
assert.deepEqual(sentenceSlices('中文第一句。第二句！第三句？').map(s=>s.text),['中文第一句。','第二句！','第三句？']);
for (const s of sentenceSlices('word '.repeat(100) + '😀'.repeat(150))) {
  assert.ok(s.text.length <= 180); assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(s.text));
}
// Source offsets, not text matching: the second identical sentence in a single PDF item.
const repeated = 'First. Chosen sentence. Middle. Chosen sentence. Last.';
const chosenOffset = repeated.lastIndexOf('Chosen') + 3;
const pdfChosen = pdfSpeechSegments([{str: repeated, hasEOL: true}], 2, 0, {item:0,start:chosenOffset});
assert.deepEqual(pdfChosen.map(s=>s.text), ['Chosen sentence.', 'Last.']);
assert.equal(pdfChosen[0].pdfPage,2);
assert.equal(pdfChosen[0].itemRanges[0].start,repeated.lastIndexOf('Chosen'));
assert.equal(pdfChosen[0].itemRanges[0].end,repeated.indexOf(' Last.'));
const spanning = pdfSpeechSegments([{str:'Before.'},{str:'The chosen'},{str:'sentence continues.'},{str:'After.'}],3,0,{item:2,start:4});
assert.deepEqual(spanning.map(s=>s.text),['The chosen sentence continues.','After.']);
assert.deepEqual(spanning[0].itemRanges.map(r=>r.item),[1,2]);
assert.deepEqual(pdfSpeechSegments([{str:'第一句。第二句。第三句。'}],1,0,{item:0,start:6}).map(s=>s.text),['第二句。','第三句。']);
assert.deepEqual(pdfSpeechSegments([{str:'First.'},{str:'Second.'}],1,1).map(s=>s.text),['Second.']);
const audioBuffer = () => { const bytes = new Uint8Array(200); bytes[0] = 0xff; bytes[1] = 0xf3; return bytes.buffer; };
let requests = [];
const auth = () => ({status:200,text:'var params_AbusePreventionHelper = [12345,"fixture-token",3600000];'});
globalThis.qrSpeechRequest = async o => { requests.push(o); return o.method ? {status:200,arrayBuffer:audioBuffer()} : auth(); };
const bing = new BingSpeech();
await bing.synthesize('你 & 我 <朋友>', 'auto'); await bing.synthesize('Another sentence.', 'auto');
assert.equal(requests.filter(r => !r.method).length, 1, 'session reused only in memory');
const ssml = new URLSearchParams(requests[1].body).get('ssml');
assert.match(ssml, /zh-CN-XiaoxiaoNeural/); assert.match(ssml, /&amp;/); assert.match(ssml, /&lt;朋友&gt;/);
assert.match(new URLSearchParams(requests[2].body).get('ssml'), /en-US-JennyNeural/);
assert.notEqual(new URL(requests[1].url).searchParams.get('IG'), new URL(requests[2].url).searchParams.get('IG'));
let retried = false;
globalThis.qrSpeechRequest = async o => o.method ? retried ? {status:200,arrayBuffer:audioBuffer()} : (retried = true, {status:401,arrayBuffer:new ArrayBuffer(0)}) : auth();
await new BingSpeech().synthesize('hello', 'auto'); assert.equal(retried, true);
globalThis.qrSpeechRequest = async o => o.method ? {status:200,arrayBuffer:new TextEncoder().encode('{"error":"bad"}').buffer} : auth();
await assert.rejects(new BingSpeech().synthesize('hello', 'auto'), /暂不可用/);

class FakeAudio {
  paused = true; plays = 0; src = ''; playbackRate = 1;
  play() { this.plays++; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  removeAttribute() { this.src = ''; }
}
function windowMock(system = false) {
  const win = { audios: [], revoked: [], document: {createElement() { const a = new FakeAudio(); win.audios.push(a); return a; }},
    URL: {createObjectURL: () => 'blob:fixture', revokeObjectURL: u => win.revoked.push(u)}, Blob };
  if (system) {
    win.SpeechSynthesisUtterance = class { constructor(text) {this.text = text;} };
    win.speechSynthesis = { active: null, spoken: [], getVoices: () => [{lang:'en-US',voiceURI:'English'}],
      cancel() { const u = this.active; this.active = null; u?.onerror?.({error:'canceled'}); },
      speak(u) { this.active = u; this.spoken.push(u); u.onstart?.(); } };
  }
  return win;
}
function engineMock() {
  return { follows: [], clears: 0, units: [],
    async speechText(unit) { this.units.push(unit); return unit === undefined ? { segments: [{text:'First.'},{text:'Second.'}], next:1 }
      : {segments:[{text:'Next page.'}],next:null}; },
    async followSpeech(s) {this.follows.push(s.text);}, clearSpeech() {this.clears++;} };
}
const tick = () => new Promise(r => setTimeout(r, 5));
const wait = async f => { for(let i=0;i<100&&!f();i++) await tick(); assert.ok(f(), 'condition reached'); };
// System narration resumes the same sentence and crosses source units without restarting the book.
const win = windowMock(true), engine = engineMock(), settings = {provider:'auto',voice:'auto',rate:1};
const p = new SpeechPlayer(engine, () => settings, win, () => {});
assert.equal(p.provider(),'system'); p.play(); await wait(() => p.state === 'playing');
assert.equal(p.current.text,'First.'); p.pause(); assert.equal(p.state,'paused'); p.play(); await wait(() => p.state === 'playing');
assert.equal(p.current.text,'First.'); win.speechSynthesis.active.onend(); await wait(() => p.current.text === 'Second.');
win.speechSynthesis.active.onend(); await wait(() => p.current.text === 'Next page.');
win.speechSynthesis.active.onend(); await wait(() => p.state === 'finished'); assert.deepEqual(engine.units,[undefined,1]);
// A second reader takes ownership; closing the old reader never cancels the new one.
const one = new SpeechPlayer(engineMock(),()=>settings,win,()=>{}), two = new SpeechPlayer(engineMock(),()=>settings,win,()=>{});
one.play(); await wait(() => one.state === 'playing'); two.play(); await wait(() => two.state === 'playing');
assert.equal(one.state,'idle'); one.stop(); assert.equal(two.state,'playing'); two.stop();
// Android path has no SpeechSynthesis: binary MP3 + HTMLAudio, pause/resume retains current playback.
requests = []; globalThis.qrSpeechRequest = async o => {requests.push(o);return o.method?{status:200,arrayBuffer:audioBuffer()}:auth();};
const mobile = windowMock(), mobileEngine = engineMock();
const mp = new SpeechPlayer(mobileEngine,()=>settings,mobile,()=>{}); assert.equal(mp.provider(),'bing');
assert.equal(requests.length,0); mp.play(); await wait(() => mp.state === 'playing');
const a = mobile.audios[0]; mp.pause(); const count = requests.length; mp.play();
assert.equal(mp.state,'playing'); assert.equal(requests.length,count); assert.equal(a.paused,false);
settings.rate = 1.4; mp.updateRate(); assert.equal(a.playbackRate,1.4);
a.onended(); await wait(() => mp.current.text === 'Second.' && mp.state === 'playing');
assert.equal(requests.filter(r=>r.method).length,2,'only current and one following sentence are requested');
const plays = a.plays; mp.stop(); await tick(); assert.equal(a.plays,plays,'stop cannot restart audio');
assert.equal(a.paused,true); assert.equal(mp.state,'idle'); assert.ok(mobile.revoked.length);
// Stop during an outstanding network call: a late response cannot resume audio or retain an anchor.
let resolveAudio;
globalThis.qrSpeechRequest = async o => o.method ? new Promise(r => {resolveAudio = () => r({status:200,arrayBuffer:audioBuffer()});}) : auth();
const lateWin = windowMock(), lateEngine = engineMock(), late = new SpeechPlayer(lateEngine,()=>settings,lateWin,()=>{});
late.play(); await wait(()=>!!resolveAudio); late.stop(); const before = lateWin.audios[0].plays;
resolveAudio(); await tick(); assert.equal(late.state,'idle'); assert.equal(lateWin.audios[0].plays,before); assert.equal(late.current,null);
// Pause before loading completes and then stop: no stranded pause gate or playback.
let releaseSource;
const slowEngine = engineMock(); slowEngine.speechText = () => new Promise(r => {releaseSource = () => r({segments:[{text:'late'}],next:null});});
const slow = new SpeechPlayer(slowEngine,()=>settings,windowMock(),()=>{}); slow.play(); slow.pause(); slow.stop(); releaseSource(); await tick();
assert.equal(slow.state,'idle'); assert.equal(slowEngine.follows.length,0);
// Selecting a new anchor replaces playing/paused narration and then continues to the next unit.
const seekWin=windowMock(true), seekEngine=engineMock(), starts=[];
seekEngine.speechText=async (unit,from)=>{
  starts.push({unit,from});
  return unit===undefined ? {segments:[{text:from?.text??'Top.',cfi:from?.cfi},{text:'Following.'}],next:2}
    : {segments:[{text:'Next chapter.'}],next:null};
};
const seek=new SpeechPlayer(seekEngine,()=>settings,seekWin,()=>{});
seek.play(); await wait(()=>seek.state==='playing');
seek.play({text:'Chosen.',cfi:'chosen-location'}); await wait(()=>seek.state==='playing');
assert.equal(seek.current.text,'Chosen.'); assert.equal(starts.at(-1).from.cfi,'chosen-location');
seek.pause(); seek.play(); await wait(()=>seek.state==='playing'); assert.equal(seek.current.text,'Chosen.');
seekWin.speechSynthesis.active.onend(); await wait(()=>seek.current.text==='Following.');
seekWin.speechSynthesis.active.onend(); await wait(()=>seek.current.text==='Next chapter.');
assert.deepEqual(starts.at(-1),{unit:2,from:undefined});
seek.pause();seek.play({text:'New selection.',cfi:'new-location'}); await wait(()=>seek.state==='playing');
assert.equal(seek.current.text,'New selection.'); seek.stop();seek.play(); await wait(()=>seek.state==='playing');
assert.equal(seek.current.text,'Top.','stop discards the chosen anchor');seek.stop();
// A prior source load arriving after a new selection never takes back the playback position.
const deferredWin=windowMock(true), deferredEngine=engineMock(); let oldSource;
deferredEngine.speechText=(_unit,from)=>from ? Promise.resolve({segments:[from],next:null})
  : new Promise(r=>{oldSource=()=>r({segments:[{text:'Obsolete top.'}],next:null});});
const deferred=new SpeechPlayer(deferredEngine,()=>settings,deferredWin,()=>{});
deferred.play();deferred.play({text:'Desired sentence.',cfi:'desired'});await wait(()=>deferred.state==='playing');
oldSource();await tick();assert.deepEqual(deferredEngine.follows,['Desired sentence.']);deferred.stop();
// A pending online request from the old sentence cannot replace the selected one.
let oldNetwork;globalThis.qrSpeechRequest=async o=>{
  if(!o.method)return auth();
  return new URLSearchParams(o.body).get('ssml').includes('First.') ? new Promise(r=>{oldNetwork=()=>r({status:200,arrayBuffer:audioBuffer()});})
    : {status:200,arrayBuffer:audioBuffer()};
};
const onlineSeekWin=windowMock(), onlineSeekEngine=engineMock();
onlineSeekEngine.speechText=async (_unit,from)=>({segments:[from??{text:'First.'}],next:null});
const onlineSeek=new SpeechPlayer(onlineSeekEngine,()=>settings,onlineSeekWin,()=>{});
onlineSeek.play();await wait(()=>!!oldNetwork);
onlineSeek.play({text:'Selected online.',pdfPage:2,itemRanges:[{item:3,start:2,end:8}]});await wait(()=>onlineSeek.state==='playing');
const activePlays=onlineSeekWin.audios[0].plays;oldNetwork();await tick();
assert.equal(onlineSeek.current.text,'Selected online.');assert.equal(onlineSeekWin.audios[0].plays,activePlays);
onlineSeek.stop();
console.log('Speech: protocol, source-anchored selection, repeated PDF sentences, pause/resume, cross-page ownership and stale-response cleanup passed.');
