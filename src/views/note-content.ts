import type { AnswerRecord, ChapterState, Feedback, ReviewRecord } from "../types";
import { QUESTION_LABELS } from "../types";
import { chapterNotes, feedbackSections } from "../core/chapter-notes";
import type { ChapterNote } from "../core/chapter-notes";
import type { QReaderPlugin } from "../main";
import { el, fmtDateTime } from "../util";

export function feedbackBlock(plugin: QReaderPlugin, feedback: Feedback): HTMLElement {
  const box = el("div", "qr-feedback");
  box.appendChild(el("div", "qr-question-type", plugin.t("AI 参考评价")));
  for (const section of feedbackSections(feedback)) {
    if (!section.content) continue;
    const row = el("div", "qr-feedback-section");
    row.append(el("div", "qr-feedback-title", plugin.t(section.title)), el("div", "qr-feedback-text", section.content));
    box.appendChild(row);
  }
  box.appendChild(el("div", "qr-muted qr-tiny qr-feedback-motto", plugin.t("AI 评价只供参考，不是标准答案。理解作者不等于认同作者。")));
  return box;
}

export function noteBlock(plugin: QReaderPlugin, item: ChapterNote, chapter: ChapterState): HTMLElement {
  const box = el("div", "qr-compare");
  box.appendChild(el("div", "qr-muted qr-tiny", plugin.t("{0} · 问题版本 {1}", fmtDateTime(item.at), item.version)));
  const version = chapter.questionVersions.find(version => version.version === item.version);
  if (!version) {
    box.appendChild(el("div", "qr-inline-error", plugin.t("该次问题版本不可用；以下保留原回答及问题编号。")));
    for (const [id, answer] of Object.entries(item.answers)) box.append(el("div", "qr-muted qr-tiny", id), el("div", "qr-compare-text", answer));
  } else for (const question of version.questions) {
    const row = el("div", "qr-compare-item");
    row.append(el("div", "qr-muted qr-tiny", plugin.t(QUESTION_LABELS[question.type])), el("div", "qr-compare-question", question.text), el("div", "qr-compare-text", item.answers[question.id] || plugin.t("（未记录，可略过）")));
    box.appendChild(row);
  }
  return box;
}

export function renderNoteHistory(plugin: QReaderPlugin, chapter: ChapterState, exclude?: AnswerRecord | ReviewRecord): HTMLElement {
  const section = el("section", "qr-history");
  const notes = chapterNotes(chapter).filter(note => note.record !== exclude);
  if (!notes.length) return section;
  section.appendChild(el("h2", "qr-question-type", plugin.t("历次阅读想法")));
  for (const [index, item] of notes.reverse().entries()) {
    const details = el("details", "qr-history-item");
    details.open = index === 0;
    details.appendChild(el("summary", "qr-history-row", plugin.t("{0} · {1} · 问题版本 {2}", item.legacyReview ? plugin.t("历史复习记录") : plugin.t("我的阅读想法"), fmtDateTime(item.at), item.version)));
    details.appendChild(noteBlock(plugin, item, chapter));
    if (item.record.feedback) details.appendChild(feedbackBlock(plugin, item.record.feedback));
    section.appendChild(details);
  }
  return section;
}
