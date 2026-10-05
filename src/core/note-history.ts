import type { AnnotationRecord, HealthyBookEntry, NoteRevision } from "../types";
import { genId } from "../util";

export interface TraceRef { bookId: string; kind: "annotation" | "bookNote"; id: string; revisionId: string }
export interface TraceSource {
  ref: TraceRef; key: string; bookTitle: string; chapterTitle: string;
  quote: string; note: string; aiExplanation?: string; at: string; baseline: boolean;
}
export const traceKey = (ref: TraceRef): string => JSON.stringify([ref.bookId, ref.kind, ref.id, ref.revisionId]);

export function revision(note: string, aiExplanation?: string): NoteRevision {
  return { id: genId("revision"), at: new Date().toISOString(), note, aiExplanation };
}
export function annotationRevisions(record: AnnotationRecord): NoteRevision[] {
  return record.history ?? [{ id: "legacy", at: record.updatedAt ?? record.createdAt, note: record.note ?? "", aiExplanation: record.aiExplanation, baseline: true }];
}
export function appendAnnotationRevision(record: AnnotationRecord, before: AnnotationRecord): void {
  if ((record.note ?? "") === (before.note ?? "") && (record.aiExplanation ?? "") === (before.aiExplanation ?? "")) return;
  record.history ??= annotationRevisions(before);
  record.history.push(revision(record.note ?? "", record.aiExplanation));
}

export function traceSources(entries: HealthyBookEntry[], currentOnly = false): TraceSource[] {
  const result: TraceSource[] = [];
  for (const entry of entries) {
    const bookTitle = entry.reading.book.title;
    for (const record of entry.reading.annotations) {
      const revisions = annotationRevisions(record);
      for (const r of currentOnly ? revisions.slice(-1) : revisions) {
        const ref: TraceRef = { bookId: entry.id, kind: "annotation", id: record.id, revisionId: r.id };
        result.push({ ref, key: traceKey(ref), bookTitle, chapterTitle: entry.reading.chapters[record.chapterId]?.title ?? "", quote: record.text,
          note: r.note, aiExplanation: r.aiExplanation, at: r.at, baseline: !!r.baseline });
      }
    }
    for (const record of entry.reading.bookNotes ?? []) {
      for (const r of currentOnly ? record.history.slice(-1) : record.history) {
        const ref: TraceRef = { bookId: entry.id, kind: "bookNote", id: record.id, revisionId: r.id };
        result.push({ ref, key: traceKey(ref), bookTitle, chapterTitle: "", quote: "", note: r.note, at: r.at, baseline: !!r.baseline });
      }
    }
  }
  return result;
}

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("思考线数据格式无效");
  return raw as Record<string, unknown>;
}
function text(value: unknown, max = 100000): asserts value is string {
  if (typeof value !== "string" || value.length > max) throw new Error("思考线文字格式无效");
}
export function validateRef(raw: unknown): TraceRef {
  const ref = object(raw);
  for (const key of ["bookId", "id", "revisionId"] as const) { text(ref[key], 1000); if (!ref[key]) throw new Error("思考线来源编号无效"); }
  if (ref.kind !== "annotation" && ref.kind !== "bookNote") throw new Error("思考线来源类型无效");
  return raw as TraceRef;
}
export function sourceUrl(ref: TraceRef, vault?: string): string {
  const params = new URLSearchParams({ book: ref.bookId, kind: ref.kind, note: ref.id, revision: ref.revisionId });
  if (vault) params.set("vault", vault);
  // Obsidian protocol parameters do not decode form-style '+' as a space.
  return "obsidian://qreader?" + params.toString().replace(/\+/g, "%20");
}

export const noteAnchor = (id: string, revisionId: string): string => `qreader-note-${encodeURIComponent(id)}-${encodeURIComponent(revisionId)}`;
