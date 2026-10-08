import { requestUrl } from "obsidian";
import type { RequestUrlResponse } from "obsidian";
import type { AiConfig } from "../types";
import { AI_PRESETS } from "./providers";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export class AiError extends Error {
  constructor(message: string, public status?: number) { super(message); this.name = "AiError"; }
}

export async function chatCompletion(cfg: AiConfig, messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<string> {
  opts?.signal?.throwIfAborted();
  if (!cfg.baseUrl.trim()) throw new AiError("未配置 AI Base URL");
  if (!cfg.model.trim()) throw new AiError("未配置 AI Model");
  if (!cfg.apiKey.trim()) throw new AiError("未配置 API Key");
  let endpoint: URL;
  try {
    endpoint = new URL(cfg.baseUrl.trim().replace(/\/+$/, ""));
    if (!endpoint.pathname.endsWith("/chat/completions")) endpoint.pathname = endpoint.pathname.replace(/\/+$/, "") + "/chat/completions";
  }
  catch { throw new AiError("AI Base URL 格式无效"); }
  if (!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new AiError("AI Base URL 必须是不含凭据、查询或片段的 HTTP(S) 地址");
  const body: { model: string; messages: ChatMessage[]; temperature: number; max_tokens?: number; thinking?: { type: "disabled" } } = {
    model: cfg.model.trim(), messages, temperature: opts?.temperature ?? 0.7,
  };
  if (opts?.maxTokens) body.max_tokens = opts.maxTokens;
  if (endpoint.origin === AI_PRESETS.deepseek.baseUrl && (endpoint.pathname === "/chat/completions" || endpoint.pathname === "/v1/chat/completions") && AI_PRESETS.deepseek.models.includes(body.model)) {
    body.thinking = { type: "disabled" };
  }
  let response: RequestUrlResponse;
  let timer: number | NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  try {
    response = await Promise.race([
      requestUrl({ url: endpoint.toString(), method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey.trim()}` }, body: JSON.stringify(body), throw: false }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AiError("AI 请求超时，请检查网络和接口配置")), opts?.timeoutMs ?? 90000); }),
      new Promise<never>((_, reject) => {
        abort = () => reject(new AiError("AI 请求已取消"));
        opts?.signal?.addEventListener("abort", abort, { once: true });
        if (opts?.signal?.aborted) abort();
      }),
    ]);
  } catch (error) {
    if (error instanceof AiError) throw error;
    // Transport errors may echo the authorization header. Never expose them.
    throw new AiError("AI 请求失败，请检查网络、Base URL 和接口配置");
  } finally { clearTimeout(timer); if (abort) opts?.signal?.removeEventListener("abort", abort); }
  if (response.status < 200 || response.status >= 300) {
    const hints: Record<number, string> = { 401: "API Key 无效或已失效", 403: "接口拒绝访问", 404: "接口路径或模型不存在", 429: "接口限流或额度不足" };
    throw new AiError(`AI 接口返回 ${response.status}：${hints[response.status] ?? "请检查服务端及模型配置"}`, response.status);
  }
  let raw: unknown;
  try { raw = JSON.parse(response.text); }
  catch { throw new AiError("AI 返回的响应不是有效 JSON"); }
  if (typeof raw !== "object" || raw === null || !("choices" in raw) || !Array.isArray(raw.choices)) throw new AiError("AI 返回的响应结构无效");
  const choice: unknown = raw.choices[0];
  if (typeof choice !== "object" || choice === null || !("message" in choice)) throw new AiError("AI 返回内容为空");
  const message: unknown = choice.message;
  if (typeof message !== "object" || message === null || !("content" in message) || typeof message.content !== "string" || !message.content.trim()) throw new AiError("AI 返回内容为空或格式不受支持");
  return message.content;
}

export async function testConnection(cfg: AiConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const reply = await chatCompletion(cfg, [{ role: "system", content: "You are a connectivity probe. Reply with the single word: ok" }, { role: "user", content: "ping" }], { temperature: 0, maxTokens: 128 });
    return { ok: true, message: `连接成功（${cfg.model} 返回: ${reply.trim().slice(0, 20)}）` };
  } catch (error) { return { ok: false, message: error instanceof AiError ? error.message : "AI 连接失败" }; }
}
