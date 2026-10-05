/** A transient highlight, independent of the user's persisted annotations. */
export function speechHighlight(doc: Document, ranges: Range[]): () => void {
  const win = doc.defaultView as (Window & { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...ranges: Range[]) => unknown }) | null;
  const style = doc.createElement("style");
  style.textContent = "::highlight(qr-speaking){background-color:rgba(100,155,235,.32);color:inherit;}";
  (doc.head ?? doc.documentElement).appendChild(style);
  if (win?.CSS?.highlights && win.Highlight) {
    win.CSS.highlights.set("qr-speaking", new win.Highlight(...ranges));
    return () => { win.CSS?.highlights?.delete("qr-speaking"); style.remove(); };
  }
  const overlay = doc.createElement("div");
  overlay.className = "qr-speech-overlay";
  overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2;";
  for (const range of ranges) for (const rect of Array.from(range.getClientRects())) {
    const mark = doc.createElement("div");
    mark.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:rgba(100,155,235,.32);border-radius:3px;`;
    overlay.appendChild(mark);
  }
  doc.body.appendChild(overlay);
  return () => { overlay.remove(); style.remove(); };
}
