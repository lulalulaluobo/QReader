declare module "epubjs/src/managers/default/index.js" {
  import type Section from "epubjs/types/section";
  interface PageView {
    section: { next(): Section | undefined; prev(): Section | undefined };
    element: HTMLElement;
    show(): void;
    width(): number;
  }
  export default class DefaultViewManager {
    container: HTMLElement;
    settings: { axis: string; direction: string; fullsize: boolean };
    layout: { delta: number; divisor: number };
    isPaginated: boolean;
    scrollLeft: number;
    scrollTop: number;
    views: {
      length: number;
      all(): PageView[];
      first(): PageView;
      last(): PageView;
      remove(view: PageView): void;
    };
    next(): Promise<void> | void;
    prev(): Promise<void> | void;
    append(section: Section): Promise<PageView>;
    prepend(section: Section): Promise<PageView>;
    scrollTo(x: number, y: number, silent?: boolean): void;
    onScroll(): void;
    clear(): void;
    destroy(): void;
    emit(event: string, view: PageView): void;
  }
}
