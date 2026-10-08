import type { Book } from "epubjs";
import type Section from "epubjs/types/section";

function yieldForInput(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { window.clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = window.setTimeout(finish, 16);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** Build the existing EPUB.js CFI index without its 100ms pause per chapter. */
export async function generateEpubLocations(book: Book, signal: AbortSignal): Promise<void> {
  if (book.locations.length() || signal.aborted) return;
  // The pinned EPUB.js parser is shared with locations.generate(). Loading an
  // independent document avoids unloading the section currently being read.
  const parser = book.locations as unknown as { parse(root: Element, base: string, chars: number): string[] };
  const locations: string[] = [];
  await book.loaded.spine;
  const sections: Section[] = [];
  book.spine.each((section: Section) => sections.push(section));
  for (const section of sections) {
    if (!section.linear) continue;
    await yieldForInput(signal);
    if (signal.aborted) return;
    if (!section.cfiBase) throw new Error("EPUB 章节缺少位置标识");
    const doc = await book.load(section.href) as Document;
    if (signal.aborted) return;
    await book.spine.hooks.content.trigger(doc, section);
    if (signal.aborted) return;
    locations.push(...parser.parse(doc.documentElement, section.cfiBase, 256));
  }
  if (!signal.aborted) book.locations.load(JSON.stringify(locations));
}
