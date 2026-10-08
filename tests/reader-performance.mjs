import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: "export {animatePageOffset} from './src/reader/page-motion'; export {generateEpubLocations} from './src/reader/epub-locations';", resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node' });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
const { animatePageOffset, generateEpubLocations } = mod.exports;

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
console.log('Reader performance: continuous motion, reduced motion, abort cleanup, input yielding and atomic CFI indexing passed.');
