// Plugin settings (PRD §29).

import type { ReadMode, ReadingTheme, ReadingLayout, ReadingColors, HighlightColor } from "./types";
import type { AiSettings } from "./ai/providers";
import type { AppLanguage, MessageKey } from "./i18n";

export interface QReaderSettings {
  language: AppLanguage;
  libraryPath: string; // vault-relative, e.g. "Books"
  ai: AiSettings;
  questionPrompt: string; // Empty uses the built-in chapter prompt.
  categories: string[];
  highlightColor: HighlightColor;
  reading: ReadingLayout & {
    theme: ReadingTheme;
    defaultMode: ReadMode;
  };
}

export const DEFAULT_SETTINGS: QReaderSettings = {
  language: "zh-CN",
  libraryPath: "Books",
  ai: {
    provider: "deepseek",
    deepseekApiKey: "",
    agnesApiKey: "",
    custom: { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" },
  },
  questionPrompt: "",
  categories: [],
  highlightColor: "yellow",
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

export const HIGHLIGHT_COLORS: Record<HighlightColor, { label: MessageKey; fill: string; edge: string }> = {
  yellow: { label: "黄色", fill: "#f1c84e", edge: "#9e7500" },
  green: { label: "绿色", fill: "#88c58a", edge: "#357546" },
  blue: { label: "蓝色", fill: "#78b8df", edge: "#346e9b" },
  pink: { label: "粉色", fill: "#e8a0bf", edge: "#a44770" },
  purple: { label: "紫色", fill: "#b4a0df", edge: "#6b549f" },
};

export const READING_FONTS = {
  original: "",
  sans: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: '"Songti SC", "STSong", "SimSun", serif',
};

export function isReservedCategoryName(name: string): boolean {
  return ["全部", "未读", "已读", "all", "unread", "read"].includes(name.trim().toLowerCase());
}

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
