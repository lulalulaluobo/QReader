import type { Book } from "epubjs";
import { EpubCFI } from "epubjs";
import type Section from "epubjs/types/section";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { EngineLocation, SearchResult } from "./engine";

export const SEARCH_LIMIT = 500;
/** Preserve original UTF-16 offsets; lowercasing can change their lengths. */
export function textMatches(text: string, query: string, limit = SEARCH_LIMIT): { start: number; end: number; excerpt: string }[] {
  const q = query.trim();
  if (!q || limit <= 0) return [];
  const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const hits: { start: number; end: number; excerpt: string }[] = [];
  let match: RegExpExecArray | null;
  while (hits.length < limit && (match = pattern.exec(text))) {
    const start = match.index, end = start + match[0].length;
    hits.push({ start, end, excerpt: text.slice(Math.max(0, start - 45), Math.min(text.length, end + 65)).replace(/\s+/g, " ") });
  }
  return hits;
}
export function textNodes(root: Element): { text: string; nodes: { node: Text; start: number }[] } {
  const nodes: { node: Text; start: number }[] = [];
  const walk = root.ownerDocument.createTreeWalker(root, 4);
  let text = "", node: Node | null;
  while ((node = walk.nextNode())) {
    if (node.parentElement?.closest("script,style,nav,[hidden],[aria-hidden=true]")) continue;
    if (node.textContent) { nodes.push({ node: node as Text, start: text.length }); text += node.textContent; }
  }
  return { text, nodes };
}
export function searchRange(doc: Document, nodes: { node: Text; start: number }[], start: number, end: number): Range | null {
  const at = (offset: number) => {
    let low = 0, high = nodes.length - 1;
    while (low <= high) { const mid = (low + high) >>> 1; if (nodes[mid].start <= offset) low = mid + 1; else high = mid - 1; }
    return nodes[high];
  };
  const first = at(start), last = at(end - 1);
  if (!first || !last) return null;
  const range = doc.createRange();
  range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
  return range;
}
export function searchYield(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, 0); signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}
export async function searchEpub(book: Book, query: string, signal: AbortSignal, receive: (batch: SearchResult[]) => void): Promise<void> {
  const sections: Section[] = [];
  book.spine.each((section: Section) => { if (section.linear) sections.push(section); });
  let count = 0;
  for (const section of sections) {
    await searchYield(signal); if (signal.aborted || count >= SEARCH_LIMIT) return;
    const doc = await book.load(section.href) as Document;
    if (signal.aborted) return;
    await book.spine.hooks.content.trigger(doc, section);
    const root = doc.querySelector("body"); if (!root) continue;
    const { text, nodes } = textNodes(root);
    const batch: SearchResult[] = [];
    for (const hit of textMatches(text, query, SEARCH_LIMIT - count)) {
      const range = searchRange(doc, nodes, hit.start, hit.end); if (!range) continue;
      const cfi = new EpubCFI(range, section.cfiBase).toString();
      const location: EngineLocation = { cfi, chapterId: null, percent: 0 };
      batch.push({ id: cfi, excerpt: hit.excerpt, location, title: section.href });
    }
    count += batch.length;
    if (!signal.aborted && batch.length) receive(batch);
  }
}
export async function searchPdf(doc: PDFDocumentProxy, query: string, signal: AbortSignal, receive: (batch: SearchResult[]) => void, keepPage: (number: number) => boolean = () => false): Promise<void> {
  let count = 0;
  for (let number = 1; number <= doc.numPages; number++) {
    await searchYield(signal); if (signal.aborted || count >= SEARCH_LIMIT) return;
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    if (!keepPage(number)) page.cleanup();
    if (signal.aborted) return;
    const items = content.items.filter((item): item is TextItem => "str" in item);
    const starts: number[] = []; let text = "";
    for (const item of items) { starts.push(text.length); text += item.str + (item.hasEOL ? "\n" : " "); }
    const batch = textMatches(text, query, SEARCH_LIMIT - count).map(hit => {
      const itemRanges = items.flatMap((item, index) => {
        const start = Math.max(0, hit.start - starts[index]), end = Math.min(item.str.length, hit.end - starts[index]);
        return end > start ? [{ item: index, start, end }] : [];
      });
      return { id: `${number}:${hit.start}`, title: String(number), excerpt: hit.excerpt,
        location: { chapterId: null, percent: (number - 1) / doc.numPages, pdfPage: number, pageFraction: 0 }, itemRanges };
    });
    count += batch.length;
    if (!signal.aborted && batch.length) receive(batch);
  }
}
