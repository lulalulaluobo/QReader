import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: `export * from './src/ai/secrets'; export * from './src/ai/providers'; export * from './src/core/reader-cache'; export * from './src/core/vocabulary'; export * from './src/core/vocabulary-export'; export * from './src/reader/search'; export * from './src/translation/context'; export * from './src/reader/metrics';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'obsidian-test', setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const requestUrl = async options => globalThis.qrRequest(options);', loader: 'js' }));
  } }] });
const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const secrets = new Map(), storage = { getSecret: id => secrets.get(id) ?? null, setSecret: (id, value) => secrets.set(id, value) };
const ai = m.loadAiSettings({ provider: 'custom', deepseekApiKey: 'fixture-deepseek', agnesApiKey: 'fixture-agnes', custom: { apiKey: 'fixture-custom' } });
const secure = new m.AiSecrets(storage), saved = secure.snapshot(ai);
assert.equal(saved.deepseekApiKey, ''); assert.equal(saved.agnesApiKey, ''); assert.equal(saved.custom.apiKey, '');
assert.equal(new Set(Object.values(saved.secretIds)).size, 3);
secure.hydrate(saved); assert.equal(saved.deepseekApiKey, ai.deepseekApiKey); assert.equal(saved.custom.apiKey, ai.custom.apiKey);
saved.custom.apiKey = ''; const cleared = secure.snapshot(saved); secure.hydrate(cleared); assert.equal(cleared.custom.apiKey, '');
assert.deepEqual(new m.AiSecrets().snapshot(ai), ai, 'legacy host preserves keys');
assert.throws(() => new m.AiSecrets({ getSecret: () => null, setSecret() {} }).snapshot(ai), /校验失败/);
assert.equal(ai.custom.apiKey, 'fixture-custom', 'failed migration cannot strip original config');
const unreadable=structuredClone(cleared),beforeUnreadable=structuredClone(unreadable);let reads=0;
assert.throws(()=>new m.AiSecrets({getSecret:id=>{if(++reads===2)throw new Error('unavailable');return 'must-not-leak';},setSecret(){}}).hydrate(unreadable),/unavailable/);
assert.deepEqual(unreadable,beforeUnreadable,'partial secret read cannot mutate settings');

const bytes = text => new TextEncoder().encode(text).buffer;
const files = new Map(), dirs = new Set(); let clock = 0, fail = false;
const adapter = {
  exists: async path => files.has(path) || dirs.has(path), mkdir: async path => { dirs.add(path); },
  writeBinary: async (path, value) => { if (fail) throw new Error('disk full'); files.set(path, { bytes: value.slice(0), mtime: ++clock }); },
  readBinary: async path => { if (!files.has(path)) throw new Error('missing'); return files.get(path).bytes.slice(0); },
  list: async path => ({ files: [...files.keys()].filter(key => key.startsWith(path + '/')), folders: [] }),
  stat: async path => files.has(path) ? { size: files.get(path).bytes.byteLength, mtime: files.get(path).mtime } : null,
  remove: async path => { files.delete(path); }, rmdir: async path => { for (const key of files.keys()) if (key.startsWith(path + '/')) files.delete(key); dirs.delete(path); }
};
const cache = new m.ReaderDiskCache(adapter, 'plugin/reader-cache', 8);
const keyA = await cache.contentKey(bytes('alpha'), 'v1'), keyB = await cache.contentKey(bytes('alpha'), 'v2'), keyC = await cache.contentKey(bytes('other'), 'v1');
assert.notEqual(keyA, keyB); assert.notEqual(keyA, keyC);
await cache.write(keyA, bytes('alpha')); assert.equal(new TextDecoder().decode(await cache.read(keyA)), 'alpha');
await cache.write(keyB, bytes('beta')); assert.equal(await cache.read(keyA), null, 'bounded cache evicts old derivative');
assert.deepEqual(await cache.stats(), { bytes: 4, count: 1 });
const cancel = new AbortController(); cancel.abort(); await cache.write(keyC, bytes('other'), cancel.signal); assert.equal(await cache.read(keyC), null);
fail = true; await cache.write(keyC, bytes('other')); fail = false; assert.equal(await cache.read(keyC), null, 'cache write failure is harmless');
assert.equal(await cache.read('../original'), null);
await cache.clear(); assert.deepEqual(await cache.stats(), { bytes: 0, count: 0 });

assert.deepEqual(m.textMatches('İ İstanbul ALICE alice', 'alice').map(x => [x.start, x.end]), [[11, 16], [17, 22]]);
assert.equal(m.textMatches('word [a+b] end', '[a+b]')[0].start, 5);
assert.equal(m.textMatches('中文中文', '中', 1).length, 1); assert.equal(m.textMatches('anything', '').length, 0);
assert.equal(m.contextQuote('sustain', 'One sentence. They ', ' the effort. Other.'), 'They sustain the effort.');
let disk = '{}';
const fs = { exists: async () => disk !== null, read: async () => disk, write: async (path, value) => { disk = value; }, remove: async () => { disk = null; } };
disk = JSON.stringify({ version: 1, words: [] });
const vocabulary = new m.VocabularyStore(fs, 'vocabulary.json'); await vocabulary.load();
const result = { query: 'sustain', translation: '维持', phonetic: '', audioUrl: '' };
await vocabulary.lookup(result, 'p1', true);
const quote = { word: 'sustain', translation: '维持', quote: 'They sustain the effort.', cfi: 'epubcfi(/6/2!/4/2/1:0)', savedAt: '2026-10-08' };
await vocabulary.keep(quote); await vocabulary.keep(quote); assert.equal(vocabulary.saved.length, 1);
await vocabulary.expose([{ word: 'sustain', paragraphId: 'p2', lookupCount: 1 }], 1);
assert.equal(vocabulary.words.length, 0); assert.equal(vocabulary.saved.length, 1, 'explicit passage survives automatic fading');
await vocabulary.remove('sustain'); assert.equal(vocabulary.saved.length, 1);
const reload = new m.VocabularyStore(fs, 'vocabulary.json'); await reload.load(); assert.deepEqual(reload.saved, vocabulary.saved);
assert.match(m.vocabularyMarkdown('<Book>', [], reload.saved), /&lt;Book>/); assert.match(m.vocabularyMarkdown('Book', [], reload.saved), /They sustain/);
const controller = new AbortController(); let sent;
globalThis.qrRequest = options => { sent = JSON.parse(options.body); return new Promise(() => {}); };
const pending = m.contextualMeaning({ baseUrl: 'https://fixture.invalid', apiKey: 'fixture', model: 'fixture' }, 'sustain', quote.quote, 'Book', 'en', controller.signal);
controller.abort(); await assert.rejects(pending, /取消/); assert.match(sent.messages[1].content, /They sustain/);
assert.equal(m.percentile([], .95),null);assert.equal(m.percentile([4,1,3,2],.5),2);
const metrics=new m.ReaderMetrics(), frames=new Map(),visibility=new Map();let fid=0;
const win={requestAnimationFrame:fn=>{frames.set(++fid,fn);return fid;},cancelAnimationFrame:id=>frames.delete(id),
  document:{hidden:false,addEventListener:(name,fn)=>visibility.set(name,fn),removeEventListener:name=>visibility.delete(name)}};
metrics.record({kind:'open',format:'epub',ms:100});assert.equal(metrics.report({}).timings.length,0);
metrics.start(win);metrics.record({kind:'open',format:'epub',ms:100});assert.equal(metrics.report({}).summaries[0].p95,null);
for(let i=0;i<19;i++)metrics.record({kind:'open',format:'epub',ms:100+i});assert.equal(metrics.report({}).summaries[0].enoughSamples,true);
metrics.stop();assert.equal(frames.size,0);assert.equal(visibility.size,0);metrics.record({kind:'open',format:'epub',ms:999});assert.equal(metrics.report({}).timings.length,20);
console.log('Reader tools: secrets, bounded cache, search offsets, vocabulary/export, context cancellation and opt-in diagnostics passed.');
