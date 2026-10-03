import type { FsLike } from "./fs";
import type { ReadingFile } from "../types";

export interface LoadResult {
  store: JsonStore;
  value: ReadingFile | null;
  damaged: boolean;
  recoveredFromBackup: boolean;
}
export type ReadingValidator = (raw: unknown) => ReadingFile;

/** A failed job never poisons the next job; stores of the same file share a queue. */
const queues = new WeakMap<object, Map<string, Promise<void>>>();

export class JsonStore {
  private lastGood: string | undefined;
  private live: ReadingFile | null = null;
  damaged = false;

  private constructor(private fs: FsLike, private path: string, private validate: ReadingValidator) {}

  get value(): ReadingFile | null { return this.live; }

  async matchesDisk(): Promise<boolean> {
    let matches = false;
    await this.enqueue(async () => {
      matches = !this.damaged && this.lastGood !== undefined && await this.fs.exists(this.path) && await this.fs.read(this.path) === this.lastGood;
    });
    return matches;
  }

  private enqueue(run: () => Promise<void>): Promise<void> {
    const scope = this.fs.queueScope ?? this.fs;
    let files = queues.get(scope);
    if (!files) { files = new Map(); queues.set(scope, files); }
    const job = (files.get(this.path) ?? Promise.resolve()).then(run, run);
    files.set(this.path, job);
    return job;
  }

  static async open(fs: FsLike, path: string, validate: ReadingValidator): Promise<LoadResult> {
    const store = new JsonStore(fs, path, validate);
    await store.enqueue(async () => {
      if (!(await fs.exists(path))) return;
      const raw = await fs.read(path);
      const main = tryParse(raw, validate);
      if (main.ok) { store.live = main.value; store.lastGood = raw; return; }
      store.damaged = true;
      if (await fs.exists(path + ".recovery")) {
        const backupRaw = await fs.read(path + ".recovery");
        const backup = tryParse(backupRaw, validate);
        if (backup.ok) { store.live = backup.value; store.lastGood = backupRaw; }
      }
    });
    return { store, value: store.live, damaged: store.damaged, recoveredFromBackup: store.damaged && store.live !== null };
  }

  /** Recovery is opt-in: opening a damaged main never makes it writable. */
  restoreRecovery(): Promise<void> {
    return this.enqueue(async () => {
      const raw = this.lastGood ?? await this.fs.read(this.path + ".recovery");
      const fresh = this.validate(JSON.parse(raw));
      await this.replaceDamaged(fresh, raw);
    });
  }

  reset(fresh: ReadingFile): Promise<void> {
    return this.enqueue(() => this.replaceDamaged(fresh, JSON.stringify(this.validate(fresh), null, 2)));
  }

  private async replaceDamaged(fresh: ReadingFile, raw: string): Promise<void> {
    if (await this.fs.exists(this.path)) {
      const old = await this.fs.read(this.path);
      let backup = this.path + ".corrupt";
      for (let n = 1; await this.fs.exists(backup); n++) backup = this.path + `.corrupt.${n}`;
      await this.fs.write(backup, old);
      if (await this.fs.read(backup) !== old) throw new Error("损坏文件备份校验失败，未执行恢复");
    }
    this.damaged = true;
    await this.fs.write(this.path, raw);
    if (await this.fs.read(this.path) !== raw) throw new Error("恢复写入校验失败，损坏文件备份已保留");
    if (this.live) restoreObject(this.live, fresh);
    else this.live = fresh;
    this.lastGood = raw;
    this.damaged = false;
  }

  mutate(fn: (v: ReadingFile) => void | Promise<void>, afterCommit?: (v: ReadingFile) => Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      if (this.damaged) throw new Error("reading.json 已损坏或被外部修改，请显式恢复后再写入");
      if (!this.live) throw new Error("reading.json 尚未加载");
      await this.checkDisk();
      const before = this.validate(JSON.parse(JSON.stringify(this.live)));
      try {
        await fn(this.live);
        this.validate(this.live);
        await this.flush();
      } catch (error) {
        restoreObject(this.live, before);
        throw error;
      }
      if (afterCommit) await afterCommit(this.live);
    });
  }

  private async checkDisk(): Promise<void> {
    const exists = await this.fs.exists(this.path);
    if (this.lastGood === undefined) {
      if (!exists) return;
    } else if (exists && await this.fs.read(this.path) === this.lastGood) return;
    this.damaged = true;
    throw new Error("reading.json 与已加载版本不一致，写入已暂停；请重新加载或显式恢复");
  }

  private async flush(): Promise<void> {
    const str = JSON.stringify(this.live, null, 2);
    this.validate(JSON.parse(str));
    await this.checkDisk();
    if (str === this.lastGood) return;
    if (this.lastGood !== undefined && this.lastGood !== str) {
      await this.fs.write(this.path + ".recovery", this.lastGood);
      if (await this.fs.read(this.path + ".recovery") !== this.lastGood) throw new Error("reading.json 恢复副本校验失败");
    }
    try {
      await this.fs.write(this.path, str);
      if (await this.fs.read(this.path) !== str) throw new Error("reading.json 写入校验失败");
    } catch (error) {
      if (this.lastGood !== undefined) {
        try {
          await this.fs.write(this.path, this.lastGood);
          if (await this.fs.read(this.path) !== this.lastGood) throw new Error("回滚校验失败");
        } catch {
          this.damaged = true;
          throw new Error("reading.json 写入及回滚失败，写入已暂停；恢复副本已保留");
        }
      } else {
        this.damaged = await this.fs.exists(this.path);
      }
      throw error;
    }
    this.lastGood = str;
  }

  static forNew(fs: FsLike, path: string, validate: ReadingValidator, initial: ReadingFile): JsonStore {
    const store = new JsonStore(fs, path, validate);
    store.live = validate(initial);
    return store;
  }
  static persistNew(store: JsonStore): Promise<void> { return store.mutate(() => {}); }
}

/** Preserve the live root and existing nested records when rolling back. */
function restoreObject(target: object, source: object): void {
  const targetValues: Record<string, unknown> = Object.fromEntries(Object.entries(target));
  const sourceValues: Record<string, unknown> = Object.fromEntries(Object.entries(source));
  for (const key of Object.keys(targetValues)) if (!(key in sourceValues)) Reflect.deleteProperty(target, key);
  if (Array.isArray(target) && Array.isArray(source)) target.length = source.length;
  for (const [key, value] of Object.entries(sourceValues)) {
    const current = targetValues[key];
    if (typeof current === "object" && current !== null && typeof value === "object" && value !== null && Array.isArray(current) === Array.isArray(value)) {
      restoreObject(current, value);
    } else Reflect.set(target, key, value);
  }
}

type ParseOutcome = { ok: true; value: ReadingFile } | { ok: false };
export function tryParse(raw: string, validate: ReadingValidator): ParseOutcome {
  try { return { ok: true, value: validate(JSON.parse(raw)) }; }
  catch { return { ok: false }; }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`reading.json ${label} 必须是对象`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`reading.json ${label} 必须是文本`);
}
function number(value: unknown, label: string, min = 0, max = Infinity): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`reading.json ${label} 数值无效`);
}
function integer(value: unknown, label: string, min = 0, max = Infinity): asserts value is number {
  number(value, label, min, max);
  if (!Number.isInteger(value)) throw new Error(`reading.json ${label} 必须是整数`);
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`reading.json ${label} 必须是数组`);
  return value;
}
function optionalString(value: unknown, label: string): void { if (value !== undefined) string(value, label); }
function answers(value: unknown): void {
  for (const v of Object.values(requireRecord(value, "answers"))) string(v, "answer");
}
function feedback(value: unknown): void {
  const f = requireRecord(value, "feedback");
  string(f.authorView, "authorView"); optionalString(f.rethink, "rethink"); optionalString(f.factualErrors, "factualErrors");
}

/** Strict boundary validation. Never repair missing histories by replacing them. */
export function validateReading(raw: unknown): ReadingFile {
  const v = requireRecord(raw, "根节点");
  if (v.version !== 1) throw new Error("不支持的 reading.json 版本");
  const b = requireRecord(v.book, "book");
  string(b.title, "title"); string(b.author, "author"); string(b.fileName, "fileName");
  if (!b.fileName || /[\\/]/.test(b.fileName) || b.fileName === "." || b.fileName === "..") throw new Error("reading.json 原书文件名无效");
  if (b.format !== "epub" && b.format !== "pdf") throw new Error("reading.json 书籍格式无效");
  if (b.spineLength !== undefined) integer(b.spineLength, "spineLength", 1);
  if (b.numPages !== undefined) integer(b.numPages, "numPages", 1);
  string(v.importedAt, "importedAt");
  const chapters = requireRecord(v.chapters, "chapters");
  const p = requireRecord(v.progress, "progress");
  if (p.chapterId !== null) { string(p.chapterId, "chapterId"); if (!(p.chapterId in chapters)) throw new Error("reading.json 当前章节不存在"); }
  number(p.percent, "percent", 0, 1); string(p.lastReadAt, "lastReadAt");
  if (p.cfi !== undefined && p.cfi !== null) string(p.cfi, "cfi");
  if (p.pdfPage !== undefined && p.pdfPage !== null) integer(p.pdfPage, "pdfPage", 1);
  if (p.pdfPageFraction !== undefined && p.pdfPageFraction !== null) number(p.pdfPageFraction, "pdfPageFraction", 0, 1);
  for (const rawChapter of Object.values(chapters)) {
    const ch = requireRecord(rawChapter, "chapter");
    string(ch.title, "chapter.title"); integer(ch.index, "chapter.index");
    if (ch.spineIndex !== undefined) integer(ch.spineIndex, "spineIndex");
    optionalString(ch.href, "href"); optionalString(ch.hrefEnd, "hrefEnd");
    if (ch.custom !== undefined && typeof ch.custom !== "boolean") throw new Error("reading.json custom 无效");
    if (ch.pdfStartPage !== undefined) integer(ch.pdfStartPage, "pdfStartPage", 1);
    if (ch.pdfEndPage !== undefined) integer(ch.pdfEndPage, "pdfEndPage", typeof ch.pdfStartPage === "number" ? ch.pdfStartPage : 1);
    const versions = new Set<number>();
    for (const rawVersion of list(ch.questionVersions, "questionVersions")) {
      const qv = requireRecord(rawVersion, "questionVersion");
      integer(qv.version, "questionVersion.version", 1); string(qv.createdAt, "questionVersion.createdAt");
      if (versions.has(qv.version)) throw new Error("reading.json 问题版本重复");
      versions.add(qv.version);
      const questions = list(qv.questions, "questions");
      if (questions.length !== 3) throw new Error("reading.json 每章必须恰好三问");
      const expected = ["core", "logic", "retell"];
      const texts = new Set<string>();
      questions.forEach((rawQuestion, i) => {
        const q = requireRecord(rawQuestion, "question");
        if (q.id !== `q${i + 1}` || q.type !== expected[i]) throw new Error("reading.json 三问类型或编号无效");
        string(q.text, "question.text");
        const normalized = q.text.replace(/\s+/g, "");
        if (!normalized || texts.has(normalized)) throw new Error("reading.json 问题为空或重复");
        texts.add(normalized);
      });
    }
    for (const rawAnswer of list(ch.answers, "chapter.answers")) {
      const a = requireRecord(rawAnswer, "answer");
      integer(a.questionVersion, "answer.questionVersion", 1);
      if (!versions.has(a.questionVersion)) throw new Error("reading.json 回答关联的问题版本不存在");
      answers(a.answers); string(a.answeredAt, "answeredAt");
      if (a.feedback !== undefined) feedback(a.feedback);
    }
    for (const rawReview of list(ch.reviews, "reviews")) {
      const r = requireRecord(rawReview, "review");
      optionalString(r.scheduledFor, "scheduledFor"); optionalString(r.completedAt, "completedAt");
      if (r.questionVersion !== undefined) { integer(r.questionVersion, "review.questionVersion", 1); if (!versions.has(r.questionVersion)) throw new Error("reading.json 复习关联的问题版本不存在"); }
      if (r.answers !== undefined) answers(r.answers);
      if (r.feedback !== undefined) feedback(r.feedback);
      if (r.completedAt !== undefined && (r.answers === undefined || r.questionVersion === undefined)) throw new Error("reading.json 已完成复习缺少回答或问题版本");
      if (r.completedAt === undefined && r.scheduledFor === undefined) throw new Error("reading.json 复习缺少预约或完成时间");
    }
  }
  const annotationIds = new Set<string>();
  for (const rawAnnotation of list(v.annotations, "annotations")) {
    const a = requireRecord(rawAnnotation, "annotation");
    string(a.id, "annotation.id"); string(a.chapterId, "annotation.chapterId"); string(a.text, "annotation.text"); string(a.createdAt, "annotation.createdAt");
    if (!(a.chapterId in chapters) || annotationIds.has(a.id)) throw new Error("reading.json 批注章节无效或编号重复");
    annotationIds.add(a.id); number(a.sortKey, "sortKey");
    optionalString(a.updatedAt, "updatedAt"); optionalString(a.note, "note"); optionalString(a.aiExplanation, "aiExplanation"); optionalString(a.cfi, "annotation.cfi");
    if (a.pdfPage !== undefined) integer(a.pdfPage, "annotation.pdfPage", 1);
    if (a.itemRanges !== undefined) for (const rawRange of list(a.itemRanges, "itemRanges")) {
      const r = requireRecord(rawRange, "itemRange"); integer(r.item, "item"); integer(r.start, "start"); integer(r.end, "end", r.start);
      if (r.rects !== undefined) for (const rawRect of list(r.rects, "rects")) {
        const rect = requireRecord(rawRect, "rect");
        number(rect.x, "rect.x", 0, 1); number(rect.y, "rect.y", 0, 1);
        number(rect.width, "rect.width", 0, 1); number(rect.height, "rect.height", 0, 1);
      }
    }
  }
  return raw as ReadingFile;
}
