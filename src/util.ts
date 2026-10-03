// Small shared utilities with actual logic (formatting, ids, DOM helpers).
import { translate, type AppLanguage } from "./i18n";

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function relTime(iso: string | undefined | null, language: AppLanguage = "zh-CN"): string {
  if (!iso) return translate(language, "未读");
  const t = new Date(iso).getTime();
  if (isNaN(t)) return translate(language, "未读");
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - t) / 3600000);
    if (hours <= 0) return translate(language, "刚刚");
    return translate(language, "{0} 小时前", hours);
  }
  if (days === 1) return translate(language, "昨天");
  if (days < 30) return translate(language, "{0} 天前", days);
  const months = Math.floor(days / 30);
  if (months < 12) return translate(language, "{0} 个月前", months);
  return translate(language, "{0} 年前", Math.floor(months / 12));
}

let idCounter = 0;
export function genId(prefix: string): string {
  idCounter = (idCounter + 1) % 0xffff;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "";
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "……";
}

// Strip code fences and extract the first balanced JSON object from an LLM reply.
export function extractJson(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  if (start < 0) throw new Error("AI 返回中没有 JSON 对象");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(s.slice(start, i + 1));
      }
    }
  }
  throw new Error("AI 返回的 JSON 不完整");
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
