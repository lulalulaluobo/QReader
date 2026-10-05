import { EpubCFI } from "epubjs";
import type { SpeechSegment } from "./engine";

/** Offset-preserving short sentences: useful for both audio requests and source anchors. */
export function sentenceSlices(text: string, limit = 180): { start: number; end: number; text: string }[] {
  const result: { start: number; end: number; text: string }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + limit);
    // Never split a UTF-16 surrogate pair.
    if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    const part = text.slice(start, end);
    const punctuation = /[。！？][”’"']?|[.!?](?:[”’"']|\s|$)|\n/g;
    const first = punctuation.exec(part);
    if (first) end = start + first.index + first[0].length;
    else if (end < text.length) {
      const space = part.lastIndexOf(" ");
      if (space > limit / 2) end = start + space + 1;
    }
    const raw = text.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    if (raw.trim()) result.push({ start: start + leading, end: end - trailing, text: raw.trim().replace(/\s+/g, " ") });
    start = end;
  }
  return result;
}

/** Original text nodes stay untouched, so annotations and saved CFIs remain valid. */
export function epubSpeechSegments(doc: Document, base: string, from?: string | null): SpeechSegment[] {
  const root = doc.body ?? doc.querySelector("body");
  if (!root) return [];
  const walker = doc.createTreeWalker(root, 4);
  const groups: { block: Element; nodes: Text[] }[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script,style,nav,rt,[hidden],[aria-hidden='true'],[style*='display:none'],[style*='display: none']")) continue;
    const block = parent.closest("p,li,blockquote,h1,h2,h3,h4,h5,h6,td,pre,div") ?? root;
    const previous = groups[groups.length - 1];
    if (previous?.block === block) previous.nodes.push(node as Text);
    else groups.push({ block, nodes: [node as Text] });
  }
  const result: SpeechSegment[] = [];
  const compare = new EpubCFI();
  for (const group of groups) {
    const text = group.nodes.map((n) => n.data).join("");
    for (const slice of sentenceSlices(text)) {
      const range = doc.createRange();
      let offset = 0;
      for (const n of group.nodes) {
        if (slice.start >= offset && slice.start < offset + n.length) range.setStart(n, slice.start - offset);
        if (slice.end > offset && slice.end <= offset + n.length) { range.setEnd(n, slice.end - offset); break; }
        offset += n.length;
      }
      const cfi = new EpubCFI(range, base).toString();
      const end = new EpubCFI(cfi); end.collapse(false);
      // Keep the sentence containing the viewport start, rather than cutting it midway.
      if (from && compare.compare(end.toString(), from) <= 0) continue;
      result.push({ text: slice.text, cfi });
    }
  }
  return result;
}
