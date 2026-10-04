import { requestUrl } from "obsidian";

export interface TranslationSettings {
  autoAdd: boolean;
  highlight: boolean;
  deletionThreshold: number;
}
export interface TranslationResult {
  query: string;
  translation: string;
  phonetic: string;
  audioUrl: string;
}
export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  autoAdd: true, highlight: true, deletionThreshold: 5,
};
export function loadTranslationSettings(raw: unknown): TranslationSettings {
  const value = object(raw) ? raw : {};
  return {
    autoAdd: value.autoAdd !== false,
    highlight: value.highlight !== false,
    deletionThreshold: typeof value.deletionThreshold === "number" && Number.isInteger(value.deletionThreshold)
      ? Math.max(1, Math.min(100, value.deletionThreshold)) : 5,
  };
}
export function singleWord(text: string): string | null {
  const cleaned = text.trim();
  return /^[a-z]+(?:['’-][a-z]+)*$/i.test(cleaned) && cleaned.length <= 64
    ? cleaned.toLowerCase().replace(/’/g, "'") : null;
}
export function safeAudioUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && (url.hostname === "youdao.com" || url.hostname.endsWith(".youdao.com")) ? url.href : "";
  } catch { return ""; }
}
function object(raw: unknown): raw is Record<string, unknown> { return typeof raw === "object" && raw !== null && !Array.isArray(raw); }
function firstWord(section: unknown): Record<string, unknown> {
  return object(section) && Array.isArray(section.word) && object(section.word[0]) ? section.word[0] : {};
}
export function parseTranslation(raw: unknown, query: string): TranslationResult {
  if (!object(raw)) throw new Error("有道返回的数据无效");
  const ec = firstWord(raw.ec);
  const simple = firstWord(raw.simple);
  const definitions: string[] = [];
  if (Array.isArray(ec.trs)) {
    for (const entry of ec.trs) {
      if (!object(entry) || !Array.isArray(entry.tr)) continue;
      for (const tr of entry.tr) {
        if (!object(tr) || !object(tr.l) || !Array.isArray(tr.l.i)) continue;
        for (const value of tr.l.i) if (typeof value === "string" && value.trim()) definitions.push(value.trim());
      }
    }
  }
  if (!definitions.length && object(raw.web_trans)) {
    // The public dictionary uses a hyphen; tolerate the older underscored shape.
    const entries = raw.web_trans["web-translation"] ?? raw.web_trans.web_translation;
    const entry: unknown = Array.isArray(entries) ? entries[0] : undefined;
    if (object(entry) && Array.isArray(entry.trans)) {
      for (const item of entry.trans) if (object(item) && typeof item.value === "string" && item.value.trim()) definitions.push(item.value.trim());
    }
  }
  const translation = [...new Set(definitions)].join("\n").replace(/\\n/g, "\n");
  if (!translation) throw new Error("有道没有找到这个单词的释义");
  const phonetic = [simple.usphone, ec.usphone, simple.ukphone, ec.ukphone].find((value): value is string => typeof value === "string" && !!value.trim()) ?? "";
  return { query, translation, phonetic, audioUrl: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(query)}&type=2` };
}
export type TranslationTransport = (url: string) => Promise<{ status: number; text: string }>;
const transport: TranslationTransport = (url) => requestUrl({ url, method: "GET", throw: false });

/** Bounded session cache; persistent results exist only in active per-book records. */
export class YoudaoClient {
  private cache = new Map<string, { time: number; result: TranslationResult }>();
  private jobs = new Map<string, Promise<TranslationResult>>();
  private revision = 0;
  constructor(private request: TranslationTransport = transport) {}
  clear(): void { this.revision++; this.cache.clear(); this.jobs.clear(); }
  lookup(text: string): Promise<TranslationResult> {
    const query = singleWord(text);
    if (!query) return Promise.reject(new Error("有道查词只支持单个英文单词"));
    const key = query;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < 30 * 60 * 1000) return Promise.resolve({ ...cached.result, query });
    const pending = this.jobs.get(key);
    if (pending) return pending.then((result) => ({ ...result, query }));
    const revision = this.revision;
    const job = this.fetch(query).then((result) => {
      if (revision !== this.revision) return result;
      this.cache.delete(key);
      this.cache.set(key, { time: Date.now(), result });
      while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
      return result;
    }).finally(() => { if (this.jobs.get(key) === job) this.jobs.delete(key); });
    this.jobs.set(key, job);
    return job;
  }
  private async fetch(query: string): Promise<TranslationResult> {
    let timer: number | NodeJS.Timeout | undefined;
    const timeout = new Error("有道查词超时，请重试");
    try {
      let response;
      try {
        response = await Promise.race([this.request(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(query)}`), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timeout), 20000); })]);
      } catch (error) { if (error === timeout) throw timeout; throw new Error("有道查词连接失败，请检查网络后重试"); }
      if (response.status < 200 || response.status >= 300) throw new Error(`有道接口返回 ${response.status}，请重试`);
      let raw: unknown;
      try { raw = JSON.parse(response.text); } catch { throw new Error("有道返回的数据无效"); }
      return parseTranslation(raw, query);
    } finally { clearTimeout(timer); }
  }
}
