// Reader engine contract shared by the EPUB and PDF implementations.

import type {
  AnnotationRecord,
  BookFormat,
  ChapterState,
  PdfItemRange,
  ReadMode,
  ReadingLayout,
} from "../types";

export interface EngineLocation {
  chapterId: string | null;
  percent: number; // 0..1 of the whole book
  cfi?: string | null;
  pdfPage?: number | null;
  pageFraction?: number | null; // scroll position inside the page
}

export interface EngineSelection {
  text: string;
  chapterId?: string;
  cfi?: string; // epub
  pdfPage?: number; // pdf
  itemRanges?: PdfItemRange[]; // pdf
  sortKey?: number;
}

export interface EngineHooks {
  onLocation(loc: EngineLocation): void;
  onSelect(sel: EngineSelection): void;
  onAnnotationClick(id: string): void;
  /** Tap in the central zone of the reading surface (toggle chrome). */
  onZoneTap(): void;
  /** Reading surface was clicked outside central zone / annotations. */
  onSurfaceClick(): void;
  /** Background rendering failures, never a fabricated successful blank page. */
  onError?(error: Error): void;
}

export interface ReaderEngine {
  readonly format: BookFormat;
  mount(container: HTMLElement): Promise<void>;
  destroy(): void;
  goToChapter(chapterId: string, targetHref?: string): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  getMode(): ReadMode;
  setMode(mode: ReadMode): Promise<void>;
  applyLayout(layout: ReadingLayout, theme: "light" | "dark"): Promise<void>;
  addHighlight(a: AnnotationRecord): void;
  removeHighlight(a: AnnotationRecord): void;
  getSelectionContext(sel: EngineSelection): Promise<{ before: string; after: string }>;
  resize(): void;
  updateChapters?(chapters: ChapterState[]): void;
}
