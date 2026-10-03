declare module "foliate-js/mobi.js" {
  export interface FoliateTocItem { label: string; href: string; subitems?: FoliateTocItem[] | null }
  export interface FoliateSection { id?: number | string; linear?: string; load?: () => string | Promise<string>; size?: number; pageSpread?: string }
  export interface FoliateLocation { index: number; anchor?: (doc: Document) => Element | null }
  export interface FoliateBook {
    metadata: { title?: string; identifier?: string; language?: string | string[]; author?: string | (string | { name: string })[] };
    sections: FoliateSection[];
    toc?: FoliateTocItem[];
    landmarks?: { label?: string; href: string; type?: string[] }[];
    rendition?: { layout?: string; viewport?: { width?: string; height?: string } };
    dir?: string;
    resolveHref(href: string): FoliateLocation | undefined | Promise<FoliateLocation | undefined>;
    getCover(): Blob | null | undefined | Promise<Blob | null | undefined>;
    destroy(): void;
  }
  export class MOBI {
    constructor(options: { unzlib: (data: Uint8Array) => Uint8Array });
    open(file: Blob): Promise<FoliateBook>;
  }
}

declare module "foliate-js/fb2.js" {
  import type { FoliateBook } from "foliate-js/mobi.js";
  export function makeFB2(file: Blob): Promise<FoliateBook>;
}
