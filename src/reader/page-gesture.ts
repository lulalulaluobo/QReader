/** Live finger displacement. Preparation can finish after the first move. */
export class PageDrag {
  distance = 0;
  ended = false;
  cancelled = false;
  readonly completion: Promise<boolean>;
  private resolve!: (commit: boolean) => void;
  private render: ((distance: number) => void) | null = null;

  constructor(readonly direction: 1 | -1, readonly width: number) {
    this.completion = new Promise(resolve => { this.resolve = resolve; });
  }
  update(distance: number): void {
    if (this.ended) return;
    this.distance = Math.max(0, Math.min(this.width, distance));
    this.render?.(this.distance);
  }
  subscribe(render: (distance: number) => void): () => void {
    this.render = render;
    render(this.distance);
    return () => { if (this.render === render) this.render = null; };
  }
  finish(commit: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.cancelled = !commit;
    this.resolve(commit);
  }
  cancel(): void { this.finish(false); }
}

interface GestureOptions {
  enabled(): boolean;
  width(): number;
  selected(): boolean;
  start(drag: PageDrag): void;
  claim(): void;
  interrupt?(): void;
}

/** Use screen coordinates: an iframe's client coordinates move with its page. */
export function bindPageDrag(surface: Document | HTMLElement, options: GestureOptions): () => void {
  const doc = surface.nodeType === 9 ? surface as Document : surface.ownerDocument!;
  const win = doc.defaultView!;
  let state: { id: number; x: number; y: number; lastX: number; time: number; velocity: number; vertical: boolean; drag: PageDrag | null } | null = null;
  const cancel = () => { state?.drag?.cancel(); state = null; };
  const start = (event: TouchEvent) => {
    // A second contact may start in the adjacent page's separate iframe.
    options.interrupt?.();
    cancel();
    const target = event.target instanceof win.Element ? event.target : null;
    if (!options.enabled() || options.selected() || event.touches.length !== 1
      || (win.visualViewport?.scale ?? 1) > 1 || target?.closest("a,button,input,textarea,select,[contenteditable=true]")) return;
    const touch = event.touches[0];
    state = { id: touch.identifier, x: touch.screenX, y: touch.screenY, lastX: touch.screenX,
      time: event.timeStamp, velocity: 0, vertical: false, drag: null };
  };
  const move = (event: TouchEvent) => {
    if (!state) return;
    if (event.touches.length !== 1 || (win.visualViewport?.scale ?? 1) > 1 || options.selected()) { cancel(); return; }
    const touch = [...event.touches].find(t => t.identifier === state!.id);
    if (!touch || state.vertical) return;
    const dx = touch.screenX - state.x, dy = touch.screenY - state.y;
    if (!state.drag) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { state.vertical = true; return; }
      if (!options.enabled()) { cancel(); return; }
      state.drag = new PageDrag(dx < 0 ? 1 : -1, Math.max(1, options.width()));
      options.claim();
      options.start(state.drag);
    }
    if (state.drag.ended) { cancel(); return; }
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    const elapsed = Math.max(1, event.timeStamp - state.time);
    state.velocity = state.drag.direction * (state.lastX - touch.screenX) / elapsed;
    state.lastX = touch.screenX;
    state.time = event.timeStamp;
    state.drag.update(-state.drag.direction * dx);
  };
  const end = (event: TouchEvent) => {
    if (!state?.drag) { state = null; return; }
    if (event.touches.length) { cancel(); event.stopPropagation(); return; }
    const touch = [...event.changedTouches].find(t => t.identifier === state!.id);
    if (touch) state.drag.update(state.drag.direction * (state.x - touch.screenX));
    const velocity = event.timeStamp - state.time > 80 ? 0 : state.velocity;
    const drag = state.drag;
    state = null;
    drag.finish(drag.distance >= drag.width / 2 || (drag.distance > 12 && velocity > 0.35));
    event.stopPropagation();
  };
  surface.addEventListener("touchstart", start as EventListener, { passive: true });
  surface.addEventListener("touchmove", move as EventListener, { passive: false });
  surface.addEventListener("touchend", end as EventListener, { passive: true });
  surface.addEventListener("touchcancel", cancel, { passive: true });
  return () => {
    cancel();
    surface.removeEventListener("touchstart", start as EventListener);
    surface.removeEventListener("touchmove", move as EventListener);
    surface.removeEventListener("touchend", end as EventListener);
    surface.removeEventListener("touchcancel", cancel);
  };
}
