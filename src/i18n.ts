import { EN } from "./locales/en";
import { ERROR_EN } from "./locales/errors-en";

export type AppLanguage = "zh-CN" | "en";
const MESSAGES = { ...EN, ...ERROR_EN };
export type MessageKey = keyof typeof MESSAGES;
type MessageValue = string | number;

export function normalizeLanguage(value: unknown): AppLanguage {
  return value === "en" ? "en" : "zh-CN";
}

function format(message: string, values: readonly MessageValue[]): string {
  return message.replace(/\{(\d+)\}/g, (token, index: string) => values[Number(index)] === undefined ? token : String(values[Number(index)]));
}

export function translate(language: AppLanguage, key: MessageKey, ...values: MessageValue[]): string {
  return format(language === "en" ? MESSAGES[key] : key, values);
}

function pattern(template: string): { regex: RegExp; indices: number[] } {
  const indices: number[] = [];
  let expression = "^";
  let start = 0;
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const match of template.matchAll(/\{(\d+)\}/g)) {
    expression += escape(template.slice(start, match.index)) + "(.*?)";
    indices.push(Number(match[1]));
    start = (match.index ?? 0) + match[0].length;
  }
  return { regex: new RegExp(expression + escape(template.slice(start)) + "$", "su"), indices };
}

const knownMessages = Object.entries(MESSAGES)
  .sort(([left], [right]) => right.replace(/\{\d+\}/g, "").length - left.replace(/\{\d+\}/g, "").length)
  .map(([zh, en]) => ({ zh, en, zhPattern: pattern(zh), enPattern: pattern(en) }));
const knownErrors = knownMessages.filter(({ zh }) => Object.prototype.hasOwnProperty.call(ERROR_EN, zh));

/** Only for QReader-owned statuses/errors, never book passages, answers or notes. */
export function localizeMessage(language: AppLanguage, text: string, errorsOnly = false, depth = 0): string {
  for (const message of errorsOnly ? knownErrors : knownMessages) {
    for (const candidate of [message.zhPattern, message.enPattern]) {
      const match = candidate.regex.exec(text);
      if (!match) continue;
      const values: string[] = [];
      candidate.indices.forEach((index, position) => {
        const value = match[position + 1];
        values[index] = depth < 3 ? localizeMessage(language, value, true, depth + 1) : value;
      });
      return format(language === "en" ? message.en : message.zh, values);
    }
  }
  return text;
}

export function localizedError(language: AppLanguage, error: unknown): string {
  return localizeMessage(language, error instanceof Error ? error.message : String(error));
}
