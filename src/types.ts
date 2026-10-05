// QReader shared types. Mirrors reading.json (PRD §27) and runtime objects.

export type BookFormat = "epub" | "pdf" | "fb2" | "mobi" | "azw3" | "cbz";
export type QuestionType = "core" | "logic" | "retell";
export type ReadMode = "paginated" | "scrolled";
export type ReadingTheme = "auto" | "light" | "sepia" | "sage" | "dark";
export type ReadingFont = "original" | "sans" | "serif";
export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple";
export type BookReadStatus = "unread" | "read";

export interface Question {
  id: string; // q1 | q2 | q3
  type: QuestionType;
  text: string;
}

export interface QuestionVersion {
  version: number;
  createdAt: string;
  questions: Question[]; // exactly 3, ordered core/logic/retell
}

export type Feedback = {
  kind: "reference";
  comment: string;
  perspectives?: string;
  evidenceNotes?: string;
} | {
  kind?: undefined; // Preserve feedback from earlier releases unchanged.
  authorView: string;
  rethink?: string; // empty => omit section
  factualErrors?: string; // empty => omit section
};

export interface AnswerRecord {
  questionVersion: number;
  answers: Record<string, string>; // qid -> text
  feedback?: Feedback;
  answeredAt: string; // ISO
}

export interface ReviewRecord {
  scheduledFor?: string; // YYYY-MM-DD; pending review when set and not completedAt
  questionVersion?: number;
  answers?: Record<string, string>;
  completedAt?: string; // ISO
  feedback?: Feedback;
}

export interface PdfItemRange {
  item: number; // index into page text items
  start: number; // char offset within item.str
  end: number; // exclusive
  rects?: { x: number; y: number; width: number; height: number }[];
}

export interface NoteRevision {
  id: string;
  at: string;
  note: string;
  aiExplanation?: string;
  baseline?: boolean; // Existing text, not a reconstruction of earlier drafts.
}

export interface BookNote {
  id: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
  history: NoteRevision[];
}

export interface AnnotationRecord {
  id: string;
  chapterId: string;
  createdAt: string; // ISO
  kind?: "highlight" | "annotation"; // Missing on V1 records means annotation.
  color?: HighlightColor; // Missing on existing records means yellow.
  updatedAt?: string;
  history?: NoteRevision[];
  text: string; // quoted original text
  note?: string; // 我的理解 (may be empty)
  aiExplanation?: string; // included AI explanation (may be empty)
  // CFI locator — EPUB and memory-converted FB2/MOBI/AZW3/CBZ.
  cfi?: string;
  // locator — PDF
  pdfPage?: number;
  itemRanges?: PdfItemRange[];
  sortKey: number; // reading order within the book
}

export interface ChapterState {
  title: string;
  index: number; // reading order (0-based)
  // EPUB spine, including memory-converted formats.
  spineIndex?: number;
  href?: string;
  hrefEnd?: string; // exclusive next TOC boundary in the EPUB spine
  // PDF
  pdfStartPage?: number; // 1-based
  pdfEndPage?: number;
  custom?: boolean; // user-created PDF chapter
  reviewExcluded?: boolean; // Auxiliary book sections remain readable, not reviewable.
  questionVersions: QuestionVersion[];
  answers: AnswerRecord[];
  reviews: ReviewRecord[];
}

export interface ReadingProgress {
  chapterId: string | null;
  percent: number; // 0..1 whole-book
  cfi?: string | null;
  pdfPage?: number | null;
  pdfPageFraction?: number | null;
  lastReadAt: string; // ISO
}

export interface ReadingFile {
  version: 1;
  book: {
    title: string;
    author: string;
    format: BookFormat;
    fileName: string; // 原书在阅读库中的安全文件名；保留原始字节。
    spineLength?: number; // EPUB and memory-converted formats
    numPages?: number; // pdf
    readStatus?: BookReadStatus;
    category?: string;
  };
  progress: ReadingProgress;
  chapters: Record<string, ChapterState>;
  annotations: AnnotationRecord[];
  bookNotes?: BookNote[];
  importedAt: string;
}

interface BookEntryBase {
  id: string;
  dir: string;
  store: JsonStoreRef;
}

export interface HealthyBookEntry extends BookEntryBase {
  reading: ReadingFile;
  damaged?: false;
}

export interface DamagedBookEntry extends BookEntryBase {
  reading: ReadingFile | null;
  damaged: true;
}

export type BookEntry = HealthyBookEntry | DamagedBookEntry;

export function isHealthyBook(entry: BookEntry): entry is HealthyBookEntry {
  return !entry.damaged && entry.reading !== null;
}

export function getBookReadStatus(reading: ReadingFile): BookReadStatus {
  return reading.book.readStatus ?? (reading.progress.percent >= 1 ? "read" : "unread");
}

// Minimal persistence contract shared with views.
export interface JsonStoreRef {
  readonly damaged?: boolean;
  mutate(
    fn: (v: ReadingFile) => void | Promise<void>,
    afterCommit?: (v: ReadingFile) => Promise<void>
  ): Promise<void>;
  reset(fresh: ReadingFile): Promise<void>;
  restoreRecovery(): Promise<void>;
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ReadingLayout {
  fontSize: number; // px
  lineHeight: number;
  pageMargin: number; // px
  fontFamily: ReadingFont;
  paragraphIndent: boolean;
}

export interface ReadingColors {
  background: string;
  foreground: string;
  muted: string;
  dark: boolean;
}

export interface TocNode {
  title: string;
  chapterId?: string; // resolvable to a chapter
  href?: string;
  page?: number;
  children?: TocNode[];
}

export const QUESTION_LABELS = {
  core: "核心问题",
  logic: "逻辑问题",
  retell: "复述问题",
} as const satisfies Record<QuestionType, string>;

export function chaptersOrdered(reading: ReadingFile): ChapterState[] {
  return Object.values(reading.chapters).sort((a, b) => a.index - b.index);
}

export function epubChapterId(spineIndex: number, ordinal = 0): string {
  return ordinal === 0 ? `ch-${spineIndex}` : `ch-${spineIndex}-${ordinal}`;
}

export function pdfChapterId(startPage: number): string {
  return `ch-p${startPage}`;
}

export function chapterPageCount(ch: ChapterState): number {
  if (ch.pdfStartPage && ch.pdfEndPage) return ch.pdfEndPage - ch.pdfStartPage + 1;
  return 0;
}
