// Renders 批注.md from reading state (PRD §14).
// Chapters keep book order; EPUB entries compare CFIs and PDF entries use
// page/text-item offsets. Creation time never determines reading order.

import { EpubCFI } from "epubjs";
import type { AnnotationRecord, ReadingFile } from "../types";
import { fmtDateTime } from "../util";

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

export function renderAnnotationsMd(reading: ReadingFile): string {
  const byChapter = new Map<string, AnnotationRecord[]>();
  for (const a of reading.annotations) {
    const list = byChapter.get(a.chapterId);
    if (list) list.push(a);
    else byChapter.set(a.chapterId, [a]);
  }
  const chapters = Object.entries(reading.chapters)
    .map(([id, ch]) => ({ id, title: ch.title, index: ch.index }))
    .sort((a, b) => a.index - b.index);
  const blocks: string[] = [`# ${reading.book.title}`];
  for (const ch of chapters) {
    const cfi = new EpubCFI();
    const list = (byChapter.get(ch.id) ?? []).sort((a, b) => {
      if (a.cfi && b.cfi) return cfi.compare(a.cfi, b.cfi);
      if (a.pdfPage !== undefined && b.pdfPage !== undefined) return a.pdfPage - b.pdfPage || (a.itemRanges?.[0]?.item ?? 0) - (b.itemRanges?.[0]?.item ?? 0) || (a.itemRanges?.[0]?.start ?? 0) - (b.itemRanges?.[0]?.start ?? 0);
      return a.sortKey - b.sortKey;
    });
    if (list.length === 0) continue;
    blocks.push("", `## ${ch.title}`, "");
    blocks.push(list.map(renderAnnotationEntry).join("\n\n"));
    blocks.push("", "---");
  }
  return blocks.join("\n") + "\n";
}
