export interface ReaderTiming { kind: string; format: string; ms: number; sourceMs?: number; }
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))];
}
/** Explicit local diagnostics only: no book text, keys, telemetry or background I/O. */
export class ReaderMetrics {
  private timings: ReaderTiming[] = [];
  private frames: number[] = [];
  private cancelFrame: (() => void) | null = null;
  private startedAt: string | null = null;
  private active = false;
  record(timing: ReaderTiming): void { if (this.active) { this.timings.push(timing); if (this.timings.length > 1000) this.timings.shift(); } }
  start(win: Window): void {
    this.stop(); this.timings = []; this.frames = []; this.startedAt = new Date().toISOString();
    this.active = true;
    let previous = 0, id = 0;
    const visibility = () => { previous = 0; }; win.document.addEventListener("visibilitychange", visibility);
    const frame = (time: number) => {
      if (!win.document.hidden && previous) { this.frames.push(time - previous); if (this.frames.length > 10000) this.frames.shift(); }
      previous = win.document.hidden ? 0 : time; id = win.requestAnimationFrame(frame);
    };
    id = win.requestAnimationFrame(frame); this.cancelFrame = () => { win.cancelAnimationFrame(id); win.document.removeEventListener("visibilitychange", visibility); };
  }
  stop(): void { this.active = false; this.cancelFrame?.(); this.cancelFrame = null; }
  report(environment: Record<string, unknown>): Record<string, unknown> {
    const groups = new Map<string, number[]>();
    for (const timing of this.timings) { const key = `${timing.kind}:${timing.format}`; const values = groups.get(key) ?? []; values.push(timing.ms); groups.set(key, values); }
    return { version: 1, startedAt: this.startedAt, capturedAt: new Date().toISOString(), environment,
      summaries: [...groups].map(([group, values]) => ({ group, runs: values.length, p50: percentile(values, 0.5),
        p95: values.length >= 20 ? percentile(values, 0.95) : null, enoughSamples: values.length >= 20 })),
      timings: this.timings, frames: { samples: this.frames.length, intervalP50: percentile(this.frames, 0.5), intervalP95: percentile(this.frames, 0.95),
        over34ms: this.frames.filter(ms => ms > 34).length },
      note: "RAF intervals are not Android compositor dropped-frame counts. Pair with gfxinfo/Perfetto and meminfo. P95 needs repeated runs." };
  }
}
