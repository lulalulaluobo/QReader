import type { FsLike } from "./fs";
import type { HealthyBookEntry } from "../types";
import type { TraceRef, TraceSource } from "./note-history";
import { validateRef, traceKey, traceSources, sourceUrl } from "./note-history";
import { textHash } from "./note-document";
import { fmtDateTime } from "../util";

export const RELATIONS = ["related", "support", "challenge", "refine", "example"] as const;
export type Relation = typeof RELATIONS[number];
export const RELATION_LABELS = { related: "相关", support: "支持", challenge: "不同看法", refine: "补充或修正", example: "案例" } as const;
export interface ThoughtItem { ref: TraceRef; relation: Relation; reason: string; addedAt: string }
export interface ThoughtThread {
  id: string; title: string; judgment: string; unresolved: string;
  createdAt: string; updatedAt: string; items: ThoughtItem[];
}
export interface ThinkingFile { version: 1; threads: ThoughtThread[] }
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("思考线数据格式无效");
  return raw as Record<string, unknown>;
}
function text(value: unknown, max = 100000): asserts value is string {
  if (typeof value !== "string" || value.length > max) throw new Error("思考线文字格式无效");
}
function date(value: unknown): void { text(value, 100); if (!Number.isFinite(Date.parse(value))) throw new Error("思考线时间无效"); }
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
export function renderThoughtMarkdown(thread: ThoughtThread, sources: TraceSource[], language: "zh-CN" | "en" = "zh-CN", vault?: string): string {
  const t = (zh: string, en: string): string => language === "en" ? en : zh;
  const byKey = new Map(sources.map(source => [source.key, source]));
  const blocks = [`# ${mdText(thread.title)}`, "", t(`导出快照：${fmtDateTime(new Date().toISOString())}。原笔记后续修改不会自动改写此文件。`, `Export snapshot: ${fmtDateTime(new Date().toISOString())}. Later edits or deletions of original notes do not update this file.`), "", t("## 我目前怎么看", "## My current view"), "", mdText(thread.judgment || t("（尚未记录）", "(Not recorded yet)")), "", t("## 仍想探索", "## Still exploring"), "", mdText(thread.unresolved || t("（尚未记录）", "(Not recorded yet)")), "", t("## 阅读记录", "## Reading records"), ""];
  const items = [...thread.items].sort((a, b) => Date.parse(byKey.get(traceKey(a.ref))?.at ?? a.addedAt) - Date.parse(byKey.get(traceKey(b.ref))?.at ?? b.addedAt));
  for (const item of items) {
    const source = byKey.get(traceKey(item.ref));
    if (!source) {
      blocks.push(t("### 来源已删除或不可用", "### Source deleted or unavailable"), "",
        t("此引用不再包含原文或个人批注。", "This reference no longer contains the original quote or personal note."), "",
        t("记录时间：", "Recorded: ") + item.addedAt, "",
        t("此前记录的关系：", "Previously recorded connection: ") + RELATION_LABELS[item.relation], "",
        mdText(item.reason), "");
      continue;
    }
    blocks.push(`### ${fmtDateTime(source.at)} · ${mdText(source.bookTitle)}`, "", `[${source.ref.kind === "annotation" ? t("回到原文", "Go to original") : t("查看书籍想法", "View book thought")}](${sourceUrl(source.ref, vault)})`, "");
    if (source.baseline) blocks.push(t("既有笔记：此前修改历史未记录。", "Existing note: earlier revisions were not recorded."), "");
    if (source.quote) blocks.push(...mdText(source.quote).split(/\r?\n/).map(line => "> " + line), "");
    blocks.push(t("**我的想法**", "**My thought**"), "", mdText(source.note || t("（未记录）", "(Not recorded)")), "", t(`关系：${RELATION_LABELS[item.relation]}`, `Connection: ${{ related: "Related", support: "Supports", challenge: "Different perspective", refine: "Adds to or refines", example: "Example" }[item.relation]}`), "", mdText(item.reason), "");
    if (source.aiExplanation) blocks.push(t("**已保存的 AI 解释（参考）**", "**Saved AI explanation (reference)"), "", mdText(source.aiExplanation), "");
  }
  return blocks.join("\n") + "\n";
}

const jobs = new WeakMap<object, Map<string, Promise<string | null>>>();
export async function archiveLegacyNotes(fs: FsLike, root: string, entries: HealthyBookEntry[], vault?: string): Promise<string | null> {
  const scope = fs.queueScope ?? fs;
  let pending = jobs.get(scope);
  if (!pending) { pending = new Map(); jobs.set(scope, pending); }
  const existing = pending.get(root);
  if (existing) return existing;
  const job = doArchive(fs, root, entries, vault);
  pending.set(root, job);
  try { return await job; } finally { if (pending.get(root) === job) pending.delete(root); }
}
async function doArchive(fs: FsLike, root: string, entries: HealthyBookEntry[], vault?: string): Promise<string | null> {
  const original = root + "/.qreader/thinking.json";
  if (!await fs.exists(original)) return null;
  const raw = await fs.read(original), value = validateThinking(JSON.parse(raw));
  if (!value.threads.length) return null;
  const marker = "<!-- qreader-retired-thinking: " + await textHash(raw) + " -->";
  let path = root + "/旧版思考记录.md";
  for (let n = 2; await fs.exists(path); n++) {
    if ((await fs.read(path)).includes(marker)) return path;
    path = root + "/旧版思考记录 (" + n + ").md";
  }
  const sources = traceSources(entries);
  const text = ["# 旧版思考记录", "", marker, "", "此前主动写下的内容已保存为普通笔记。原始 thinking.json 保留不变。", "",
    ...value.threads.map(thread => "记录时间：" + thread.createdAt + "\n\n最近修改：" + thread.updatedAt + "\n\n" + renderThoughtMarkdown(thread, sources, "zh-CN", vault))].join("\n");
  await fs.write(path, text);
  if (await fs.read(path) !== text) throw new Error("旧版笔记归档写入校验失败");
  return path;
}
