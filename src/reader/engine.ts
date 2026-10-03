// Reader engine contract shared by the EPUB and PDF implementations.

import type {
  AnnotationRecord,
  BookFormat,
  ChapterState,
  PdfItemRange,
  ReadMode,
  ReadingLayout,
  ReadingColors,
} from "../types";

export interface EngineLocation {
  chapterId: string | null;
  percent: number; // 0..1 of the whole book
  cfi?: string | null;
  pdfPage?: number | null;
  pageFraction?: number | null; // scroll position inside the page
}

/** A transient anchor in the host window's viewport, never persisted. */
export interface SelectionAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface EngineSelection {
  text: string;
  /** Raw browser selection for copying; PDF annotation quotes stay page-scoped. */
  copyText?: string;
  chapterId?: string;
  cfi?: string; // epub
  pdfPage?: number; // pdf
  itemRanges?: PdfItemRange[]; // pdf
  sortKey?: number;
  anchor?: SelectionAnchor;
}

export interface EngineHooks {
  onLocation(loc: EngineLocation): void;
  onSelect(sel: EngineSelection): void;
  onAnnotationClick(id: string, anchor?: SelectionAnchor): void;
  /** Tap in the central zone of the reading surface (toggle chrome). */
  onZoneTap(): void;
  /** Reading surface was clicked outside central zone / annotations. */
  onSurfaceClick(): void;
  /** Background rendering failures, never a fabricated successful blank page. */
  onError?(error: Error): void;
}

export interface ReaderEngine {
  readonly format: BookFormat;
  readonly reflowable: boolean;
  mount(container: HTMLElement): Promise<void>;
  destroy(): void;
  goToChapter(chapterId: string, targetHref?: string): Promise<void>;
  goToAnnotation(annotation: AnnotationRecord): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  getMode(): ReadMode;
  setMode(mode: ReadMode): Promise<void>;
  applyLayout(layout: ReadingLayout, theme: ReadingColors): Promise<void>;
  addHighlight(a: AnnotationRecord): void;
  removeHighlight(a: AnnotationRecord): void;
  clearSelection(): void;
  getSelectionContext(sel: EngineSelection): Promise<{ before: string; after: string }>;
  resize(): void;
  updateChapters?(chapters: ChapterState[]): void;
}
