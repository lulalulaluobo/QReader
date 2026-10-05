import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({
  stdin: { contents: "export * from './src/core/note-document'; export * from './src/core/md-notes'; export * from './src/core/note-history'; export * from './src/core/legacy-notes'; export * from './src/core/json-store';", resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'host-test', setup(b) {
    b.onResolve({ filter: /^(obsidian|epubjs)$/ }, args => ({ path: args.path, namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export class EpubCFI { compare(a,b){return a.localeCompare(b)} }', loader: 'js' }));
  }}]
});
const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const at = '2026-10-01T00:00:00Z', editedAt = '2026-10-05T01:00:00.000Z';
const reading = () => ({
  version: 1, book: { title: '测试书', author: '作者', format: 'epub', fileName: 'test (1).epub' },
  progress: { chapterId: 'c', percent: 0.3, lastReadAt: at }, importedAt: at,
  chapters: { c: { title: '第一章', index: 0, questionVersions: [], answers: [], reviews: [] } },
  annotations: [
    { id: 'a1', chapterId: 'c', createdAt: at, text: '第一段原文', note: '我的原有理解', sortKey: 1, cfi: 'epubcfi(/6/2!/4/2:0)' },
    { id: 'a2', chapterId: 'c', createdAt: at, text: '纯划线的原文', kind: 'highlight', sortKey: 2, pdfPage: 3 },
  ],
  bookNotes: [{ id: 'b1', text: '原有整书想法', createdAt: at, history: [{ id: 'r1', at, note: '原有整书想法' }] }]
});
class MemoryFs {
  files = new Map(); writes = []; failure = null; intercept = null;
  async exists(p) { return this.files.has(p); }
  async read(p) { if (!this.files.has(p)) throw Error('missing'); return this.files.get(p); }
  async write(p, text) {
    this.writes.push(p);
    if (this.intercept) await this.intercept(p, text);
    if (this.failure?.path === p) {
      const mode = this.failure.mode; this.failure = null;
      if (mode === 'corrupt') { this.files.set(p, text + 'truncated'); return; }
      if (mode === 'partial') this.files.set(p, 'partial');
      throw Error('disk-full');
    }
    this.files.set(p, text);
  }
  async remove(p) { this.files.delete(p); }
  async stat() { return { mtime: Date.parse(editedAt) }; }
}
const context = { bookId: '测试书', vault: 'Isolated Vault' };
async function setup(legacy = false) {
  const fs = new MemoryFs(), value = reading();
  const store = m.JsonStore.forNew(fs, 'reading.json', m.validateReading, value);
  await m.JsonStore.persistNew(store);
  if (legacy) fs.files.set('批注.md', m.renderLegacyAnnotationsMd(value));
  else await m.mutateNoteDocument(fs, store, '批注.md', context, () => {});
  return { fs, store, sync: change => m.mutateNoteDocument(fs, store, '批注.md', context, change ?? (() => {})) };
}
const legacy = await setup(true);
const oldNotes = JSON.stringify(legacy.store.value.annotations);
await legacy.sync();
let doc = legacy.fs.files.get('批注.md');
for (const text of ['纯划线的原文', '我的原有理解', '原有整书想法', '最近阅读', '最近笔记', './test%20%281%29.epub', 'obsidian://qreader?', 'vault=Isolated%20Vault']) assert.ok(doc.includes(text), text);
assert.equal(JSON.stringify(legacy.store.value.annotations), oldNotes);
assert.ok(!legacy.store.value.notesSync.manualEditedAt);
const idempotent = [...legacy.fs.writes];
await legacy.sync();
assert.deepEqual(legacy.fs.writes, idempotent, 'unchanged sync does not rewrite files');

// Native editor additions and corrections survive subsequent annotation saves.
legacy.fs.files.set('批注.md', doc.replace('我的原有理解', '我在原生编辑器修改的理解').replace('## 关于这本书的想法', '## 关于这本书的想法\n\n我自由写下的一段想法'));
await legacy.sync(value => value.annotations.push({ id: 'a3', chapterId: 'c', createdAt: editedAt, text: '新增摘抄', note: '新增批注', sortKey: 3 }));
doc = legacy.fs.files.get('批注.md');
for (const text of ['我在原生编辑器修改的理解', '我自由写下的一段想法', '新增批注', '新增摘抄']) assert.ok(doc.includes(text));
assert.equal(legacy.store.value.notesSync.manualEditedAt, editedAt);
const unchanged = doc;
await legacy.sync();
assert.equal(legacy.fs.files.get('批注.md'), unchanged);
await legacy.sync(value => { value.progress.lastReadAt = '2026-10-06T02:00:00Z'; });
assert.equal(m.lastNoteAt(legacy.store.value), editedAt, 'reading later does not change last note date');
assert.ok(legacy.fs.files.get('批注.md').includes('2026-10-06T02:00:00Z'));

// Same-location edits keep the reader version plus clearly labelled new text.
await legacy.sync(value => {
  const a = value.annotations[0], before = { ...a };
  a.note = '从阅读器修订的理解'; m.appendAnnotationRevision(a, before);
});
doc = legacy.fs.files.get('批注.md');
for (const text of ['我在原生编辑器修改的理解', '从阅读器修订的理解', '同步补充']) assert.ok(doc.includes(text));
const reopened = await m.JsonStore.open(legacy.fs, 'reading.json', m.validateReading);
await m.mutateNoteDocument(legacy.fs, reopened.store, '批注.md', context, () => {});
assert.equal(legacy.fs.files.get('批注.md'), doc, 'baseline survives restart');
await m.mutateNoteDocument(legacy.fs, reopened.store, '批注.md', context, value => { value.annotations = value.annotations.filter(a => a.id !== 'a2'); });
assert.ok(!legacy.fs.files.get('批注.md').includes('纯划线的原文'), 'untouched deleted excerpts are removed');

for (const mode of ['throw', 'partial', 'corrupt']) {
  const f = await setup();
  const beforeJson = f.fs.files.get('reading.json'), beforeDoc = f.fs.files.get('批注.md'), live = f.store.value.annotations[0];
  f.fs.failure = { path: '批注.md', mode };
  await assert.rejects(() => f.sync(value => { value.annotations[0].note = '失败时修改'; }), /disk-full|校验失败/);
  assert.equal(f.fs.files.get('reading.json'), beforeJson);
  assert.equal(f.fs.files.get('批注.md'), beforeDoc);
  assert.equal(live.note, '我的原有理解'); assert.equal(live, f.store.value.annotations[0]);
  await f.sync(value => { value.annotations[0].note = '重试成功'; });
  assert.ok(f.fs.files.get('批注.md').includes('重试成功'));
}
const jsonFail = await setup();
const jsonDoc = jsonFail.fs.files.get('批注.md');
jsonFail.fs.failure = { path: 'reading.json', mode: 'partial' };
await assert.rejects(() => jsonFail.sync(value => { value.bookNotes[0].text = '不能提交'; value.bookNotes[0].history[0].note = '不能提交'; }), /disk-full/);
assert.equal(jsonFail.fs.files.get('批注.md'), jsonDoc);

const racing = await setup();
const raceJson = racing.fs.files.get('reading.json');
racing.fs.intercept = async path => {
  if (path === 'reading.json') { racing.fs.intercept = null; racing.fs.files.set('批注.md', '同步期间读者刚写下的内容'); }
};
await assert.rejects(() => racing.sync(value => { value.annotations[0].note = '并发修改'; }), /同步期间发生修改/);
assert.equal(racing.fs.files.get('批注.md'), '同步期间读者刚写下的内容');
assert.equal(racing.fs.files.get('reading.json'), raceJson);
await racing.sync();
assert.ok(racing.fs.files.get('批注.md').includes('同步期间读者刚写下的内容'));

const concurrent = await setup();
await Promise.all(Array.from({ length: 8 }, (_, i) => concurrent.sync(value => value.annotations.push({ id: 'parallel-' + i, chapterId: 'c', createdAt: at, text: '并发摘抄-' + i, sortKey: i + 4 }))));
for (let i = 0; i < 8; i++) assert.ok(concurrent.fs.files.get('批注.md').includes('并发摘抄-' + i));
concurrent.fs.files.delete('批注.md'); await concurrent.sync();
assert.ok(concurrent.fs.files.get('批注.md').includes('并发摘抄-7'));
for (const notesSync of [{ base: 1, hash: 'bad' }, { base: '', hash: 'bad' }, { base: '', hash: 'a'.repeat(64), manualEditedAt: 'invalid' }]) {
  assert.throws(() => m.validateReading({ ...reading(), notesSync }));
}

// Historical graph becomes one plain file; original bytes and manual archives
// are never touched. Missing sources are explicit, not reconstructed by AI.
const archiveFs = new MemoryFs();
const ref = { bookId: '测试书', kind: 'annotation', id: 'a1', revisionId: 'legacy' };
const graph = JSON.stringify({ version: 1, threads: [{ id: 't1', title: '原有主题', judgment: '自己的判断', unresolved: '仍未想明白', createdAt: at, updatedAt: editedAt, items: [
  { ref, relation: 'related', reason: '自己的关联理由', addedAt: at },
  { ref: { ...ref, id: 'deleted' }, relation: 'challenge', reason: '缺失来源的理由', addedAt: at },
] }] }, null, 2);
archiveFs.files.set('库/.qreader/thinking.json', graph);
archiveFs.files.set('库/旧版思考记录.md', '用户原本的同名文件');
const entries = [{ id: '测试书', dir: '库/测试书', reading: reading() }];
const archived = await m.archiveLegacyNotes(archiveFs, '库', entries, 'Isolated Vault');
assert.equal(archived, '库/旧版思考记录 (2).md');
const archive = archiveFs.files.get(archived);
for (const text of ['自己的判断', '仍未想明白', '自己的关联理由', '我的原有理解', '第一段原文', '来源已删除或不可用', '缺失来源的理由']) assert.ok(archive.includes(text));
assert.equal(archiveFs.files.get('库/.qreader/thinking.json'), graph);
assert.equal(archiveFs.files.get('库/旧版思考记录.md'), '用户原本的同名文件');
archiveFs.files.set(archived, archive + '\n我的后续修改');
assert.equal(await m.archiveLegacyNotes(archiveFs, '库', entries), archived);
assert.ok(archiveFs.files.get(archived).endsWith('我的后续修改'));
archiveFs.files.set('坏库/.qreader/thinking.json', '{bad');
await assert.rejects(() => m.archiveLegacyNotes(archiveFs, '坏库', entries));
assert.equal(archiveFs.files.get('坏库/.qreader/thinking.json'), '{bad');
const english = m.renderAnnotationsMd(reading(), { ...context, language: 'en' });
assert.ok(m.renderAnnotationsMd({ ...reading(), book: { ...reading().book, fileName: '原书 #1 (终).epub' } }).includes('./%E5%8E%9F%E4%B9%A6%20%231%20%28%E7%BB%88%29.epub'));
assert.ok(m.mergeDocument('Manual edit', 'Original note', 'Reader edit', 'en').includes('Sync supplement'));
for (const text of ['**Author**', '**Last read**', '**Last note**', '## My thoughts on this book', '[Go to original]', '我的原有理解']) assert.ok(english.includes(text));
const deletedEdited = await setup();
deletedEdited.fs.files.set('批注.md', deletedEdited.fs.files.get('批注.md').replace('我的原有理解', '手工编辑必须保留'));
await deletedEdited.sync(value => { value.annotations = value.annotations.filter(a => a.id !== 'a1'); });
assert.ok(deletedEdited.fs.files.get('批注.md').includes('手工编辑必须保留'));
const afterDelete = deletedEdited.fs.files.get('批注.md'); await deletedEdited.sync();
assert.equal(deletedEdited.fs.files.get('批注.md'), afterDelete);
console.log('Book documents: upgrade, excerpts, manual edits, overlap, idempotence, dates, restart, deletion, concurrency, rollback, external-write guard and legacy archive passed.');
