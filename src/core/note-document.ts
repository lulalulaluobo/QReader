import { diff3Merge } from "node-diff3";
import type { FsLike } from "./fs";
import type { JsonStoreRef, ReadingFile } from "../types";
import { renderAnnotationsMd, renderLegacyAnnotationsMd } from "./md-notes";
import type { DocumentContext } from "./md-notes";

export async function textHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function mergeText(current: string, base: string, incoming: string, language: "zh-CN" | "en" = "zh-CN"): string {
  if (current === base) return incoming;
  if (incoming === base || current === incoming) return current;
  const lines: string[] = [];
  const supplements: string[] = [];
  for (const region of diff3Merge(current.split("\n"), base.split("\n"), incoming.split("\n"), { excludeFalseConflicts: true })) {
    if (region.ok) lines.push(...region.ok);
    else if (region.conflict) {
      // Keep the reader's exact version in place. Preserve simultaneous plugin
      // changes as ordinary text, without asking the reader to resolve a queue.
      lines.push(...region.conflict.a);
      if (region.conflict.b.some(line => line.trim())) supplements.push(region.conflict.b.join("\n"));
    }
  }
  const merged = lines.join("\n");
  const label = language === "en" ? "## Sync supplement\n\nNew reading notes also changed this passage; both versions are kept below.\n\n" : "## 同步补充\n\n同一处还有新的阅读记录，保留如下供回看。\n\n";
  return supplements.length ? merged.replace(/\n*$/, "\n\n") + label + supplements.join("\n\n---\n\n") + "\n" : merged;
}

function splitEntries(text: string): { outer: string; entries: Map<string, { full: string; body: string }> } {
  const entries = new Map<string, { full: string; body: string }>();
  const outer = text.replace(/^<!-- qreader-entry: ([^\s]+) -->\n([\s\S]*?)\n<!-- \/qreader-entry: \1 -->$/gm, (full, id: string, body: string) => {
    // Duplicated or damaged boundaries fall back to ordinary text merging.
    if (entries.has(id)) return full;
    entries.set(id, { full, body });
    return "<!-- qreader-slot: " + id + " -->";
  });
  return { outer, entries };
}

export function mergeDocument(current: string, base: string, incoming: string, language: "zh-CN" | "en" = "zh-CN"): string {
  if (current === base) return incoming;
  if (incoming === base || current === incoming) return current;
  const a = splitEntries(current), o = splitEntries(base), b = splitEntries(incoming);
  if (!o.entries.size) return mergeText(current, base, incoming, language);
  const bodies = new Map<string, string>(), retained: string[] = [];
  for (const id of new Set([...a.entries.keys(), ...o.entries.keys(), ...b.entries.keys()])) {
    const ar = a.entries.get(id), or = o.entries.get(id), br = b.entries.get(id);
    if (ar && or && br) {
      bodies.set(id, "<!-- qreader-entry: " + id + " -->\n" + mergeText(ar.body, or.body, br.body, language) + "\n<!-- /qreader-entry: " + id + " -->");
    } else {
      bodies.set(id, (ar ?? br ?? or)!.full);
      if (ar && or && !br && ar.body !== or.body) retained.push(ar.body);
      if (!ar && or && br && br.body !== or.body) retained.push(br.body);
    }
  }
  const outer = mergeText(a.outer, o.outer, b.outer, language);
  const merged = outer.replace(/^<!-- qreader-slot: ([^\s]+) -->$/gm, (slot, id: string) => bodies.get(id) ?? slot);
  return retained.length ? merged.replace(/\n*$/, "\n\n") + (language === "en" ? "## Preserved notes\n\n" : "## 已保留的笔记\n\n") + retained.join("\n\n") + "\n" : merged;
}

// Runs inside the existing per-reading.json queue. JSON and Markdown are
// restored together on failure; the merge baseline survives plugin restarts.
export async function mutateNoteDocument(
  fs: FsLike, store: JsonStoreRef, path: string, context: DocumentContext,
  change: (reading: ReadingFile) => void | Promise<void>,
): Promise<void> {
  let original: string | null = null, next = "", wrote = false, commits = 0;
  await store.mutate(async value => {
    original = await fs.exists(path) ? await fs.read(path) : null;
    const baseline = value.notesSync?.base ?? renderLegacyAnnotationsMd(value);
    let manualEditedAt = value.notesSync?.manualEditedAt;
    if (original !== null && (value.notesSync ? await textHash(original) !== value.notesSync.hash : original !== baseline)) {
      const mtime = (await fs.stat?.(path))?.mtime;
      manualEditedAt = new Date(mtime && Number.isFinite(mtime) ? mtime : Date.now()).toISOString();
    }
    await change(value);
    // The observed manual-edit date is part of the generated metadata.
    const language = value.notesSync?.language ?? context.language ?? "zh-CN";
    const renderValue = { ...value, notesSync: { base: "", hash: "", manualEditedAt } };
    const incoming = renderAnnotationsMd(renderValue, { ...context, language });
    next = original === null ? incoming : mergeDocument(original, baseline, incoming, language);
    value.notesSync = { base: incoming, hash: await textHash(next), language, ...(manualEditedAt ? { manualEditedAt } : {}) };
  }, async () => {
    if (++commits === 1) {
      const current = await fs.exists(path) ? await fs.read(path) : null;
      if (current !== original) throw new Error("笔记文档在同步期间发生修改，已保留，请重试");
      if (next === original) return;
      wrote = true;
      await fs.write(path, next);
      if (await fs.read(path) !== next) throw new Error("笔记文档写入校验失败");
    } else if (wrote) {
      if (original === null) {
        if (await fs.exists(path)) await fs.remove(path);
      } else {
        await fs.write(path, original);
        if (await fs.read(path) !== original) throw new Error("笔记文档恢复校验失败");
      }
    }
  });
}
