/** A deliberate page turn; restoration and resizing never animate. */
export function animatePageOffset(
  win: Window, from: number, to: number, render: (offset: number) => void, signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (win.matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(to - from) < 1) {
    render(to);
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    const started = win.performance.now();
    let frame: number;
    const finish = (completed: boolean) => {
      win.cancelAnimationFrame(frame);
      signal.removeEventListener("abort", abort);
      resolve(completed);
    };
    const abort = () => finish(false);
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 300);
      render(from + (to - from) * (1 - (1 - t) ** 2));
      if (t < 1) frame = win.requestAnimationFrame(tick);
      else finish(true);
    };
    signal.addEventListener("abort", abort, { once: true });
    frame = win.requestAnimationFrame(tick);
  });
}
