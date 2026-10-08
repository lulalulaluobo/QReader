import DefaultViewManager from "epubjs/src/managers/default/index.js";
import { animatePageOffset } from "./page-motion";

/** Keep real neighbouring pages in the same strip until the turn finishes. */
export class EpubSlideManager extends DefaultViewManager {
  private revision = 0;
  private animationController: AbortController | null = null;
  private turning = false;

  private get sliding(): boolean {
    return this.isPaginated && this.settings.axis === "horizontal"
      && this.settings.direction !== "rtl" && !this.settings.fullsize && this.layout.divisor === 1;
  }

  async next(): Promise<void> {
    if (!this.sliding) { await super.next(); return; }
    await this.turn(1);
  }

  async prev(): Promise<void> {
    if (!this.sliding) { await super.prev(); return; }
    await this.turn(-1);
  }

  private async turn(direction: 1 | -1): Promise<void> {
    if (!this.views.length || !this.container.clientWidth) return;
    const revision = this.revision;
    const start = this.container.scrollLeft;
    const delta = this.layout.delta;
    const target = start + direction * delta;
    const max = this.container.scrollWidth - this.container.clientWidth;
    this.turning = true;
    try {
      if (target >= -1 && target <= max + 1) {
        await this.animate(Math.max(0, Math.min(max, target)));
        return;
      }
      const old = direction === 1 ? this.views.last() : this.views.first();
      const section = direction === 1 ? old.section.next() : old.section.prev();
      if (!section) return;
      // Appending/prepending retains the current document and its selection,
      // highlights and CSS. No screenshot or duplicate IDs are involved.
      const incoming = await (direction === 1 ? this.append(section) : this.prepend(section));
      if (revision !== this.revision) return;
      incoming.show();
      const origin = direction === 1 ? start : start + incoming.width();
      this.scrollTo(origin, 0, true);
      await this.animate(origin + direction * delta);
      if (revision !== this.revision) return;
      // Bound memory to the current chapter. Removing the old strip prefix and
      // compensating scrollLeft in the same task preserves the final pixels.
      const left = this.container.scrollLeft - (direction === 1 ? old.width() : 0);
      this.views.remove(old);
      this.emit("removed", old);
      this.scrollTo(left, 0, true);
    } catch (error) {
      // Leave the old page usable when an adjacent chapter cannot be loaded.
      if (revision === this.revision) {
        const old = direction === 1 ? this.views.first() : this.views.last();
        for (const view of [...this.views.all()]) if (view !== old) {
          this.views.remove(view);
          this.emit("removed", view);
        }
        this.scrollTo(start, 0, true);
      }
      throw error;
    } finally { this.turning = false; }
  }

  private animate(target: number): Promise<void> {
    const win = this.container.ownerDocument.defaultView!;
    const controller = this.animationController = new AbortController();
    return animatePageOffset(win, this.container.scrollLeft, target,
      offset => this.scrollTo(offset, 0, true), controller.signal).then(() => undefined)
      .finally(() => { if (this.animationController === controller) this.animationController = null; });
  }

  onScroll(): void {
    // Relocations during a partial turn would save the wrong page and refresh
    // word/speech layers every frame. Rendition reports once after next/prev.
    if (this.turning) {
      this.scrollLeft = this.container.scrollLeft;
      this.scrollTop = this.container.scrollTop;
      return;
    }
    super.onScroll();
  }

  clear(): void {
    ++this.revision;
    this.animationController?.abort();
    this.animationController = null;
    super.clear();
  }
}
