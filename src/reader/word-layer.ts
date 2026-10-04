import type { VocabularyWord, WordExposure } from "../core/vocabulary";

interface HighlightRegistry { set(name: string, value: unknown): void; delete(name: string): void }
interface HighlightWindow extends Window {
  CSS?: { highlights?: HighlightRegistry };
  Highlight?: new (...ranges: Range[]) => unknown;
}
interface Token { word: VocabularyWord; range: Range; paragraphId: string }
interface Paragraph { element: HTMLElement; id: string }
let serial = 0;
const blocks = "p,li,blockquote,h1,h2,h3,h4,h5,h6,td,pre";
const wordPattern = /[a-z]+(?:['’-][a-z]+)*/gi;
const opacity = [0.30, 0.24, 0.18, 0.12, 0.06];

/** Reads original text nodes without wrapping them, preserving EPUB CFI offsets. */
export class WordLayer {
  private paragraphs: Paragraph[];
  private wordSignature = "";
  private tokens: Token[] = [];
  private episodes = new Map<string, WordExposure>();
  private suppressed = new Map<string, number>();
  private lookupCounts = new Map<string, number>();
  private names = opacity.map((_, index) => `qr-vocabulary-${++serial}-${index}`);
  private style: HTMLStyleElement;
  private overlay: HTMLElement | null = null;
  private observer: IntersectionObserver;
  private resize: ResizeObserver;
  private frame: number | null = null;
  private destroyed = false;
  private highlighted = true;
  private threshold = 5;
  private win: HighlightWindow;
  private schedule = (): void => {
    if (this.destroyed || this.frame !== null) return;
    this.frame = this.doc.defaultView!.requestAnimationFrame(() => { this.frame = null; this.sample(); });
  };

  constructor(private doc: Document, private root: HTMLElement, private host: HTMLElement,
    prefix: string, private onExposure: (events: readonly WordExposure[]) => void, pdf = false) {
    this.win = doc.defaultView as HighlightWindow;
    this.paragraphs = pdf
      ? Array.from(root.querySelectorAll<HTMLElement>("[data-qr-paragraph]")).map((element) => ({ element, id: element.dataset.qrParagraph! }))
      : Array.from(root.querySelectorAll<HTMLElement>(blocks)).map((element, index) => ({ element, id: `${prefix}:${index}` }));
    if (!this.paragraphs.length) this.paragraphs = [{ element: root, id: `${prefix}:0` }];
    this.style = doc.createElement("style");
    this.style.textContent = this.names.map((name, index) => `::highlight(${name}){background-color:rgba(70,155,235,${opacity[index]});}`).join("\n");
    (doc.head ?? doc.documentElement).appendChild(this.style);
    this.observer = new IntersectionObserver(this.schedule, { threshold: [0, 0.01] });
    this.resize = new ResizeObserver(this.schedule);
    this.resize.observe(host);
    doc.addEventListener("scroll", this.schedule, true);
    host.addEventListener("scroll", this.schedule, true);
    doc.addEventListener("visibilitychange", this.schedule);
    host.ownerDocument.addEventListener("visibilitychange", this.schedule);
  }
  paragraphId(node: Node): string | undefined {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    const closest = element?.closest("[data-qr-paragraph]," + blocks);
    return this.paragraphs.find((paragraph) => paragraph.element === closest)?.id
      ?? this.paragraphs.find((paragraph) => paragraph.element.contains(node))?.id;
  }
  set(words: readonly VocabularyWord[], highlight: boolean, threshold = 5): void {
    this.highlighted = highlight;
    this.threshold = threshold;
    const active = new Map(words.map((word) => [word.word, word]));
    this.lookupCounts = new Map(words.map((word) => [word.word, word.lookupCount]));
    for (const [key, event] of this.episodes) if (active.get(event.word)?.lookupCount !== event.lookupCount) this.episodes.delete(key);
    for (const [key, count] of this.suppressed) if (active.get(key.split("\0")[0])?.lookupCount !== count) this.suppressed.delete(key);
    const signature = [...active.keys()].sort().join("\0");
    if (signature !== this.wordSignature) {
      this.wordSignature = signature;
      this.tokens = [];
      this.observer.disconnect();
      if (active.size) {
        const walker = this.doc.createTreeWalker(this.root, 4);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (node.parentElement?.closest("script,style,svg,[aria-hidden='true']")) continue;
          const text = node.textContent ?? "";
          wordPattern.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = wordPattern.exec(text))) {
            const word = active.get(match[0].toLowerCase().replace(/’/g, "'"));
            const paragraphId = this.paragraphId(node);
            if (!word || !paragraphId) continue;
            const range = this.doc.createRange();
            range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
            this.tokens.push({ word, range, paragraphId });
          }
        }
      }
      const relevant = new Set(this.tokens.map((token) => token.paragraphId));
      for (const { element, id } of this.paragraphs) if (relevant.has(id)) this.observer.observe(element);
    } else {
      for (const token of this.tokens) token.word = active.get(token.word.word)!;
    }
    for (const [key, event] of this.episodes) {
      const word = active.get(event.word);
      if (word?.lookupCount !== event.lookupCount || word.seenParagraphs.includes(event.paragraphId)) this.episodes.delete(key);
    }
    this.paint(); this.schedule();
  }
  private clipped(range: Range): DOMRect[] {
    return this.clipRects(Array.from(range.getClientRects()));
  }
  private clipRects(rects: readonly DOMRect[]): DOMRect[] {
    const host = this.host.getBoundingClientRect();
    const frame = this.win.frameElement?.getBoundingClientRect();
    const offsetX = frame?.left ?? 0; const offsetY = frame?.top ?? 0;
    const width = this.doc.documentElement.clientWidth || this.win.innerWidth;
    const height = this.win.innerHeight;
    return rects.map((rect) => {
      const left = Math.max(rect.left, 0, host.left - offsetX);
      const right = Math.min(rect.right, width, host.right - offsetX);
      const top = Math.max(rect.top, 0, host.top - offsetY);
      const bottom = Math.min(rect.bottom, height, host.bottom - offsetY);
      return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
    }).filter((rect) => rect.width > 0 && rect.height > 0);
  }
  private sample(): void {
    if (this.destroyed || !this.root.isConnected || !this.host.isConnected) return;
    if (this.win.frameElement && !this.win.frameElement.isConnected) return;
    // A sheet, background tab or hidden leaf pauses observation; it is not a miss.
    if (this.doc.hidden || this.host.ownerDocument.hidden || this.host.closest("[inert]") || this.host.getBoundingClientRect().width === 0) return;
    const visible = new Map<string, WordExposure>();
    for (const token of this.tokens) {
      const key = `${token.word.word}\0${token.paragraphId}`;
      if (!token.word.seenParagraphs.includes(token.paragraphId) && !this.suppressed.has(key) && this.clipped(token.range).length) {
        visible.set(key, { word: token.word.word, paragraphId: token.paragraphId, lookupCount: token.word.lookupCount });
      }
    }
    const left: WordExposure[] = [];
    for (const [key, event] of this.episodes) if (!visible.has(key)) {
      // A long paragraph may continue after its word has scrolled off-screen.
      // Settle only after leaving the paragraph, or an explicit page turn.
      const paragraphVisible = this.paragraphs.some(({ id, element }) => id === event.paragraphId && this.clipRects(Array.from(element.getClientRects())).length > 0);
      if (paragraphVisible) visible.set(key, event);
      else { this.episodes.delete(key); left.push(event); }
    }
    for (const [key, event] of visible) this.episodes.set(key, event);
    if (left.length) this.onExposure(left);
    if (this.overlay) this.paint();
  }
  refresh(): void { this.schedule(); }
  noteLookup(word: string, paragraphId?: string): void {
    if (!paragraphId) return;
    const normalized = word.toLowerCase().replace(/’/g, "'");
    const key = `${normalized}\0${paragraphId}`;
    this.episodes.delete(key); this.suppressed.set(key, this.lookupCounts.get(normalized) ?? 0);
  }
  flush(): void {
    const events = [...this.episodes.values()]; this.episodes.clear();
    if (events.length) this.onExposure(events);
  }
  private paint(): void {
    const registry = this.win.CSS?.highlights;
    for (const name of this.names) registry?.delete(name);
    this.overlay?.remove(); this.overlay = null;
    if (!this.highlighted || !this.tokens.length) return;
    const groups = opacity.map(() => [] as Range[]);
    const level = (word: VocabularyWord): number => Math.min(4, Math.floor(word.noLookupCount * 4 / Math.max(1, this.threshold - 1)));
    for (const token of this.tokens) groups[level(token.word)].push(token.range);
    if (registry && this.win.Highlight) {
      groups.forEach((ranges, index) => { if (ranges.length) registry.set(this.names[index], new this.win.Highlight!(...ranges)); });
      return;
    }
    const overlay = this.doc.createElement("div");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:1";
    for (const token of this.tokens) for (const rect of this.clipped(token.range)) {
      const mark = this.doc.createElement("div");
      mark.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:rgba(70,155,235,${opacity[level(token.word)]});border-radius:2px`;
      overlay.appendChild(mark);
    }
    this.doc.body.appendChild(overlay); this.overlay = overlay;
  }
  destroy(): void {
    this.destroyed = true;
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    this.observer.disconnect(); this.resize.disconnect();
    this.doc.removeEventListener("scroll", this.schedule, true); this.host.removeEventListener("scroll", this.schedule, true);
    this.doc.removeEventListener("visibilitychange", this.schedule); this.host.ownerDocument.removeEventListener("visibilitychange", this.schedule);
    for (const name of this.names) this.win.CSS?.highlights?.delete(name);
    this.style.remove(); this.overlay?.remove(); this.episodes.clear(); this.suppressed.clear(); this.lookupCounts.clear();
  }
}
