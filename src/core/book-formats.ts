import JSZip from "jszip";
import { MOBI } from "foliate-js/mobi.js";
import type { FoliateBook, FoliateTocItem } from "foliate-js/mobi.js";
import { makeFB2 } from "foliate-js/fb2.js";
import { unzlibSync } from "fflate";
import type { BookFormat } from "../types";

/*!
 * Foliate.js — MIT License, Copyright (c) 2022 John Factotum.
 * fflate — MIT License, Copyright (c) 2023 Arjun Barrett.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export const BOOK_EXTENSION = /\.(epub|pdf|fb2(?:\.zip)?|mobi|azw3|cbz)$/i;
export const BOOK_FILE_ACCEPT = ".epub,.pdf,.fb2,.fb2.zip,.mobi,.azw3,.cbz,application/epub+zip,application/pdf";
const XHTML = "http://www.w3.org/1999/xhtml";
const fixedDate = new Date("2000-01-01T00:00:00Z");
const imageTypes: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", jxl: "image/jxl" };
const resourceExtensions: Record<string, string> = { "text/css": "css", "application/xhtml+xml": "xhtml", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/bmp": "bmp", "image/webp": "webp", "image/svg+xml": "svg", "image/avif": "avif", "image/jxl": "jxl", "font/woff": "woff", "font/woff2": "woff2", "font/ttf": "ttf", "font/otf": "otf" };
const xmlEscapes: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" };

function xml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => xmlEscapes[c]!);
}
function parseXml(text: string, label: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error(`${label} XML 已损坏`);
  return doc;
}
async function archive(bytes: ArrayBuffer): Promise<JSZip> {
  try { return await JSZip.loadAsync(bytes, { checkCRC32: true }); }
  catch (error) { throw new Error(`ZIP 容器无法读取（损坏或加密）：${error instanceof Error ? error.message : String(error)}`); }
}
async function fb2Blob(bytes: ArrayBuffer): Promise<Blob> {
  let blob = new Blob([bytes]);
  const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (header[0] === 0x50 && header[1] === 0x4b) {
    const zip = await archive(bytes);
    const files = Object.values(zip.files).filter((file) => !file.dir && /\.fb2$/i.test(file.name));
    if (files.length !== 1) throw new Error("FB2 压缩包必须包含且只包含一本 .fb2 原书");
    blob = new Blob([await files[0].async("arraybuffer")]);
  }
  const buffer = await blob.arrayBuffer();
  const declaration = new TextDecoder().decode(buffer.slice(0, 200));
  const encoding = declaration.match(/encoding\s*=\s*["']([^"']+)["']/i)?.[1] ?? "utf-8";
  const text = new TextDecoder(encoding).decode(buffer);
  const doc = parseXml(text, "FB2");
  if (doc.documentElement.localName !== "FictionBook" || !doc.querySelector("description title-info, body > section")) throw new Error("文件内容不是有效的 FictionBook（FB2）");
  if (!doc.querySelector("body > section, body > title, body > image, body > epigraph")) throw new Error("FB2 缺少可阅读正文");
  return blob;
}
function validateMobi(bytes: ArrayBuffer, format: BookFormat): void {
  const view = new DataView(bytes);
  // PDB type/creator signatures are ASCII BOOK/MOBI.
  if (bytes.byteLength < 86 || view.getUint32(60) !== 0x424f4f4b || view.getUint32(64) !== 0x4d4f4249) throw new Error(`${format.toUpperCase()} 缺少 BOOKMOBI 文件标记`);
  const count = view.getUint16(76);
  if (count < 2 || 78 + count * 8 > bytes.byteLength) throw new Error("MOBI 记录目录已损坏");
  let previous = 78 + count * 8 - 1;
  for (let i = 0; i < count; i++) {
    const offset = view.getUint32(78 + i * 8);
    if (offset <= previous || offset >= bytes.byteLength) throw new Error("MOBI 记录偏移无效");
    previous = offset;
    if (i === 0 || offset + 20 <= bytes.byteLength && view.getUint32(offset + 16) === 0x4d4f4249) {
      if (offset + 40 > bytes.byteLength || view.getUint32(offset + 16) !== 0x4d4f4249) throw new Error("MOBI 书籍头已损坏");
      if (view.getUint16(offset + 12) !== 0) throw new Error("此书受 DRM/加密保护；QReader 仅支持未加密书籍");
      if (i === 0) {
        const headerLength = view.getUint32(offset + 20);
        const exthOffset = offset + 16 + headerLength;
        let hasKf8 = view.getUint32(offset + 36) >= 8;
        if (exthOffset + 12 <= bytes.byteLength && view.getUint32(exthOffset) === 0x45585448) {
          let cursor = exthOffset + 12;
          for (let n = 0; n < view.getUint32(exthOffset + 8); n++) {
            if (cursor + 8 > bytes.byteLength) throw new Error("MOBI EXTH 目录已损坏");
            const length = view.getUint32(cursor + 4);
            if (length < 8 || cursor + length > bytes.byteLength) throw new Error("MOBI EXTH 记录已损坏");
            if (view.getUint32(cursor) === 121 && length >= 12) {
              const boundary = view.getUint32(cursor + 8);
              if (boundary !== 0xffffffff) {
                if (boundary >= count) throw new Error("MOBI 内嵌 KF8 记录不存在");
                const start = view.getUint32(78 + boundary * 8);
                if (start + 40 > bytes.byteLength || view.getUint32(start + 16) !== 0x4d4f4249 || view.getUint32(start + 36) < 8) throw new Error("MOBI 内嵌 KF8 已损坏；不会降级丢弃内容");
                hasKf8 = true;
              }
            }
            cursor += length;
          }
        }
        if (format === "azw3" && !hasKf8) throw new Error("AZW3 文件未包含 Kindle Format 8 内容");
      }
    }
  }
}

/** Extension and actual container must agree; parsing finishes before import writes anything. */
export async function detectBookFormat(fileName: string, bytes: ArrayBuffer): Promise<BookFormat> {
  const extension = fileName.match(BOOK_EXTENSION)?.[1]?.toLowerCase();
  if (!extension) throw new Error("请选择 EPUB、PDF、FB2、MOBI、AZW3 或 CBZ 原书");
  const format = (extension === "fb2.zip" ? "fb2" : extension) as BookFormat;
  if (format === "pdf") {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("PDF 文件标记无效");
  } else if (format === "mobi" || format === "azw3") validateMobi(bytes, format);
  else if (format === "fb2") await fb2Blob(bytes);
  else {
    const zip = await archive(bytes);
    if (format === "epub") {
      if (await zip.file("mimetype")?.async("string") !== "application/epub+zip") throw new Error("EPUB 缺少有效的 mimetype 标记");
      const container = await zip.file("META-INF/container.xml")?.async("string");
      if (!container) throw new Error("EPUB 缺少 META-INF/container.xml");
      const path = parseXml(container, "EPUB").querySelector("rootfile")?.getAttribute("full-path");
      if (!path || !zip.file(path)) throw new Error("EPUB 缺少可读取的 OPF 书籍目录");
      const encryption = await zip.file("META-INF/encryption.xml")?.async("string");
      if (encryption && Array.from(parseXml(encryption, "EPUB 加密信息").getElementsByTagNameNS("*", "EncryptionMethod")).some((node) => !["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"].includes(node.getAttribute("Algorithm") ?? ""))) throw new Error("此 EPUB 受 DRM/加密保护；QReader 仅支持未加密书籍");
    } else if (!Object.values(zip.files).some((file) => !file.dir && imageTypes[file.name.split(".").pop()?.toLowerCase() ?? ""])) throw new Error("CBZ 压缩包没有可阅读图片");
  }
  return format;
}

interface ConvertedSection { doc: Document; linear: boolean; pageSpread?: string }
interface Resource { id: string; path: string; type: string }
interface ConvertedToc { label: string; href: string; children: ConvertedToc[] }

async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("图片没有有效尺寸");
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch { throw new Error("书籍图片已损坏或当前 Obsidian 不支持该图片编码"); }
  finally { URL.revokeObjectURL(url); }
}
function sectionDoc(text: string): Document {
  const parser = new DOMParser();
  let doc = parser.parseFromString(text, "application/xhtml+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "html") doc = parser.parseFromString(text, "text/html");
  if (!doc.querySelector("body")) throw new Error("转换章节缺少正文");
  // New source formats never need executable content to display their books.
  doc.querySelectorAll("script,iframe,object,embed,base").forEach((element) => element.remove());
  for (const element of doc.querySelectorAll("*")) for (const attr of Array.from(element.attributes)) {
    if (/^on/i.test(attr.name) || /^(?:href|src)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) element.removeAttribute(attr.name);
  }
  return doc;
}
async function resourceType(blob: Blob): Promise<string> {
  if (blob.type && blob.type !== "application/octet-stream") return blob.type;
  const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const text = new TextDecoder().decode(head);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && text.slice(1, 4) === "PNG") return "image/png";
  if (text.startsWith("GIF8")) return "image/gif";
  if (text.startsWith("BM")) return "image/bmp";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  if (/<svg[\s>]/i.test(text)) return "image/svg+xml";
  if (text.startsWith("wOFF")) return "font/woff";
  if (text.startsWith("wOF2")) return "font/woff2";
  if (text.startsWith("OTTO")) return "font/otf";
  if (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0) return "font/ttf";
  return "application/octet-stream";
}

/** Only new formats are converted. Generated spine/anchor/resource order is deterministic. */
export async function bookAsEpub(bytes: ArrayBuffer, fileName: string, format: BookFormat): Promise<ArrayBuffer> {
  if (format === "epub") return bytes;
  if (format === "pdf") throw new Error("PDF 必须使用 PDF.js 打开");
  let source: FoliateBook | undefined;
  const zip = new JSZip();
  const sections: ConvertedSection[] = [];
  const resources: Resource[] = [];
  const urls = new Set<string>();
  const resourcePaths = new Map<string, string>();
  const resourceBlobs = new Map<string, Blob>();
  const verifiedImages = new Set<string>();
  const addFile = (path: string, data: string | ArrayBuffer): void => { zip.file(path, data, { date: fixedDate }); };
  addFile("mimetype", "application/epub+zip");
  const addResource = (data: string | ArrayBuffer, type: string): string => {
    const id = `r${resources.length}`;
    const ext = resourceExtensions[type] ?? "bin";
    const path = `resources/${id}.${ext}`;
    resources.push({ id, path, type });
    addFile(`EPUB/${path}`, data);
    return path;
  };
  const rewriteResources = async (text: string, prefix: string): Promise<string> => {
    for (const url of new Set(text.match(/blob:[^\s"'<>\)]+|data:text\/css;charset=utf-8,[^\s"<>]+/g) ?? [])) {
      if (url.startsWith("blob:")) urls.add(url);
      let path = resourcePaths.get(url);
      if (!path) {
        const blob = resourceBlobs.get(url) ?? await (await fetch(url)).blob();
        const type = await resourceType(blob);
        if (type.startsWith("image/") && !verifiedImages.has(url)) { await imageSize(blob); verifiedImages.add(url); }
        // Reserve before recursion so CSS imports cannot loop forever.
        const id = `r${resources.length}`;
        const ext = resourceExtensions[type] ?? "bin";
        path = `resources/${id}.${ext}`;
        resourcePaths.set(url, path);
        resources.push({ id, path, type });
        if (type === "text/css" || type === "image/svg+xml" || type === "application/xhtml+xml") {
          const original = await blob.text();
          addFile(`EPUB/${path}`, await rewriteResources(original, ""));
        } else addFile(`EPUB/${path}`, await blob.arrayBuffer());
      }
      text = text.replaceAll(url, prefix ? prefix + path : path.slice("resources/".length));
    }
    return text;
  };
  try {
    let title = fileName.replace(BOOK_EXTENSION, "");
    let author = "";
    let language = "zh";
    let coverPath: string | undefined;
    let fixed = format === "cbz";
    let direction = "ltr";
    const toc: ConvertedToc[] = [];
    if (format === "cbz") {
      const original = await archive(bytes);
      const pages = Object.values(original.files).filter((file) => !file.dir && !file.name.startsWith("__MACOSX/") && imageTypes[file.name.split(".").pop()?.toLowerCase() ?? ""]);
      const collator = new Intl.Collator("en", { numeric: true, sensitivity: "variant" });
      pages.sort((left, right) => collator.compare(left.name, right.name) || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
      if (!pages.length) throw new Error("CBZ 压缩包没有可阅读图片");
      const zipComment = "comment" in original && typeof original.comment === "string" ? original.comment : "";
      // Jomic stores ComicBookInfo in the ZIP comment; plain comments remain valid ZIP data.
      if (zipComment) {
        let comment: unknown;
        try { comment = JSON.parse(zipComment); } catch { comment = null; }
        if (typeof comment === "object" && comment !== null && "ComicBookInfo/1.0" in comment) {
          const info = comment["ComicBookInfo/1.0"];
          if (typeof info === "object" && info !== null) {
            if ("title" in info && typeof info.title === "string") title = info.title.trim() || title;
            if ("language" in info && typeof info.language === "string") language = info.language || language;
            if ("credits" in info && Array.isArray(info.credits)) {
              const credits: unknown[] = info.credits;
              author = credits.flatMap((credit) => {
                if (typeof credit !== "object" || credit === null || !("person" in credit) || typeof credit.person !== "string") return [];
                return ["role" in credit && typeof credit.role === "string" ? `${credit.person}（${credit.role}）` : credit.person];
              }).join("、");
            }
          }
        }
      }
      const comicInfo = await original.file(/^ComicInfo\.xml$/i)[0]?.async("string");
      if (comicInfo) {
        const info = parseXml(comicInfo, "CBZ ComicInfo");
        title = info.querySelector("Title")?.textContent?.trim() || title;
        author = info.querySelector("Writer")?.textContent?.trim() ?? "";
        language = info.querySelector("LanguageISO")?.textContent?.trim() || language;
        if (info.querySelector("Manga")?.textContent?.trim() === "YesAndRightToLeft") direction = "rtl";
      }
      for (const page of pages) {
        const type = imageTypes[page.name.split(".").pop()!.toLowerCase()];
        const data = await page.async("arraybuffer");
        const size = await imageSize(new Blob([data], { type }));
        const path = addResource(data, type);
        coverPath ??= path;
        const index = sections.length;
        const label = page.name;
        const doc = sectionDoc(`<html xmlns="${XHTML}"><head><title>${xml(label)}</title><meta name="viewport" content="width=${size.width},height=${size.height}"/><style>html,body{margin:0;padding:0;width:100%;height:100%}img{display:block;width:100%;height:100%;object-fit:contain}</style></head><body><img src="../${path}" alt=""/></body></html>`);
        sections.push({ doc, linear: true });
        toc.push({ label, href: `sections/s${index}.xhtml`, children: [] });
      }
    } else {
      if (format === "mobi" || format === "azw3") validateMobi(bytes, format);
      source = format === "fb2" ? await makeFB2(await fb2Blob(bytes)) : await new MOBI({ unzlib: unzlibSync }).open(new Blob([bytes]));
      title = source.metadata.title?.trim() || title;
      const sourceAuthor = source.metadata.author;
      author = typeof sourceAuthor === "string" ? sourceAuthor : sourceAuthor?.map((person) => typeof person === "string" ? person : person.name).join("、") ?? "";
      const sourceLanguage = source.metadata.language;
      language = (typeof sourceLanguage === "string" ? sourceLanguage : sourceLanguage?.[0]) || language;
      fixed = source.rendition?.layout === "pre-paginated";
      direction = source.dir === "rtl" ? "rtl" : "ltr";
      for (const section of source.sections) {
        if (!section.load) { sections.push({ doc: sectionDoc(`<html xmlns="${XHTML}"><head/><body/></html>`), linear: false }); continue; }
        const url = await section.load();
        if (!url.startsWith("blob:")) throw new Error("格式解析器返回了非内嵌章节");
        urls.add(url);
        const response = await fetch(url);
        if (!response.ok) throw new Error("书籍章节读取失败");
        const doc = sectionDoc(await response.text());
        for (const image of doc.querySelectorAll("img,image")) {
          const src = image.getAttribute("src") ?? image.getAttribute("href") ?? image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
          if (!src || !/^(blob:|data:image\/)/i.test(src)) throw new Error("书籍图片缺少可读取的内嵌资源");
          if (src.startsWith("blob:")) urls.add(src);
          if (!verifiedImages.has(src)) {
            const blob = await (await fetch(src)).blob();
            await imageSize(blob);
            verifiedImages.add(src);
            if (src.startsWith("blob:")) resourceBlobs.set(src, blob);
          }
        }
        // Discover nested CSS/image URLs while this section is owned, including failure paths.
        await rewriteResources(new XMLSerializer().serializeToString(doc), "../");
        if (fixed && !doc.querySelector('meta[name="viewport"]')) {
          const viewport = source.rendition?.viewport;
          if (viewport?.width && viewport.height) {
            const meta = doc.createElementNS(XHTML, "meta");
            meta.setAttribute("name", "viewport"); meta.setAttribute("content", `width=${viewport.width},height=${viewport.height}`);
            doc.querySelector("head")?.append(meta);
          }
        }
        sections.push({ doc, linear: section.linear !== "no", pageSpread: section.pageSpread });
      }
      let anchorIndex = 0;
      const resolve = async (href: string, chapterRoot = false): Promise<string> => {
        const location = await source!.resolveHref(href);
        if (!location || !Number.isInteger(location.index) || !sections[location.index]) throw new Error(`书籍目录/链接目标无效：${href}`);
        const doc = sections[location.index].doc;
        const element = location.anchor?.(doc) ?? (chapterRoot ? doc.querySelector("body")?.firstElementChild : null);
        if (!element) {
          if (href.includes("#") && href.split("#")[1]) throw new Error(`书籍锚点不存在：${href}`);
          return `sections/s${location.index}.xhtml`;
        }
        if (!element.id) {
          let id: string;
          do { id = `qreader-anchor-${anchorIndex++}`; } while (doc.getElementById(id));
          element.id = id;
        }
        return `sections/s${location.index}.xhtml#${encodeURIComponent(element.id)}`;
      };
      const mapToc = async (items: FoliateTocItem[]): Promise<ConvertedToc[]> => {
        const nodes: ConvertedToc[] = [];
        for (const item of items) {
          // FB2 父章在子节前有独立正文，不能被无 fragment 的目录包装规则吞并。
          const parentChapter = format === "fb2" && !!item.subitems?.length;
          nodes.push({ label: item.label || "（无标题）", href: await resolve(item.href, parentChapter), children: await mapToc(item.subitems ?? []) });
        }
        return nodes;
      };
      toc.push(...await mapToc(source.toc ?? []));
      for (const section of sections) {
        for (const link of section.doc.querySelectorAll("a[href]")) {
          const href = link.getAttribute("href")!;
          if (/^(?:filepos:|kindle:pos:)/.test(href) || format === "fb2" && href.startsWith("#")) link.setAttribute("href", "../" + await resolve(href));
        }
      }
      if (!toc.length) sections.forEach((section, index) => {
        if (section.linear) toc.push({ label: section.doc.querySelector("h1,h2,h3,h4,h5,h6")?.textContent?.trim() || `第 ${index + 1} 节`, href: `sections/s${index}.xhtml`, children: [] });
      });
      const cover = await source.getCover();
      if (cover) {
        await imageSize(cover);
        coverPath = addResource(await cover.arrayBuffer(), await resourceType(cover));
      }
    }
    if (!sections.some((section) => section.linear)) throw new Error("原书不包含可阅读的主线章节");
    const serializer = new XMLSerializer();
    for (let index = 0; index < sections.length; index++) {
      addFile(`EPUB/sections/s${index}.xhtml`, await rewriteResources(serializer.serializeToString(sections[index].doc), "../"));
    }
    const renderToc = (items: ConvertedToc[]): string => `<ol>${items.map((item) => `<li><a href="${xml(item.href)}">${xml(item.label)}</a>${item.children.length ? renderToc(item.children) : ""}</li>`).join("")}</ol>`;
    const landmarks: string[] = [];
    if (source?.landmarks) for (const landmark of source.landmarks) {
      const href = await source.resolveHref(landmark.href);
      if (href && sections[href.index]) {
        const type = landmark.type?.join(" ");
        if (type) landmarks.push(`<li><a epub:type="${xml(type)}" href="sections/s${href.index}.xhtml">${xml(landmark.label ?? type)}</a></li>`);
      }
    }
    addFile("EPUB/nav.xhtml", `<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc" id="toc">${renderToc(toc)}</nav>${landmarks.length ? `<nav epub:type="landmarks"><ol>${landmarks.join("")}</ol></nav>` : ""}</body></html>`);
    const coverResource = resources.find((resource) => resource.path === coverPath);
    const manifest = sections.map((_, index) => `<item id="s${index}" href="sections/s${index}.xhtml" media-type="application/xhtml+xml"/>`).join("") + resources.map((resource) => `<item id="${resource.id}" href="${resource.path}" media-type="${xml(resource.type)}"${resource === coverResource ? ' properties="cover-image"' : ""}/>`).join("");
    const spine = sections.map((section, index) => `<itemref idref="s${index}"${section.linear ? "" : ' linear="no"'}${section.pageSpread ? ` properties="page-spread-${xml(section.pageSpread)}"` : ""}/>`).join("");
    addFile("META-INF/container.xml", '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    addFile("EPUB/package.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">qreader-converted-${format}</dc:identifier><dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator><dc:language>${xml(language)}</dc:language><meta property="dcterms:modified">2000-01-01T00:00:00Z</meta><meta property="rendition:layout">${fixed ? "pre-paginated" : "reflowable"}</meta><meta property="rendition:spread">none</meta>${coverResource ? `<meta name="cover" content="${coverResource.id}"/>` : ""}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}</manifest><spine page-progression-direction="${direction}">${spine}</spine></package>`);
    return await zip.generateAsync({ type: "arraybuffer", compression: "STORE" });
  } catch (error) { throw new Error(`${format.toUpperCase()} 无法读取：${error instanceof Error ? error.message : String(error)}`); }
  finally {
    source?.destroy();
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
