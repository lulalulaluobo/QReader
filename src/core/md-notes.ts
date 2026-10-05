// Renders 批注.md from reading state (PRD §14).
// Chapters keep book order; EPUB entries compare CFIs and PDF entries use
// page/text-item offsets. Creation time never determines reading order.

import { EpubCFI } from "epubjs";
import { QUESTION_LABELS } from "../types";
import type { AnnotationRecord, ChapterState, ReadingFile } from "../types";
import { fmtDateTime } from "../util";
import { chapterNotes, feedbackSections } from "./chapter-notes";
import { annotationRevisions, noteAnchor, sourceUrl } from "./note-history";
import type { TraceRef } from "./note-history";

function quoteBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines.map((l) => `> ${l}`).join("\n");
}

function section(title: string, body: string | undefined): string {
  const content = body && body.trim() ? body.trim() : "（空）";
  return `**${title}**\n\n${content}`;
}

export function renderAnnotationEntry(a: AnnotationRecord): string {
  return [
    `### ${fmtDateTime(a.createdAt)}`,
    "",
    `**位置**：${a.pdfPage ? `第 ${a.pdfPage} 页${a.itemRanges?.length ? `，文字项 ${a.itemRanges[0].item}，偏移 ${a.itemRanges[0].start}` : ""}` : a.cfi || `书内位置 ${a.sortKey}`}`,
    "",
    `**创建时间**：${fmtDateTime(a.createdAt)}${a.updatedAt ? `　**更新时间**：${fmtDateTime(a.updatedAt)}` : ""}`,
    "",
    quoteBlock(a.text || "（原文缺失）"),
    "",
    section("AI解释", a.aiExplanation),
    "",
    section("我的理解", a.note),
  ].join("\n");
}

function renderRevisionHistory(history: import("../types").NoteRevision[] | undefined): string {
  if (!history || history.length < 2) return "";
  const blocks = ["", "#### 修改历史", ""];
  for (const revision of history.slice(0, -1).reverse()) {
    blocks.push(`##### ${fmtDateTime(revision.at)}${revision.baseline ? " · 接入时的已存内容" : ""}`, "", section("当时的想法", revision.note), "");
    if (revision.aiExplanation) blocks.push(section("当时收录的 AI 解释", revision.aiExplanation), "");
  }
  return blocks.join("\n");
}

export function renderLegacyAnnotationsMd(reading: ReadingFile): string {
  const byChapter = new Map<string, AnnotationRecord[]>();
  for (const a of reading.annotations) {
    if (a.kind === "highlight") continue;
    const list = byChapter.get(a.chapterId);
    if (list) list.push(a);
    else byChapter.set(a.chapterId, [a]);
  }
  const chapters = Object.entries(reading.chapters)
    .map(([id, ch]) => ({ id, title: ch.title, index: ch.index, chapter: ch }))
    .sort((a, b) => a.index - b.index);
  const blocks: string[] = [`# ${reading.book.title}`, "", "阅读批注与历史记录。历史 AI 评价只供参考，不是标准答案。", ""];
  if (reading.bookNotes?.length) {
    blocks.push("## 关于这本书的想法", "");
    for (const note of reading.bookNotes) blocks.push(`### ${fmtDateTime(note.updatedAt ?? note.createdAt)}`, "", note.text, renderRevisionHistory(note.history), "");
  }
  for (const ch of chapters) {
    const cfi = new EpubCFI();
    const list = (byChapter.get(ch.id) ?? []).sort((a, b) => {
      if (a.cfi && b.cfi) return cfi.compare(a.cfi, b.cfi);
      if (a.pdfPage !== undefined && b.pdfPage !== undefined) return a.pdfPage - b.pdfPage || (a.itemRanges?.[0]?.item ?? 0) - (b.itemRanges?.[0]?.item ?? 0) || (a.itemRanges?.[0]?.start ?? 0) - (b.itemRanges?.[0]?.start ?? 0);
      return a.sortKey - b.sortKey;
    });
    if (list.length === 0 && !ch.chapter.questionVersions.length && !chapterNotes(ch.chapter).length) continue;
    blocks.push("", `## ${ch.title}`, "");
    blocks.push(renderChapterNotes(ch.chapter));
    blocks.push(list.map(record => renderAnnotationEntry(record) + renderRevisionHistory(record.history)).join("\n\n"));
    blocks.push("", "---");
  }
  return blocks.join("\n") + "\n";
}

export function renderChapterNotes(chapter: ChapterState): string {
  const blocks: string[] = [];
  for (const version of chapter.questionVersions) {
    blocks.push(`### 阅读三问 · 问题版本 ${version.version}`, "");
    for (const question of version.questions) blocks.push(`**${QUESTION_LABELS[question.type]}**：${question.text}`, "");
  }
  for (const note of chapterNotes(chapter)) {
    blocks.push(`### ${note.legacyReview ? "历史复习记录" : "我的阅读想法"} · ${fmtDateTime(note.at)} · 问题版本 ${note.version}`, "");
    const version = chapter.questionVersions.find(version => version.version === note.version);
    if (version) {
      for (const question of version.questions) blocks.push(`**${QUESTION_LABELS[question.type]}**：${question.text}`, "", section("我的想法", note.answers[question.id] || "（未记录，可略过）"), "");
    } else {
      blocks.push("该次问题版本不可用，保留原回答及问题编号。", "");
      for (const [id, answer] of Object.entries(note.answers)) blocks.push(section(id, answer), "");
    }
    if (note.record.feedback) {
      blocks.push("#### AI 参考评价", "", "仅供参考，不是标准答案。", "");
      for (const item of feedbackSections(note.record.feedback)) if (item.content) blocks.push(section(item.title, item.content), "");
    }
  }
  return blocks.join("\n");
}

export interface DocumentContext { bookId: string; vault?: string; language?: "zh-CN" | "en" }
function documentText(context: DocumentContext): (zh: string, en: string) => string {
  return (zh, en) => context.language === "en" ? en : zh;
}
const mdLabel = (text: string): string => text.replace(/[\\\x60*_{}\[\]<>#!|]/g, "\\$&").replace(/\r?\n/g, " ");
function anchor(ref: TraceRef): string { return '<span id="' + noteAnchor(ref.id, ref.revisionId) + '"></span>'; }
function boundary(kind: TraceRef["kind"], id: string, end = false): string {
  return "<!-- " + (end ? "/" : "") + "qreader-entry: " + kind + "/" + encodeURIComponent(id) + " -->";
}

export function lastNoteAt(reading: ReadingFile): string | undefined {
  const dates = [
    ...reading.annotations.map(a => a.history?.at(-1)?.at ?? a.createdAt),
    ...(reading.bookNotes ?? []).map(n => n.history.at(-1)?.at ?? n.createdAt),
    ...Object.values(reading.chapters).flatMap(ch => chapterNotes(ch).map(n => n.at)),
    reading.notesSync?.manualEditedAt,
  ].filter((date): date is string => !!date && Number.isFinite(Date.parse(date)));
  return dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

// Merge this generated baseline with the actual user-owned Markdown.
export function renderAnnotationsMd(reading: ReadingFile, context: DocumentContext = { bookId: reading.book.title }): string {
  const t = documentText(context);
  const original = encodeURIComponent(reading.book.fileName).replace(/[()]/g, c => "%" + c.charCodeAt(0).toString(16));
  const blocks = [
    "# " + mdLabel(reading.book.title), "",
    t("**作者**：", "**Author**: ") + mdLabel(reading.book.author || t("（未注明）", "(Unknown)")), "",
    t("**原书**：[", "**Original book**: [") + mdLabel(reading.book.fileName) + "](./" + original + ")", "",
    t("**最近阅读**：", "**Last read**: ") + (reading.progress.lastReadAt || t("（尚未阅读）", "(Not read yet)")), "",
    t("**最近笔记**：", "**Last note**: ") + (lastNoteAt(reading) ?? t("（尚未记录）", "(Not recorded yet)")), "",
    t("## 关于这本书的想法", "## My thoughts on this book"), "",
  ];
  for (const note of reading.bookNotes ?? []) {
    const last = note.history[note.history.length - 1];
    const ref: TraceRef = { bookId: context.bookId, kind: "bookNote", id: note.id, revisionId: last.id };
    blocks.push(boundary("bookNote", note.id), anchor(ref), "### " + mdLabel(last.at), "", note.text, "", renderDocumentHistory(note.id, "bookNote", note.history, context), boundary("bookNote", note.id, true), "");
  }
  for (const [id, chapter] of Object.entries(reading.chapters).sort((a, b) => a[1].index - b[1].index)) {
    const list = reading.annotations.filter(a => a.chapterId === id).sort((a, b) => {
      if (a.cfi && b.cfi) {
        try { return new EpubCFI().compare(a.cfi, b.cfi); } catch { /* Legacy CFI fallback. */ }
      }
      return (a.pdfPage ?? 0) - (b.pdfPage ?? 0) || (a.itemRanges?.[0]?.item ?? 0) - (b.itemRanges?.[0]?.item ?? 0) || (a.itemRanges?.[0]?.start ?? 0) - (b.itemRanges?.[0]?.start ?? 0) || a.sortKey - b.sortKey;
    });
    if (!list.length && !chapter.questionVersions.length && !chapterNotes(chapter).length) continue;
    blocks.push("## " + mdLabel(chapter.title), "");
    for (const a of list) {
      const revisions = annotationRevisions(a), last = revisions[revisions.length - 1];
      const ref: TraceRef = { bookId: context.bookId, kind: "annotation", id: a.id, revisionId: last.id };
      blocks.push(boundary("annotation", a.id), anchor(ref), t("### 摘抄 · ", "### Excerpt · ") + mdLabel(a.createdAt), "",
        t("[回到原文](", "[Go to original](") + sourceUrl(ref, context.vault) + ")", "",
        t("**位置**：", "**Location**: ") + (a.pdfPage ? t("第 " + a.pdfPage + " 页", "Page " + a.pdfPage) : mdLabel(a.cfi || t("书内位置 ", "Book position ") + a.sortKey)), "",
        quoteBlock(a.text || t("（原文缺失）", "(Original text missing)")), "");
      if (a.note?.trim()) blocks.push(t("**我的笔记**", "**My note**"), "", a.note, "", t("**笔记时间**：", "**Note date**: ") + mdLabel(last.at), "");
      if (a.aiExplanation?.trim()) blocks.push(t("**已保存的 AI 解释（参考）**", "**Saved AI explanation (reference)**"), "", a.aiExplanation, "");
      blocks.push(renderDocumentHistory(a.id, "annotation", revisions, context), boundary("annotation", a.id, true), "");
    }
    if (chapter.questionVersions.length || chapterNotes(chapter).length) {
      blocks.push("<details>", t("<summary>历史三问与回答</summary>", "<summary>Archived questions and answers</summary>"), "", renderChapterNotes(chapter), "", "</details>", "");
    }
  }
  return blocks.join("\n").replace(/\n{4,}/g, "\n\n\n") + "\n";
}
function renderDocumentHistory(id: string, kind: TraceRef["kind"], history: import("../types").NoteRevision[], context: DocumentContext): string {
  const t = documentText(context);
  if (history.length < 2) return "";
  const blocks = ["<details>", t("<summary>修改历史</summary>", "<summary>Revision history</summary>"), ""];
  for (const revision of history.slice(0, -1).reverse()) {
    const ref: TraceRef = { bookId: context.bookId, kind, id, revisionId: revision.id };
    blocks.push(anchor(ref), "#### " + mdLabel(revision.at) + (revision.baseline ? t(" · 接入时的已存内容", " · Previously saved text") : ""), "", section(t("当时的笔记", "Note at that time"), revision.note), "");
    if (revision.aiExplanation) blocks.push(section(t("当时收录的 AI 解释（参考）", "AI explanation saved at that time (reference)"), revision.aiExplanation), "");
  }
  blocks.push("</details>");
  return blocks.join("\n");
}
