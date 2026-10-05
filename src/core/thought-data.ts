import MiniSearch from "minisearch";
import type { AnnotationRecord, HealthyBookEntry, NoteRevision } from "../types";
import { fmtDateTime, genId } from "../util";

export const RELATIONS = ["related", "support", "challenge", "refine", "example"] as const;
export type Relation = typeof RELATIONS[number];
export const RELATION_LABELS = { related: "相关", support: "支持", challenge: "不同看法", refine: "补充或修正", example: "案例" } as const;
export interface TraceRef { bookId: string; kind: "annotation" | "bookNote"; id: string; revisionId: string }
export interface TraceSource {
  ref: TraceRef; key: string; bookTitle: string; chapterTitle: string;
  quote: string; note: string; aiExplanation?: string; at: string; baseline: boolean;
}
export interface ThoughtItem { ref: TraceRef; relation: Relation; reason: string; addedAt: string }
export interface ThoughtThread {
  id: string; title: string; judgment: string; unresolved: string;
  createdAt: string; updatedAt: string; items: ThoughtItem[];
}
export interface ThinkingFile { version: 1; threads: ThoughtThread[] }
export const traceKey = (ref: TraceRef): string => JSON.stringify([ref.bookId, ref.kind, ref.id, ref.revisionId]);

export function revision(note: string, aiExplanation?: string): NoteRevision {
  return { id: genId("revision"), at: new Date().toISOString(), note, aiExplanation };
}
export function annotationRevisions(record: AnnotationRecord): NoteRevision[] {
  return record.history ?? [{ id: "legacy", at: record.updatedAt ?? record.createdAt, note: record.note ?? "", aiExplanation: record.aiExplanation, baseline: true }];
}
export function appendAnnotationRevision(record: AnnotationRecord, before: AnnotationRecord): void {
  if ((record.note ?? "") === (before.note ?? "") && (record.aiExplanation ?? "") === (before.aiExplanation ?? "")) return;
  record.history ??= annotationRevisions(before);
  record.history.push(revision(record.note ?? "", record.aiExplanation));
}

export function traceSources(entries: HealthyBookEntry[], currentOnly = false): TraceSource[] {
  const result: TraceSource[] = [];
  for (const entry of entries) {
    const bookTitle = entry.reading.book.title;
    for (const record of entry.reading.annotations) {
      const revisions = annotationRevisions(record);
      for (const r of currentOnly ? revisions.slice(-1) : revisions) {
        const ref: TraceRef = { bookId: entry.id, kind: "annotation", id: record.id, revisionId: r.id };
        result.push({ ref, key: traceKey(ref), bookTitle, chapterTitle: entry.reading.chapters[record.chapterId]?.title ?? "", quote: record.text,
          note: r.note, aiExplanation: r.aiExplanation, at: r.at, baseline: !!r.baseline });
      }
    }
    for (const record of entry.reading.bookNotes ?? []) {
      for (const r of currentOnly ? record.history.slice(-1) : record.history) {
        const ref: TraceRef = { bookId: entry.id, kind: "bookNote", id: record.id, revisionId: r.id };
        result.push({ ref, key: traceKey(ref), bookTitle, chapterTitle: "", quote: "", note: r.note, at: r.at, baseline: !!r.baseline });
      }
    }
  }
  return result;
}

const STOP = new Set("的 了 是 在 和 与 也 就 都 而 我 你 他 她 它 这 那 一个 一种 可能 可以 认为 觉得 the a an and or of to in is are was it that this i my me for with as on be have has".split(" "));
export function tokenize(text: string): string[] {
  const lower = text.normalize("NFKC").toLowerCase();
  const terms: string[] = [];
  // Word segmentation plus Han bigrams preserves short Chinese concept matches.
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, opts: { granularity: string }) => { segment(text: string): Iterable<{ segment: string; isWordLike: boolean }> } }).Segmenter;
  if (Segmenter) for (const part of new Segmenter("zh", { granularity: "word" }).segment(lower)) {
    if (part.isWordLike && !STOP.has(part.segment) && part.segment.length > 1) terms.push(part.segment);
  }
  else terms.push(...(lower.match(/[a-z0-9]{2,}/g) ?? []).filter(t => !STOP.has(t)));
  for (const run of lower.match(/[\p{Script=Han}]+/gu) ?? []) for (let i = 0; i < run.length - 1; i++) {
    const term = run.slice(i, i + 2); if (!STOP.has(term)) terms.push(term);
  }
  return [...new Set(terms)];
}

export function relatedCandidates(source: TraceSource, items: TraceSource[], limit = 10): TraceSource[] {
  const candidates = items.filter(item => item.note.trim() && !(item.ref.bookId === source.ref.bookId && item.ref.kind === source.ref.kind && item.ref.id === source.ref.id));
  const index = new MiniSearch({ fields: ["note", "quote"], idField: "key", tokenize });
  index.addAll(candidates.map(item => ({ key: item.key, note: item.note.slice(0, 3000), quote: item.quote.slice(0, 1500) })));
  const query = tokenize(source.note + " " + source.quote).slice(0, 60).join(" ");
  if (!query) return [];
  const byKey = new Map(candidates.map(item => [item.key, item]));
  return index.search(query, { boost: { note: 3 }, combineWith: "OR" }).slice(0, Math.min(10, limit)).map(match => byKey.get(String(match.id))!).filter(Boolean);
}

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("思考线数据格式无效");
  return raw as Record<string, unknown>;
}
function text(value: unknown, max = 100000): asserts value is string {
  if (typeof value !== "string" || value.length > max) throw new Error("思考线文字格式无效");
}
function date(value: unknown): void { text(value, 100); if (!Number.isFinite(Date.parse(value))) throw new Error("思考线时间无效"); }
export function validateRef(raw: unknown): TraceRef {
  const ref = object(raw);
  for (const key of ["bookId", "id", "revisionId"] as const) { text(ref[key], 1000); if (!ref[key]) throw new Error("思考线来源编号无效"); }
  if (ref.kind !== "annotation" && ref.kind !== "bookNote") throw new Error("思考线来源类型无效");
  return raw as TraceRef;
}
export function validateThinking(raw: unknown): ThinkingFile {
  const value = object(raw);
  if (value.version !== 1 || !Array.isArray(value.threads)) throw new Error("思考线数据版本无效");
  const ids = new Set<string>();
  for (const rawThread of value.threads) {
    const t = object(rawThread); text(t.id, 1000); text(t.title, 200); text(t.judgment); text(t.unresolved); date(t.createdAt); date(t.updatedAt);
    if (!t.id || !t.title.trim() || ids.has(t.id) || !Array.isArray(t.items)) throw new Error("思考线标题或编号无效");
    ids.add(t.id);
    const refs = new Set<string>();
    for (const rawItem of t.items) {
      const item = object(rawItem); const ref = validateRef(item.ref); text(item.reason, 2000); date(item.addedAt);
      if (!RELATIONS.includes(item.relation as Relation) || refs.has(traceKey(ref))) throw new Error("思考线关系或重复来源无效");
      refs.add(traceKey(ref));
    }
  }
  return raw as ThinkingFile;
}

const mdText = (text: string): string => text.replace(/[\\`*_{}\[\]<>#!|]/g, "\\$&");
export function sourceUrl(ref: TraceRef, vault?: string): string {
  const params = new URLSearchParams({ book: ref.bookId, kind: ref.kind, note: ref.id, revision: ref.revisionId });
  if (vault) params.set("vault", vault);
  return "obsidian://qreader?" + params.toString();
}
export function renderThoughtMarkdown(thread: ThoughtThread, sources: TraceSource[], language: "zh-CN" | "en" = "zh-CN", vault?: string): string {
  const t = (zh: string, en: string): string => language === "en" ? en : zh;
  const byKey = new Map(sources.map(source => [source.key, source]));
  const blocks = [`# ${mdText(thread.title)}`, "", t(`导出快照：${fmtDateTime(new Date().toISOString())}。原笔记后续修改不会自动改写此文件。`, `Export snapshot: ${fmtDateTime(new Date().toISOString())}. Later edits or deletions of original notes do not update this file.`), "", t("## 我目前怎么看", "## My current view"), "", mdText(thread.judgment || t("（尚未记录）", "(Not recorded yet)")), "", t("## 仍想探索", "## Still exploring"), "", mdText(thread.unresolved || t("（尚未记录）", "(Not recorded yet)")), "", t("## 阅读记录", "## Reading records"), ""];
  const items = [...thread.items].sort((a, b) => Date.parse(byKey.get(traceKey(a.ref))?.at ?? a.addedAt) - Date.parse(byKey.get(traceKey(b.ref))?.at ?? b.addedAt));
  for (const item of items) {
    const source = byKey.get(traceKey(item.ref));
    if (!source) { blocks.push(t("### 来源已删除或不可用", "### Source deleted or unavailable"), "", t("此引用不再包含原文或个人批注。", "This reference no longer contains the original quote or personal note."), ""); continue; }
    blocks.push(`### ${fmtDateTime(source.at)} · ${mdText(source.bookTitle)}`, "", `[${source.ref.kind === "annotation" ? t("回到原文", "Go to original") : t("查看书籍想法", "View book thought")}](${sourceUrl(source.ref, vault)})`, "");
    if (source.baseline) blocks.push(t("既有笔记：此前修改历史未记录。", "Existing note: earlier revisions were not recorded."), "");
    if (source.quote) blocks.push(...mdText(source.quote).split(/\r?\n/).map(line => "> " + line), "");
    blocks.push(t("**我的想法**", "**My thought**"), "", mdText(source.note || t("（未记录）", "(Not recorded)")), "", t(`关系：${RELATION_LABELS[item.relation]}`, `Connection: ${{ related: "Related", support: "Supports", challenge: "Different perspective", refine: "Adds to or refines", example: "Example" }[item.relation]}`), "", mdText(item.reason), "");
    if (source.aiExplanation) blocks.push(t("**已保存的 AI 解释（参考）**", "**Saved AI explanation (reference)"), "", mdText(source.aiExplanation), "");
  }
  return blocks.join("\n") + "\n";
}
