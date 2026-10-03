// Plugin settings (PRD §29).

import type { ReadMode, ReadingTheme } from "./types";

export interface QReaderSettings {
  libraryPath: string; // vault-relative, e.g. "Books"
  ai: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  reading: {
    fontSize: number;
    lineHeight: number;
    theme: ReadingTheme;
    defaultMode: ReadMode;
  };
}

export const DEFAULT_SETTINGS: QReaderSettings = {
  libraryPath: "Books",
  ai: {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
  },
  reading: {
    fontSize: 17,
    lineHeight: 1.75,
    theme: "auto",
    defaultMode: "paginated",
  },
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
