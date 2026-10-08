import type { SavedVocabularyWord, VocabularyWord } from "./vocabulary";
function plain(text: string): string { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/[\\`*_\[\]#]/g, "\\$&"); }
export function vocabularyMarkdown(title: string, words: readonly VocabularyWord[], saved: readonly SavedVocabularyWord[]): string {
  const lines = [`# ${plain(title)}`, "", "## Vocabulary / 生词", ""];
  for (const word of words) lines.push(`- **${word.word}** — ${plain(word.translation).replace(/\n/g, " ")}`);
  lines.push("", "## Saved passages / 保留原句", "");
  for (const word of saved) {
    lines.push(`### ${word.word}`, "", plain(word.translation), "", ...plain(word.quote).split("\n").map(line => `> ${line}`), "");
    if (word.cfi) lines.push(`CFI: \`${word.cfi.replace(/`/g, "") }\``, "");
    if (word.pdfPage) lines.push(`PDF: ${word.pdfPage}`, "");
  }
  return lines.join("\n") + "\n";
}
