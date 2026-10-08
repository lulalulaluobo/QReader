import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: "export {animatePageOffset} from './src/reader/page-motion'; export {generateEpubLocations} from './src/reader/epub-locations'; export {PageDrag,bindPageDrag} from './src/reader/page-gesture';", resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node' });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
const { animatePageOffset, generateEpubLocations, PageDrag, bindPageDrag } = mod.exports;

function clock(reduced = false) {
  let now = 0, id = 0;
  const frames = new Map();
  return { performance: { now: () => now }, matchMedia: () => ({matches: reduced}),
    requestAnimationFrame: cb => { frames.set(++id, cb); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    step(ms) { now += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(now)); },
    pending: () => frames.size };
}
const win = clock(), offsets = [], controller = new AbortController();
const motion = animatePageOffset(win, 0, 400, x => offsets.push(x), controller.signal);
win.step(50); win.step(50); win.step(200);
assert.equal(await motion, true);
assert.ok(offsets[0] > 0 && offsets[0] < offsets[1] && offsets[1] < 400);
assert.equal(offsets.at(-1), 400); assert.equal(win.pending(), 0);
const cancel = new AbortController(), reversed = [];
const interrupted = animatePageOffset(win, 400, 0, x => reversed.push(x), cancel.signal);
win.step(50); cancel.abort(); win.step(500);
assert.equal(await interrupted, false); assert.equal(reversed.length, 1); assert.equal(win.pending(), 0);
const immediate = [], reduced = clock(true);
assert.equal(await animatePageOffset(reduced, 0, 400, x => immediate.push(x), new AbortController().signal), true);
assert.deepEqual(immediate, [400]); assert.equal(reduced.pending(), 0);
const snap = [], snapClock = clock();
assert.equal(await animatePageOffset(snapClock, 200, 400, x => snap.push(x), new AbortController().signal, 0), true);
assert.deepEqual(snap, [400]); assert.equal(snapClock.pending(), 0);

const listeners = new Map(), gestures = [];
let selected = false, enabled = true, claimed = 0;
const surface = { nodeType: 9, defaultView: { Element: class {}, visualViewport: { scale: 1 } },
  addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
const unbind = bindPageDrag(surface, { enabled: () => enabled, width: () => 400, selected: () => selected,
  claim: () => claimed++, start: drag => gestures.push(drag) });
const touch = (x, y = 100, id = 7) => ({ screenX: x, screenY: y, clientX: x, clientY: y, identifier: id });
function send(type, touches, time) {
  const e = { touches: type === 'touchend' ? [] : touches, changedTouches: touches, timeStamp: time, cancelable: true, prevented: false,
    preventDefault() { this.prevented = true; }, stopPropagation() {} };
  listeners.get(type)(e); return e;
}
send('touchstart', [touch(300)], 0);
assert.equal(send('touchmove', [touch(200)], 50).prevented, true);
const held = gestures.at(-1), live = [];
held.subscribe(d => live.push(d));
send('touchmove', [touch(100)], 100);
assert.deepEqual(live, [100,200]); assert.equal(held.ended, false);
// Holding for over the old 700ms limit leaves the same live displacement.
assert.equal(held.distance, 200);
send('touchend', [touch(100)], 1500);
assert.equal(await held.completion, true);
send('touchstart', [touch(300)], 2000); send('touchmove', [touch(40)], 2050);
const reversedDrag = gestures.at(-1); send('touchmove', [touch(270)], 2150); send('touchend', [touch(270)], 2500);
assert.equal(await reversedDrag.completion, false); assert.equal(reversedDrag.distance, 30);
send('touchstart', [touch(300)], 3000); send('touchmove', [touch(270)], 3010); send('touchend', [touch(270)], 3030);
assert.equal(await gestures.at(-1).completion, true, 'short fast flick commits');
const before = gestures.length;
send('touchstart', [touch(300)], 4000); send('touchmove', [touch(280,180)], 4050);
assert.equal(gestures.length, before, 'vertical scrolling stays native');
selected = true; send('touchstart', [touch(300)], 5000); send('touchmove', [touch(100)], 5100);
assert.equal(gestures.length, before, 'selection handles never turn a page'); selected = false;
send('touchstart', [touch(300)], 6000); send('touchmove', [touch(180)], 6050);
const pinched = gestures.at(-1); send('touchmove', [touch(180),touch(220,100,8)], 6100);
assert.equal(await pinched.completion, false, 'multi-touch cancels the preview');
enabled = false; send('touchstart', [touch(300)], 7000); send('touchmove', [touch(100)], 7100);
assert.equal(gestures.length, before + 1, 'busy navigation cannot start another drag'); enabled = true;
send('touchstart', [touch(300)], 8000); send('touchmove', [touch(100)], 8100);
const closing = gestures.at(-1); unbind();
assert.equal(await closing.completion, false); assert.equal(listeners.size, 0); assert.equal(claimed, gestures.length);
const crossFrame = new PageDrag(1,400), adjacentListeners = new Map();
const adjacent = {...surface, addEventListener:(type,fn)=>adjacentListeners.set(type,fn), removeEventListener:type=>adjacentListeners.delete(type)};
const releaseAdjacent=bindPageDrag(adjacent,{enabled:()=>false,width:()=>400,selected:()=>false,
  start:()=>assert.fail('busy adjacent frame cannot start another drag'),claim:()=>{},interrupt:()=>crossFrame.cancel()});
adjacentListeners.get('touchstart')({touches:[touch(200,100,8)],timeStamp:9000});
assert.equal(await crossFrame.completion,false,'a second contact in a separate iframe cancels the first drag');releaseAdjacent();
const endListeners=new Map();let multiEnd;
const endSurface={...surface,addEventListener:(type,fn)=>endListeners.set(type,fn),removeEventListener:type=>endListeners.delete(type)};
const releaseEnd=bindPageDrag(endSurface,{enabled:()=>true,width:()=>400,selected:()=>false,start:drag=>multiEnd=drag,claim:()=>{}});
endListeners.get('touchstart')({touches:[touch(300)],timeStamp:10000});
endListeners.get('touchmove')({touches:[touch(50)],timeStamp:10050,cancelable:true,preventDefault(){},stopPropagation(){}});
endListeners.get('touchend')({touches:[touch(200,100,8)],changedTouches:[touch(50)],timeStamp:10100,stopPropagation(){}});
assert.equal(await multiEnd.completion,false,'ending the first contact while another remains cannot commit');releaseEnd();

globalThis.window = { setTimeout, clearTimeout };
function bookFixture(load) {
  const sections = [{linear:true, href:'one', cfiBase:'base1'}, {linear:false, href:'nav'}, {linear:true, href:'two', cfiBase:'base2'}];
  let saved = null, hooks = 0;
  return { book: { loaded: {spine:Promise.resolve({})}, spine: { each: f => sections.forEach(f), hooks: {content: {trigger: async () => hooks++}} },
    load, locations: {length: () => 0, parse: (root, base) => {assert.ok(root); return [base];}, load: json => saved = JSON.parse(json)} },
    saved: () => saved, hooks: () => hooks };
}
const loaded = [], fixture = bookFixture(async href => {loaded.push(href); return {documentElement:{}};});
let inputProcessed = false;
setTimeout(() => inputProcessed = true, 0);
await generateEpubLocations(fixture.book, new AbortController().signal);
assert.equal(inputProcessed, true, 'index work yields to pending input');
assert.deepEqual(loaded, ['one','two']); assert.deepEqual(fixture.saved(), ['base1','base2']); assert.equal(fixture.hooks(), 2);
const aborted = new AbortController();
const stale = bookFixture(async () => {aborted.abort(); return {documentElement:{}};});
await generateEpubLocations(stale.book, aborted.signal);
assert.equal(stale.saved(), null, 'closing during source I/O cannot publish a partial index'); assert.equal(stale.hooks(), 0);
const broken = bookFixture(async href => {if (href==='two') throw new Error('bad chapter'); return {documentElement:{}};});
await assert.rejects(generateEpubLocations(broken.book, new AbortController().signal), /bad chapter/);
assert.equal(broken.saved(), null, 'a failed chapter cannot publish a partial index');
console.log('Reader performance: live drag/hold/reverse/flick, selection/multi-touch guards, immediate snap, continuous motion, abort cleanup and atomic CFI indexing passed.');
