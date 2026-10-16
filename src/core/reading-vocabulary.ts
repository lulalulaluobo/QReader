import type { FsLike } from "./fs";
import type { TranslationResult } from "../translation/youdao";
import { VocabularyStore, scopeVocabularyParagraph } from "./vocabulary";
import type { SavedVocabularyWord, VocabularyWord, WordExposure } from "./vocabulary";

/** Global learning state, with favorites and source locations kept in the current book. */
export class ReadingVocabularyStore {
  private shared: VocabularyStore;
  private book: VocabularyStore;
  constructor(private fs: FsLike, sharedPath: string, private bookId: string, bookPath: string) {
    this.shared = new VocabularyStore(fs, sharedPath);
    this.book = new VocabularyStore(fs, bookPath);
  }
  async load(legacyBooks: readonly { bookId: string; path: string }[]): Promise<void> {
    const separator = this.shared.path.lastIndexOf("/");
    if (separator > 0) await this.fs.mkdir(this.shared.path.slice(0, separator));
    await this.shared.migrateLegacy(legacyBooks);
    await this.shared.load();
    await this.book.load();
  }
  get words(): readonly VocabularyWord[] {
    // Engines use book-local paragraph IDs. Only expose this book's deduplication history.
    return this.shared.words.map(word => ({ ...word, seenParagraphs: word.seenParagraphs.flatMap(id => {
      try {
        const pair: unknown = JSON.parse(id);
        return Array.isArray(pair) && pair.length === 2 && pair[0] === this.bookId && typeof pair[1] === "string" ? [pair[1]] : [];
      } catch { return []; }
    }) }));
  }
  get saved(): readonly SavedVocabularyWord[] { return this.book.saved; }
  subscribe(listener: (words: readonly VocabularyWord[]) => void): () => void {
    const shared = this.shared.subscribe(() => listener(this.words));
    const book = this.book.subscribe(() => listener(this.words));
    return () => { shared(); book(); };
  }
  lookup(result: TranslationResult, paragraphId: string | undefined, autoAdd: boolean): Promise<void> {
    return this.shared.lookup(result, paragraphId ? scopeVocabularyParagraph(this.bookId, paragraphId) : undefined, autoAdd);
  }
  expose(exposures: readonly WordExposure[], threshold: number): Promise<void> {
    return this.shared.expose(exposures.map(event => ({ ...event, paragraphId: scopeVocabularyParagraph(this.bookId, event.paragraphId) })), threshold);
  }
  remove(word: string): Promise<void> { return this.shared.remove(word); }
  keep(record: SavedVocabularyWord): Promise<void> { return this.book.keep(record); }
  unkeep(record: SavedVocabularyWord): Promise<void> { return this.book.unkeep(record); }
}
