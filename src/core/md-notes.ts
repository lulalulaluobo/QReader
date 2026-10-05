// Renders 批注.md from reading state (PRD §14).
// Chapters keep book order; EPUB entries compare CFIs and PDF entries use
// page/text-item offsets. Creation time never determines reading order.

import { EpubCFI } from "epubjs";
import { QUESTION_LABELS } from "../types";
import type { AnnotationRecord, ChapterState, ReadingFile } from "../types";
import { fmtDateTime } from "../util";
import { chapterNotes, feedbackSections } from "./chapter-notes";

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

export function renderAnnotationsMd(reading: ReadingFile): string {
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
