import type { FsLike } from "./fs";
import { safeAudioUrl, singleWord, type TranslationResult } from "../translation/youdao";

export interface VocabularyWord extends TranslationResult {
  word: string;
  lookupCount: number;
  exposureCount: number;
  noLookupCount: number;
  seenParagraphs: string[];
}
export interface SavedVocabularyWord { word: string; translation: string; quote: string; chapterId?: string; cfi?: string; pdfPage?: number; savedAt: string }
export interface VocabularyFile { version: 1; words: VocabularyWord[]; saved?: SavedVocabularyWord[] }
export interface WordExposure { word: string; paragraphId: string; lookupCount: number }
const queues = new WeakMap<object, Map<string, Promise<void>>>();
const subscriptions = new WeakMap<object, Map<string, Set<(file: VocabularyFile) => void>>>();
function object(raw: unknown): raw is Record<string, unknown> { return typeof raw === "object" && raw !== null && !Array.isArray(raw); }

export function validateVocabulary(raw: unknown): VocabularyFile {
  if (typeof raw !== "object" || raw === null || !("version" in raw) || raw.version !== 1 || !("words" in raw) || !Array.isArray(raw.words)) throw new Error("vocabulary.json 数据无效，已停止写入");
  const words: VocabularyWord[] = [];
  const keys = new Set<string>();
  const records: unknown[] = raw.words;
  for (const item of records) {
    if (!object(item)) throw new Error("vocabulary.json 单词记录无效");
    const entry = item;
    if (typeof entry.word !== "string" || singleWord(entry.word) !== entry.word || keys.has(entry.word) || typeof entry.translation !== "string" || !entry.translation.trim()) throw new Error("vocabulary.json 单词记录无效");
    const counts = [entry.lookupCount, entry.exposureCount, entry.noLookupCount];
    if (!counts.every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) || (entry.lookupCount as number) < 1 || !Array.isArray(entry.seenParagraphs) || !entry.seenParagraphs.every((value) => typeof value === "string" && value.length <= 200)) throw new Error("vocabulary.json 单词记录无效");
    if ((entry.exposureCount as number) < (entry.noLookupCount as number)) throw new Error("vocabulary.json 单词记录无效");
    const paragraphIds: unknown[] = entry.seenParagraphs;
    keys.add(entry.word);
    words.push({ word: entry.word, query: typeof entry.query === "string" ? entry.query : entry.word, translation: entry.translation, phonetic: typeof entry.phonetic === "string" ? entry.phonetic : "", audioUrl: safeAudioUrl(entry.audioUrl), lookupCount: entry.lookupCount as number, exposureCount: entry.exposureCount as number, noLookupCount: entry.noLookupCount as number, seenParagraphs: [...new Set(paragraphIds.filter((id): id is string => typeof id === "string"))] });
  }
  let saved: SavedVocabularyWord[] | undefined;
  if ("saved" in raw && raw.saved !== undefined) {
    if (!Array.isArray(raw.saved)) throw new Error("生词原句记录无效");
    saved = raw.saved.map(item => {
      if (!object(item) || typeof item.word !== "string" || singleWord(item.word) !== item.word || typeof item.translation !== "string"
        || typeof item.quote !== "string" || item.quote.length > 2000 || typeof item.savedAt !== "string"
        || item.cfi !== undefined && (typeof item.cfi !== "string" || !/^epubcfi\(.+\)$/.test(item.cfi))
        || item.pdfPage !== undefined && (!Number.isSafeInteger(item.pdfPage) || (item.pdfPage as number) < 1)
        || item.chapterId !== undefined && typeof item.chapterId !== "string") throw new Error("生词原句记录无效");
      return { word: item.word, translation: item.translation, quote: item.quote, savedAt: item.savedAt,
        cfi: item.cfi as string | undefined, pdfPage: item.pdfPage as number | undefined, chapterId: item.chapterId as string | undefined };
    });
  }
  return { version: 1, words, ...(saved ? { saved } : {}) };
}

/** Dynamic words fade normally; only explicit saves retain a quoted source. */
export class VocabularyStore {
  private current: VocabularyFile = { version: 1, words: [] };
  constructor(private fs: FsLike, readonly path: string) {}
  subscribe(listener: (words: readonly VocabularyWord[]) => void): () => void {
    const scope = this.fs.queueScope ?? this.fs;
    let paths = subscriptions.get(scope);
    if (!paths) { paths = new Map(); subscriptions.set(scope, paths); }
    let listeners = paths.get(this.path);
    if (!listeners) { listeners = new Set(); paths.set(this.path, listeners); }
    const receive = (file: VocabularyFile): void => { this.current = file; listener(this.words); };
    listeners.add(receive);
    return () => { listeners.delete(receive); if (!listeners.size) paths.delete(this.path); };
  }
  private publish(file: VocabularyFile): void {
    this.current = file;
    for (const listener of subscriptions.get(this.fs.queueScope ?? this.fs)?.get(this.path) ?? []) listener(file);
  }
  get words(): readonly VocabularyWord[] { return this.current.words; }
  get saved(): readonly SavedVocabularyWord[] { return this.current.saved ?? []; }
  keep(record: SavedVocabularyWord): Promise<void> {
    return this.change(file => {
      const saved = file.saved ??= [];
      if (saved.some(item => item.word === record.word && item.quote === record.quote && item.cfi === record.cfi && item.pdfPage === record.pdfPage)) return false;
      saved.push({ ...record }); return true;
    });
  }
  private async readDisk(): Promise<{ value: VocabularyFile; raw: string | null }> {
    if (!await this.fs.exists(this.path)) return { value: { version: 1, words: [] }, raw: null };
    const raw = await this.fs.read(this.path);
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new Error("vocabulary.json 数据无效，已停止写入"); }
    return { value: validateVocabulary(data), raw };
  }
  private enqueue(run: () => Promise<void>): Promise<void> {
    const scope = this.fs.queueScope ?? this.fs;
    let paths = queues.get(scope);
    if (!paths) { paths = new Map(); queues.set(scope, paths); }
    const job = (paths.get(this.path) ?? Promise.resolve()).then(run, run);
    paths.set(this.path, job);
    const clean = (): void => { if (paths.get(this.path) === job) paths.delete(this.path); };
    void job.then(clean, clean);
    return job;
  }
  async load(): Promise<void> { await this.enqueue(async () => { this.current = (await this.readDisk()).value; }); }
  private change(mutator: (file: VocabularyFile) => boolean): Promise<void> {
    return this.enqueue(async () => {
      const previous = await this.readDisk();
      const next = structuredClone(previous.value);
      if (!mutator(next)) { this.publish(previous.value); return; }
      validateVocabulary(next);
      const serialized = JSON.stringify(next, null, 2) + "\n";
      try {
        await this.fs.write(this.path, serialized);
        if (await this.fs.read(this.path) !== serialized) throw new Error("生词保存校验失败");
      } catch (error) {
        // Restore the previous file on recoverable failures; never create a history file.
        try {
          if (previous.raw !== null) await this.fs.write(this.path, previous.raw);
          else if (await this.fs.exists(this.path)) await this.fs.remove(this.path);
        } catch { /* Preserve a failed file for diagnosis, do not claim success. */ }
        throw error;
      }
      this.publish(next);
    });
  }
  lookup(result: TranslationResult, paragraphId: string | undefined, autoAdd: boolean): Promise<void> {
    const word = singleWord(result.query);
    if (!word) return Promise.resolve();
    return this.change((file) => {
      const previous = file.words.find((item) => item.word === word);
      if (!previous && !autoAdd) return false;
      const record: VocabularyWord = { ...result, word, lookupCount: Math.min(Number.MAX_SAFE_INTEGER, (previous?.lookupCount ?? 0) + 1), exposureCount: previous?.exposureCount ?? 0, noLookupCount: 0, seenParagraphs: paragraphId ? [paragraphId] : [] };
      if (previous) file.words[file.words.indexOf(previous)] = record;
      else file.words.push(record);
      return true;
    });
  }
  remove(text: string): Promise<void> {
    const word = singleWord(text);
    if (!word) return Promise.resolve();
    return this.change((file) => {
      const index = file.words.findIndex((record) => record.word === word);
      if (index < 0) return false;
      file.words.splice(index, 1);
      return true;
    });
  }
  expose(exposures: readonly WordExposure[], threshold: number): Promise<void> {
    return this.change((file) => {
      let changed = false;
      for (const event of exposures) {
        const record = file.words.find((word) => word.word === event.word);
        if (!record || record.lookupCount !== event.lookupCount || record.seenParagraphs.includes(event.paragraphId)) continue;
        record.seenParagraphs.push(event.paragraphId);
        record.exposureCount = Math.min(Number.MAX_SAFE_INTEGER, record.exposureCount + 1);
        record.noLookupCount++;
        changed = true;
        if (record.noLookupCount >= threshold) file.words.splice(file.words.indexOf(record), 1);
      }
      return changed;
    });
  }
}
