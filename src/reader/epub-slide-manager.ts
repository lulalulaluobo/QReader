import DefaultViewManager from "epubjs/src/managers/default/index.js";
import { animatePageOffset } from "./page-motion";
import type { PageDrag } from "./page-gesture";

/** Keep real neighbouring pages in the same strip until the turn finishes. */
export class EpubSlideManager extends DefaultViewManager {
  private revision = 0;
  private animationController: AbortController | null = null;
  private turning = false;
  private drag: PageDrag | null = null;

  private get sliding(): boolean {
    return this.isPaginated && this.settings.axis === "horizontal"
      && this.settings.direction !== "rtl" && !this.settings.fullsize && this.layout.divisor === 1;
  }
  get canDrag(): boolean { return this.sliding && !this.turning && !!this.views.length; }
  get supportsDrag(): boolean { return this.sliding; }
  get pageWidth(): number { return this.layout.delta; }

  async dragPage(drag: PageDrag): Promise<boolean> {
    if (!this.canDrag || drag.cancelled) { drag.cancel(); return false; }
    this.drag = drag;
    try { return await this.turn(drag.direction, drag); }
    finally { if (this.drag === drag) this.drag = null; }
  }

  async next(): Promise<void> {
    if (!this.sliding) { await super.next(); return; }
    await this.turn(1);
  }

  async prev(): Promise<void> {
    if (!this.sliding) { await super.prev(); return; }
    await this.turn(-1);
  }

  private async turn(direction: 1 | -1, drag?: PageDrag): Promise<boolean> {
    if (!this.views.length || !this.container.clientWidth) return false;
    const revision = this.revision;
    const start = this.container.scrollLeft;
    const delta = this.layout.delta;
    const target = start + direction * delta;
    const max = this.container.scrollWidth - this.container.clientWidth;
    this.turning = true;
    try {
      if (target >= -1 && target <= max + 1) {
        return await this.movePage(start, Math.max(0, Math.min(max, target)), drag);
      }
      const old = direction === 1 ? this.views.last() : this.views.first();
      const section = direction === 1 ? old.section.next() : old.section.prev();
      if (!section) { drag?.cancel(); return false; }
      // Appending/prepending retains the current document and its selection,
      // highlights and CSS. No screenshot or duplicate IDs are involved.
      const incoming = await (direction === 1 ? this.append(section) : this.prepend(section));
      if (revision !== this.revision) return false;
      incoming.show();
      const origin = direction === 1 ? start : start + incoming.width();
      this.scrollTo(origin, 0, true);
      const committed = await this.movePage(origin, origin + direction * delta, drag);
      if (revision !== this.revision) return false;
      if (!committed) {
        this.views.remove(incoming); this.emit("removed", incoming);
        this.scrollTo(start, 0, true);
        return false;
      }
      // Bound memory to the current chapter. Removing the old strip prefix and
      // compensating scrollLeft in the same task preserves the final pixels.
      const left = this.container.scrollLeft - (direction === 1 ? old.width() : 0);
      this.views.remove(old);
      this.emit("removed", old);
      this.scrollTo(left, 0, true);
      return true;
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

  private async movePage(origin: number, target: number, drag?: PageDrag): Promise<boolean> {
    if (!drag) return this.animate(target);
    const unsubscribe = drag.subscribe(distance => this.scrollTo(origin + drag.direction * distance, 0, true));
    const commit = await drag.completion;
    unsubscribe();
    if (this.drag !== drag) return false;
    // Foliate's default touch release snaps directly; the drag itself is live.
    await this.animate(commit ? target : origin, 0);
    return commit;
  }

  private animate(target: number, duration?: number): Promise<boolean> {
    const win = this.container.ownerDocument.defaultView!;
    const controller = this.animationController = new AbortController();
    return animatePageOffset(win, this.container.scrollLeft, target,
      offset => this.scrollTo(offset, 0, true), controller.signal, duration)
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
    this.drag?.cancel();
    this.drag = null;
    this.animationController?.abort();
    this.animationController = null;
    super.clear();
  }
}
