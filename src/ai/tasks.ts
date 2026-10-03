// The three AI touchpoints (PRD §2.1): chapter questions, annotation
// explanation, answer feedback. Prompt rules come from PRD §4 / §12 / §17.

import type { AiConfig, Feedback, Question } from "../types";
import { extractJson } from "../util";
import { chatCompletion } from "./client";


// ---------------------------------------------------------------- questions

const QUESTION_SYSTEM = `你是一位严谨的读书助手，任务是为一本书的某一章生成"每章三问"，帮助读者带着问题阅读并检验自己的理解。

必须输出恰好 3 个问题，分别对应三种类型：
- core（核心问题）：这一章作者最想回答的问题是什么？他的主要观点是什么？
- logic（逻辑问题）：作者为什么得出这个结论？中间最重要的原因、证据或转折是什么？
- retell（复述问题）：如果合上书，读者怎样用自己的话讲清楚这一章？

出题规则（必须全部满足）：
1. 不以年份、人名等细节记忆题为主。
2. 不把答案直接包含在问题中。
3. 三个问题不能表达同一件事，必须覆盖章节主线。
4. 必须能够从本章内容中找到依据。
5. 优先询问"为什么""如何"，避免空泛的"你有什么感想"。
6. 不强迫读者联系生活实际。
7. 复述题应适合读者用一段自己的话回答。
8. 问题用简体中文书写，即使原书是其他语言。

只输出 JSON，不要输出任何其他文字，格式：
{"questions":[{"type":"core","text":"……"},{"type":"logic","text":"……"},{"type":"retell","text":"……"}]}`;

export async function generateQuestions(
  cfg: AiConfig,
  bookTitle: string,
  chapterTitle: string,
  chapterText: string
): Promise<Question[]> {
  const reply = await chatCompletion(
    cfg,
    [
      { role: "system", content: QUESTION_SYSTEM },
      {
        role: "user",
        content: `书名：${bookTitle}\n章节：${chapterTitle}\n\n章节内容：\n${chapterText.trim()}`,
      },
    ],
    { temperature: 0.6, maxTokens: 1600 }
  );
  return parseQuestions(reply);
}

export function parseQuestions(raw: string): Question[] {
  const parsed = extractJson(raw);
  if (typeof parsed !== "object" || parsed === null || !("questions" in parsed) || !Array.isArray(parsed.questions) || parsed.questions.length !== 3) throw new Error("AI 必须返回恰好三个问题");
  const questions: unknown[] = parsed.questions;
  const types = ["core", "logic", "retell"] as const;
  const out: Question[] = [];
  for (const [index, type] of types.entries()) {
    const matches = questions.filter((question) => typeof question === "object" && question !== null && "type" in question && question.type === type);
    if (matches.length !== 1) throw new Error(`AI 未返回唯一的 ${type} 问题`);
    const question: unknown = matches[0];
    if (typeof question !== "object" || question === null || !("text" in question) || typeof question.text !== "string" || !question.text.trim()) throw new Error(`AI 返回的 ${type} 问题为空`);
    out.push({ id: `q${index + 1}`, type, text: question.text.trim() });
  }
  if (new Set(out.map((question) => question.text.replace(/[\s，。？！、,.?!:：;；“”"'‘’]/g, ""))).size !== 3) throw new Error("AI 返回的三个问题重复");
  return out;
}

// ------------------------------------------------------------- explanation

const EXPLAIN_SYSTEM = `你是一位耐心的读书助手。读者在读书时选中了一段读不太懂的内容，请你解释它。

要求：
- 结合给定的上下文解释这段内容：讲清关键概念、背景，以及作者在这段话里想表达什么。
- 用简体中文，150–300 字，平实、具体，不用列表。
- 只解释，不评价读者的水平，不给阅读建议，不反问。
- 只输出解释正文，不要任何前缀、标题或格式。`;

export async function explainSelection(
  cfg: AiConfig,
  bookTitle: string,
  chapterTitle: string,
  selected: string,
  context: { before: string; after: string }
): Promise<string> {
  const reply = await chatCompletion(
    cfg,
    [
      { role: "system", content: EXPLAIN_SYSTEM },
      {
        role: "user",
        content: `书名：${bookTitle}\n章节：${chapterTitle}\n\n选中内容：\n${selected}\n\n选中内容之前的部分：\n${context.before || "（无）"}\n\n选中内容之后的部分：\n${context.after || "（无）"}`,
      },
    ],
    { temperature: 0.4, maxTokens: 800 }
  );
  const text = reply.trim();
  if (!text) throw new Error("AI 解释为空");
  return text;
}

// ---------------------------------------------------------------- feedback

const FEEDBACK_SYSTEM = `你是一位严谨的读书助手。读者刚读完一章并合上书回答了三个问题，现在你要给出极简反馈。

只输出三个部分，全部用简体中文：
1. authorView —— 客观概述：作者在本章主要表达了什么（2–4 句）。
2. rethink —— 只有确实存在明显遗漏、不同理解角度或值得继续思考的地方时才写（2–3 句），否则输出空字符串 ""。
3. factualErrors —— 仅当读者陈述中存在明确可验证的事实错误（人物、时间、事件、数据、概念定义）时指出，否则输出空字符串 ""。

严格禁止：
- 给分、给正确率、评级。
- 判断读者"理解错误"或评价读者观点对错。
- 输出复杂分析报告或额外板块。
- 强制要求读者认同作者。

牢记：理解作者，不等于认同作者。读者的观点可以与作者不同。

只输出 JSON：{"authorView":"……","rethink":"","factualErrors":""}`;

export async function generateFeedback(
  cfg: AiConfig,
  bookTitle: string,
  chapterTitle: string,
  chapterText: string,
  questions: Question[],
  answers: Record<string, string>
): Promise<Feedback> {
  const qa = questions
    .map((q, i) => `问题${i + 1}（${q.type}）：${q.text}\n读者回答：${answers[q.id]?.trim() || "（未作答）"}`)
    .join("\n\n");
  const reply = await chatCompletion(
    cfg,
    [
      { role: "system", content: FEEDBACK_SYSTEM },
      {
        role: "user",
        content: `书名：${bookTitle}\n章节：${chapterTitle}\n\n${qa}\n\n本章原文（供你核对作者观点与事实）：\n${chapterText.trim()}`,
      },
    ],
    { temperature: 0.4, maxTokens: 1400 }
  );
  return parseFeedback(reply);
}

export function parseFeedback(raw: string): Feedback {
  const parsed = extractJson(raw);
  if (typeof parsed !== "object" || parsed === null || !("authorView" in parsed)) throw new Error("AI 反馈格式无效");
  for (const [key, value] of Object.entries(parsed)) {
    if (key !== "authorView" && key !== "rethink" && key !== "factualErrors") throw new Error("AI 反馈包含不支持的额外字段");
    if (typeof value !== "string") throw new Error(`AI 反馈 ${key} 必须是文本`);
  }
  const authorView = typeof parsed.authorView === "string" ? parsed.authorView.trim() : "";
  if (!authorView) throw new Error("AI 反馈缺少 authorView");
  const clean = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  };
  return {
    authorView,
    rethink: "rethink" in parsed ? clean(parsed.rethink) : undefined,
    factualErrors: "factualErrors" in parsed ? clean(parsed.factualErrors) : undefined,
  };
}
