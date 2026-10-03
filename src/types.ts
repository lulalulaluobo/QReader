// QReader shared types. Mirrors reading.json (PRD §27) and runtime objects.

export type BookFormat = "epub" | "pdf";
export type QuestionType = "core" | "logic" | "retell";
export type ReadMode = "paginated" | "scrolled";
export type ReadingTheme = "auto" | "light" | "dark";

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

export interface Feedback {
  authorView: string;
  rethink?: string; // empty => omit section
  factualErrors?: string; // empty => omit section
}

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

export interface AnnotationRecord {
  id: string;
  chapterId: string;
  createdAt: string; // ISO
  updatedAt?: string;
  text: string; // quoted original text
  note?: string; // 我的理解 (may be empty)
  aiExplanation?: string; // included AI explanation (may be empty)
  // locator — EPUB
  cfi?: string;
  // locator — PDF
  pdfPage?: number;
  itemRanges?: PdfItemRange[];
  sortKey: number; // reading order within the book
}

export interface ChapterState {
  title: string;
  index: number; // reading order (0-based)
  // EPUB
  spineIndex?: number;
  href?: string;
  hrefEnd?: string; // exclusive next EPUB TOC boundary
  // PDF
  pdfStartPage?: number; // 1-based
  pdfEndPage?: number;
  custom?: boolean; // user-created PDF chapter
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
    fileName: string; // original file name inside the book folder
    spineLength?: number; // epub
    numPages?: number; // pdf
  };
  progress: ReadingProgress;
  chapters: Record<string, ChapterState>;
  annotations: AnnotationRecord[];
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
}

export interface TocNode {
  title: string;
  chapterId?: string; // resolvable to a chapter
  href?: string;
  page?: number;
  children?: TocNode[];
}

export const QUESTION_LABELS: Record<QuestionType, string> = {
  core: "核心问题",
  logic: "逻辑问题",
  retell: "复述问题",
};

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
