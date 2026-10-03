declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs" {
  const content: string;
  export default content;
}
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
declare module "qreader:pdf-assets" {
  const content: Record<string, string>;
  export default content;
}
