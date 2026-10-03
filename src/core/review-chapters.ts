import type { ChapterState } from "../types";

const AUXILIARY_SEMANTICS: Record<string, true> = {
  cover: true, titlepage: true, "title-page": true, halftitlepage: true, "half-title-page": true,
  "copyright-page": true, copyright: true, toc: true, "table-of-contents": true, landmarks: true,
  "page-list": true, preface: true, foreword: true, introduction: true, prologue: true, dedication: true,
  acknowledgments: true, acknowledgements: true, afterword: true, epilogue: true, colophon: true,
  imprint: true, praise: true, praises: true, endorsements: true, bibliography: true, index: true,
  glossary: true, contributors: true, "about-author": true, appendix: true, epigraph: true, frontispiece: true,
};
const BODY_SEMANTICS: Record<string, true> = { chapter: true, bodymatter: true, part: true, text: true };

/** Undefined means the structure supplies no classification, not that it is body matter. */
export function reviewExclusionFromSemantics(value: string): boolean | undefined {
  const tokens = value.toLowerCase().split(/\s+/).map((token) => token.replace(/^doc-/, ""));
  if (tokens.some((token) => Object.hasOwn(BODY_SEMANTICS, token))) return false;
  if (tokens.some((token) => Object.hasOwn(AUXILIARY_SEMANTICS, token))) return true;
  return undefined;
}

function isAuxiliaryTitle(title: string): boolean {
  const chinese = title.replace(/\s+/g, "").replace(/^[《「【（(]+|[》」】）)]+$/g, "");
  if (/^(封面|封底|扉页|扉頁|书名页|書名頁|版权(?:页|信息)?|版權(?:頁|信息)?|目录|目錄|序|序言|推荐序|推薦序|前言|引言|自序|代序|作者序|译者序|譯者序|编者序|編者序|本书所获赞誉|本書所獲讚譽|赞誉|讚譽|致谢|致謝|献词|獻詞|后记|後記|跋|附录|附錄|参考文献|參考文獻|索引)(?:[一二三四五六七八九十\d]+|[：:—–-].+)?$/.test(chinese)) return true;
  const english = title.toLowerCase().replace(/\s+/g, " ").trim();
  return /^(cover(?: page)?|back cover|title ?page|half[- ]title(?: page)?|copyright(?: page| information)?|(?:table of )?contents|preface|foreword|introduction|prologue|praises?(?: for .+)?|endorsements?|acclaim(?: for .+)?|acknowledg(?:e)?ments?|dedication|afterword|epilogue|colophon|imprint|appendix|appendices|bibliography|references|index|glossary|about (?:the )?author)(?:\s*[:：—–-]\s*.+)?$/.test(english);
}

function isAuxiliaryHref(href: string, anonymous: boolean): boolean {
  // Match whole filenames/fragments, never arbitrary substrings such as "ordered-thinking".
  const [path, fragment] = href.split("#");
  const names = [path?.split("/").at(-1)?.replace(/\.(?:xhtml|html|htm|xml)$/i, ""), fragment];
  return names.some((name) => {
    if (!name) return false;
    try { name = decodeURIComponent(name); } catch { return false; }
    const token = name.toLowerCase().replace(/[_\s-]+/g, "").replace(/^\d+/, "").replace(/\d+$/, "");
    if (/^(?:cover|frontcover|backcover|titlepage|halftitlepage|copyright(?:page)?|toc|contents|封面|扉页|扉頁|书名页|書名頁|版权|版權|目录|目錄)$/.test(token)) return true;
    return anonymous && /^(?:title|halftitle|preface|foreword|introduction|prologue|praises?|endorsements?|acknowledg(?:e)?ments?|dedication|afterword|epilogue|colophon|imprint|序|序言|推荐序|前言|引言|本书所获赞誉|致谢)$/.test(token);
  });
}

/** Shared by all-chapter and due lists; filtering never removes persisted records. */
export function isReviewableChapter(chapter: ChapterState, semanticExclusion?: boolean): boolean {
  const excluded = chapter.reviewExcluded ?? semanticExclusion;
  if (excluded !== undefined) return !excluded;
  const title = chapter.title.trim();
  const anonymous = !title || /^(?:第\s*\d+\s*[节節章]|\(?无标题\)?|（无标题）|untitled(?: chapter)?|section\s+\d+)$/i.test(title);
  // Explicit chapter names take precedence over filename guesses on old books and custom PDFs.
  if (!anonymous && /^(?:第\s*[\d〇零一二三四五六七八九十百千两兩]+\s*[章节章節回部篇]|chapter\s+(?:\d+|[ivxlcdm]+)\b)/i.test(title)) return true;
  if (isAuxiliaryTitle(title)) return false;
  return !chapter.href || !isAuxiliaryHref(chapter.href, anonymous);
}
