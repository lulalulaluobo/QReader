// PDF.js legacy build provides browser compatibility polyfills; the Blob worker
// and decoder assets are bundled, so opening a PDF never needs a CDN.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import workerText from "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
import assets from "qreader:pdf-assets";
import type { PDFDocumentProxy } from "pdfjs-dist";

const directories: Record<string, string> = {
  cMapUrl: "cmaps",
  standardFontDataUrl: "standard_fonts",
  wasmUrl: "wasm",
};

class BundledBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const encoded = assets[`${directories[kind]}/${filename}`];
    if (!encoded) throw new Error(`缺少内置 PDF 解码资源：${filename}`);
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
}

let workerUrl: string | null = null;

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([workerText], { type: "text/javascript" }));
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  return pdfjsLib.getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
    cMapPacked: true,
    enableXfa: false,
    BinaryDataFactory: BundledBinaryDataFactory,
  }).promise;
}

export { pdfjsLib };