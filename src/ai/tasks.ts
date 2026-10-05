import type { AiConfig } from "../types";
import { chatCompletion } from "./client";
import type { AppLanguage } from "../i18n";

const EXPLAIN_SYSTEM = `你是一位耐心的读书助手。读者在读书时选中了一段读不太懂的内容，请你解释它。

要求：
- 结合给定的上下文解释这段内容：讲清关键概念、背景，以及作者在这段话里想表达什么。
- 用简体中文，150–300 字，平实、具体，不用列表。
- 只解释，不评价读者的水平，不给阅读建议，不反问。
- 只输出解释正文，不要任何前缀、标题或格式。`;

const EXPLAIN_SYSTEM_EN = `You are a patient reading assistant. Explain a passage the reader finds difficult.

Requirements:
- Use the supplied context to explain key concepts, background and the author's intended meaning.
- Write in English, in 80–160 words, using plain, concrete prose without lists.
- Explain only. Do not judge the reader, offer reading advice or ask questions.
- Output only the explanation, with no prefix, heading or formatting.`;

export async function explainSelection(
  cfg: AiConfig,
  bookTitle: string,
  chapterTitle: string,
  selected: string,
  context: { before: string; after: string },
  language: AppLanguage = "zh-CN"
): Promise<string> {
  const reply = await chatCompletion(
    cfg,
    [
      { role: "system", content: language === "en" ? EXPLAIN_SYSTEM_EN : EXPLAIN_SYSTEM },
      {
        role: "user",
        content: language === "en"
          ? `Book: ${bookTitle}\nChapter: ${chapterTitle}\n\nSelected passage:\n${selected}\n\nBefore the passage:\n${context.before || "(None)"}\n\nAfter the passage:\n${context.after || "(None)"}`
          : `书名：${bookTitle}\n章节：${chapterTitle}\n\n选中内容：\n${selected}\n\n选中内容之前的部分：\n${context.before || "（无）"}\n\n选中内容之后的部分：\n${context.after || "（无）"}`,
      },
    ],
    { temperature: 0.4, maxTokens: 800 }
  );
  const text = reply.trim();
  if (!text) throw new Error("AI 解释为空");
  return text;
}
