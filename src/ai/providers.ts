import type { AiConfig } from "../types";

export type AiProvider = "deepseek" | "agnes" | "custom";

export interface AiSettings {
  provider: AiProvider;
  deepseekApiKey: string;
  agnesApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  agnesBaseUrl: string;
  agnesModel: string;
  custom: AiConfig;
}

export const AI_PRESETS: Record<"deepseek" | "agnes", { name: string; baseUrl: string; model: string; models: readonly string[] }> = {
  deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", models: ["deepseek-flash", "deepseek-v4-pro"] },
  agnes: { name: "Agnes", baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions", model: "agnes-3.0-flash", models: ["agnes-3.0-flash", "agnes-2.5-flash", "agnes-2.5-pro"] },
};

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadCustomConfig(raw: unknown): AiConfig {
  const value: Record<string, unknown> = isConfigObject(raw) ? raw : {};
  return {
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "https://api.openai.com/v1",
    apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
    model: typeof value.model === "string" ? value.model : "gpt-4o-mini",
  };
}

export function loadAiSettings(raw: unknown): AiSettings {
  const value: Record<string, unknown> = isConfigObject(raw) ? raw : {};
  const structured = "provider" in value || "custom" in value || "deepseekApiKey" in value || "agnesApiKey" in value;
  if (!structured && ("baseUrl" in value || "apiKey" in value || "model" in value)) {
    // 旧配置只迁入自定义服务，绝不把旧密钥复制给内置供应商。
    return { ...loadAiSettings(undefined), provider: "custom", custom: loadCustomConfig(value) };
  }
  return {
    provider: value.provider === "agnes" || value.provider === "custom" ? value.provider : "deepseek",
    deepseekApiKey: typeof value.deepseekApiKey === "string" ? value.deepseekApiKey : "",
    agnesApiKey: typeof value.agnesApiKey === "string" ? value.agnesApiKey : "",
    deepseekBaseUrl: typeof value.deepseekBaseUrl === "string" ? value.deepseekBaseUrl : AI_PRESETS.deepseek.baseUrl,
    deepseekModel: typeof value.deepseekModel === "string" ? value.deepseekModel : AI_PRESETS.deepseek.model,
    agnesBaseUrl: typeof value.agnesBaseUrl === "string" ? value.agnesBaseUrl : AI_PRESETS.agnes.baseUrl,
    agnesModel: typeof value.agnesModel === "string" ? value.agnesModel : structured ? "agnes-2.5-flash" : AI_PRESETS.agnes.model,
    custom: loadCustomConfig(value.custom),
  };
}

export function getAiConfig(settings: AiSettings): AiConfig {
  if (settings.provider === "custom") return settings.custom;
  return {
    baseUrl: settings.provider === "deepseek" ? settings.deepseekBaseUrl : settings.agnesBaseUrl,
    model: settings.provider === "deepseek" ? settings.deepseekModel : settings.agnesModel,
    apiKey: settings.provider === "deepseek" ? settings.deepseekApiKey : settings.agnesApiKey,
  };
}
