import { requestUrl } from "obsidian";

export interface TranslationSettings {
  appKey: string;
  appSecret: string;
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
  appKey: "", appSecret: "", autoAdd: true, highlight: true, deletionThreshold: 5,
};
export function loadTranslationSettings(raw: unknown): TranslationSettings {
  const value = typeof raw === "object" && raw !== null ? raw as Partial<TranslationSettings> : {};
  return {
    appKey: typeof value.appKey === "string" ? value.appKey : "",
    appSecret: typeof value.appSecret === "string" ? value.appSecret : "",
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
export async function youdaoBody(text: string, settings: TranslationSettings, salt = crypto.randomUUID(), curtime = String(Math.floor(Date.now() / 1000))): Promise<string> {
  if (!settings.appKey.trim() || !settings.appSecret.trim()) throw new Error("请先配置有道 App Key 和 App Secret");
  const chars = Array.from(text);
  const input = chars.length <= 20 ? text : chars.slice(0, 10).join("") + chars.length + chars.slice(-10).join("");
  const bytes = new TextEncoder().encode(settings.appKey.trim() + input + salt + curtime + settings.appSecret.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sign = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new URLSearchParams({ q: text, from: "en", to: "zh-CHS", appKey: settings.appKey.trim(), salt, curtime, sign, signType: "v3", ext: "mp3", strict: "true" }).toString();
}
function object(raw: unknown): raw is Record<string, unknown> { return typeof raw === "object" && raw !== null && !Array.isArray(raw); }
export function parseTranslation(raw: unknown, query: string): TranslationResult {
  if (!object(raw)) throw new Error("有道返回的数据无效");
  const errorCode = typeof raw.errorCode === "string" || typeof raw.errorCode === "number" ? String(raw.errorCode) : "unknown";
  if (errorCode !== "0") {
    const code = /^\d{1,5}$/.test(errorCode) ? errorCode : "unknown";
    const hints: Record<string, string> = { "108": "应用 ID 无效", "110": "请在有道控制台绑定文本翻译服务", "202": "签名无效，请检查 App Secret", "401": "有道账户余额不足", "411": "有道请求过于频繁" };
    throw new Error(`有道翻译失败（${code}）：${hints[code] ?? "请检查服务配置后重试"}`);
  }
  const basic = object(raw.basic) ? raw.basic : {};
  const definitions = Array.isArray(basic.explains) ? basic.explains.filter((item): item is string => typeof item === "string") : [];
  const translated = Array.isArray(raw.translation) ? raw.translation.filter((item): item is string => typeof item === "string") : [];
  const translation = (definitions.length ? definitions : translated).join("；").trim();
  if (!translation) throw new Error("有道没有返回译文");
  return { query, translation, phonetic: typeof basic.phonetic === "string" ? basic.phonetic : "", audioUrl: safeAudioUrl(raw.speakUrl) };
}
export type TranslationTransport = (body: string) => Promise<{ status: number; text: string }>;
const transport: TranslationTransport = (body) => requestUrl({ url: "https://openapi.youdao.com/v2/api", method: "POST", contentType: "application/x-www-form-urlencoded", body, throw: false });

/** Bounded session cache; persistent results exist only in active per-book records. */
export class YoudaoClient {
  private cache = new Map<string, { time: number; result: TranslationResult }>();
  private jobs = new Map<string, Promise<TranslationResult>>();
  private revision = 0;
  constructor(private request: TranslationTransport = transport) {}
  clear(): void { this.revision++; this.cache.clear(); this.jobs.clear(); }
  lookup(text: string, settings: TranslationSettings): Promise<TranslationResult> {
    const query = text.trim();
    if (!query || query.length > 5000) return Promise.reject(new Error("请选择不超过 5000 字的文本"));
    const key = `${settings.appKey}\0${settings.appSecret}\0${singleWord(query) ?? query}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < 30 * 60 * 1000) return Promise.resolve({ ...cached.result, query });
    const pending = this.jobs.get(key);
    if (pending) return pending.then((result) => ({ ...result, query }));
    const revision = this.revision;
    const job = this.fetch(query, settings).then((result) => {
      if (revision !== this.revision) return result;
      this.cache.delete(key);
      this.cache.set(key, { time: Date.now(), result });
      while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
      return result;
    }).finally(() => { if (this.jobs.get(key) === job) this.jobs.delete(key); });
    this.jobs.set(key, job);
    return job;
  }
  private async fetch(query: string, settings: TranslationSettings): Promise<TranslationResult> {
    const body = await youdaoBody(query, settings);
    let timer: number | NodeJS.Timeout | undefined;
    try {
      let response;
      try {
        response = await Promise.race([this.request(body), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("有道翻译超时，请重试")), 20000); })]);
      } catch { throw new Error("有道翻译连接失败，请检查网络后重试"); }
      if (response.status < 200 || response.status >= 300) throw new Error(`有道接口返回 ${response.status}，请重试`);
      let raw: unknown;
      try { raw = JSON.parse(response.text); } catch { throw new Error("有道返回的数据无效"); }
      return parseTranslation(raw, query);
    } finally { clearTimeout(timer); }
  }
}
