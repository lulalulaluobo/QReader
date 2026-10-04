import type { AnswerRecord, ChapterState, Feedback, ReviewRecord } from "../types";
import type { MessageKey } from "../i18n";

export interface ChapterNote {
  record: AnswerRecord | ReviewRecord;
  legacyReview: boolean;
  at: string;
  answers: Record<string, string>;
  version: number;
}

/** Completed legacy reviews remain readable; appointments never become tasks. */
export function chapterNotes(chapter: ChapterState): ChapterNote[] {
  const notes: ChapterNote[] = chapter.answers.map(record => ({ record, legacyReview: false, at: record.answeredAt, answers: record.answers, version: record.questionVersion }));
  for (const record of chapter.reviews) {
    if (record.completedAt && record.answers) notes.push({ record, legacyReview: true, at: record.completedAt, answers: record.answers, version: record.questionVersion ?? 0 });
  }
  return notes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function feedbackSections(feedback: Feedback): { title: MessageKey; content: string | undefined }[] {
  return feedback.kind === "reference" ? [
    { title: "参考评价", content: feedback.comment },
    { title: "其他理解角度", content: feedback.perspectives },
    { title: "原文核对提醒", content: feedback.evidenceNotes },
  ] : [
    { title: "旧版 AI 参考意见", content: feedback.authorView },
    { title: "值得再想想", content: feedback.rethink },
    { title: "原文核对提醒", content: feedback.factualErrors },
  ];
}
