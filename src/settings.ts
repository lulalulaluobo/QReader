// Plugin settings (PRD §29).

import type { ReadMode, ReadingTheme, ReadingLayout, ReadingColors } from "./types";
import type { AiSettings } from "./ai/providers";

export interface QReaderSettings {
  libraryPath: string; // vault-relative, e.g. "Books"
  ai: AiSettings;
  reading: ReadingLayout & {
    theme: ReadingTheme;
    defaultMode: ReadMode;
  };
}

export const DEFAULT_SETTINGS: QReaderSettings = {
  libraryPath: "Books",
  ai: {
    provider: "deepseek",
    deepseekApiKey: "",
    agnesApiKey: "",
    custom: { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" },
  },
  reading: {
    fontSize: 17,
    lineHeight: 1.75,
    pageMargin: 24,
    fontFamily: "original",
    paragraphIndent: false,
    theme: "auto",
    defaultMode: "paginated",
  },
};

export const READING_PALETTES: Record<Exclude<ReadingTheme, "auto">, ReadingColors> = {
  light: { background: "#faf9f6", foreground: "#292a2e", muted: "#64656a", dark: false },
  sepia: { background: "#f3e9d4", foreground: "#3b3329", muted: "#74634e", dark: false },
  sage: { background: "#e8ede4", foreground: "#2e382d", muted: "#5b6758", dark: false },
  dark: { background: "#202124", foreground: "#d8d9db", muted: "#a6a8ad", dark: true },
};

export const READING_FONTS = {
  original: "",
  sans: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: '"Songti SC", "STSong", "SimSun", serif',
};

/** Only forward-slash, Vault-relative paths are accepted. */
export function validateLibraryPath(raw: string): { ok: boolean; path: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, path: "", error: "路径不能为空" };
  if (trimmed.startsWith("/") || trimmed.includes("\\") || /^[A-Za-z]:/.test(trimmed)) {
    return { ok: false, path: "", error: "请填写 Vault 内使用 / 分隔的相对路径" };
  }
  const path = trimmed.replace(/\/+$/g, "");
  if (path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return { ok: false, path, error: "路径不能包含空目录、. 或 .." };
  }
  return { ok: true, path };
}
