import { requestUrl } from "obsidian";
import type { ReaderEngine, SpeechBatch, SpeechSegment } from "./engine";

export interface SpeechSettings { provider: "auto" | "system" | "bing"; rate: number; voice: string }
export const DEFAULT_SPEECH: SpeechSettings = { provider: "auto", rate: 1, voice: "auto" };
export function loadSpeechSettings(raw: unknown): SpeechSettings {
  const s = typeof raw === "object" && raw !== null ? raw as Partial<SpeechSettings> : {};
  return {
    provider: s.provider === "system" || s.provider === "bing" ? s.provider : "auto",
    rate: typeof s.rate === "number" && Number.isFinite(s.rate) ? Math.max(0.5, Math.min(2, s.rate)) : 1,
    voice: typeof s.voice === "string" ? s.voice.slice(0, 300) : "auto",
  };
}
export const BING_VOICES = {
  "zh-CN-XiaoxiaoNeural": { lang: "zh-CN", gender: "Female" },
  "zh-CN-YunxiNeural": { lang: "zh-CN", gender: "Male" },
  "en-US-JennyNeural": { lang: "en-US", gender: "Female" },
  "en-US-GuyNeural": { lang: "en-US", gender: "Male" },
};
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const host = "https://cn.bing.com";
const headers = { "User-Agent": userAgent, Referer: host + "/translator", Origin: host };
const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
interface Session { key: number; token: string; expires: number }
async function speechRequest(options: Parameters<typeof requestUrl>[0]): Promise<Awaited<ReturnType<typeof requestUrl>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([requestUrl(options), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("在线语音服务暂不可用，请稍后重试或切换系统语音。")), 20_000);
    })]);
  } finally { clearTimeout(timer); }
}

/** Bing Translator's short-lived web session; no personal key and no permanent audio cache. */
export class BingSpeech {
  private session: Session | null = null;
  private pending: Promise<Session> | null = null;
  private async credentials(): Promise<Session> {
    if (this.session && this.session.expires > Date.now()) return this.session;
    if (!this.pending) this.pending = (async () => {
      const r = await speechRequest({ url: host + "/translator", headers, throw: false });
      const match = /params_AbusePreventionHelper\s*=\s*(\[[^\]]+\])/.exec(r.text);
      if (r.status !== 200 || !match) throw new Error("在线语音服务暂不可用，请稍后重试或切换系统语音。");
      const values: unknown = JSON.parse(match[1]);
      if (!Array.isArray(values) || typeof values[0] !== "number" || typeof values[1] !== "string") throw new Error("在线语音服务返回了无效会话。");
      return this.session = { key: values[0], token: values[1], expires: Date.now() + 20 * 60_000 };
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  async synthesize(text: string, voice: string): Promise<ArrayBuffer> {
    const name = Object.hasOwn(BING_VOICES, voice) ? voice as keyof typeof BING_VOICES
      : /[\u3400-\u9fff]/.test(text) ? "zh-CN-XiaoxiaoNeural" : "en-US-JennyNeural";
    const { lang, gender } = BING_VOICES[name];
    const ssml = `<speak version='1.0' xml:lang='${lang}'><voice xml:lang='${lang}' xml:gender='${gender}' name='${name}'><prosody rate='1'>${escapeXml(text)}</prosody></voice></speak>`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await this.credentials();
      // A fresh IG is required; reusing the page's impression ID can yield HTTP 401.
      const ig = crypto.randomUUID().replace(/-/g, "").toUpperCase();
      const r = await speechRequest({ url: `${host}/tfettts?isVertical=1&IG=${ig}&IID=translator.5024.1`, method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ssml, token: session.token, key: String(session.key) }).toString(), throw: false });
      if ((r.status === 401 || r.status === 403) && attempt === 0) { this.session = null; continue; }
      const bytes = new Uint8Array(r.arrayBuffer);
      const mp3 = bytes.length > 100 && (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 || bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33);
      if (r.status !== 200 || !mp3) throw new Error("在线语音服务暂不可用，请稍后重试或切换系统语音。");
      return r.arrayBuffer;
    }
    throw new Error("在线语音服务暂不可用，请稍后重试或切换系统语音。");
  }
}

export type SpeechState = "idle" | "loading" | "playing" | "paused" | "finished" | "error";
const owners = new WeakMap<Window, SpeechPlayer>();
export class SpeechPlayer {
  state: SpeechState = "idle";
  current: SpeechSegment | null = null;
  error = "";
  private generation = 0;
  private batch: SpeechBatch | null = null;
  private from: SpeechSegment | undefined;
  private index = 0;
  private audio: HTMLAudioElement;
  private utterance: SpeechSynthesisUtterance | null = null;
  private audioUrl: string | null = null;
  private bing = new BingSpeech();
  private resume: (() => void) | null = null;
  private finishPending: (() => void) | null = null;
  private unpause: (() => void) | null = null;
  private prefetched: { text: string; voice: string; result: Promise<{ buffer?: ArrayBuffer; error?: unknown }> } | null = null;
  private win: Window & typeof globalThis;
  constructor(private engine: ReaderEngine, private settings: () => SpeechSettings, win: Window,
    private changed: () => void) {
    this.win = win as Window & typeof globalThis;
    this.audio = this.win.document.createElement("audio");
    this.audio.preload = "auto";
  }
  provider(): "system" | "bing" {
    const s = this.settings();
    return s.provider === "auto" ? this.win.speechSynthesis ? "system" : "bing" : s.provider;
  }
  private setState(state: SpeechState): void { this.state = state; this.changed(); }
  play(from?: SpeechSegment): void {
    if (from) { this.stop(); this.from = from; }
    if (this.state === "loading" || this.state === "playing") return;
    const previous = owners.get(this.win);
    if (previous && previous !== this) previous.stop();
    owners.set(this.win, this);
    this.engine.setSpeechFollowing(true);
    if (this.state === "paused" && this.resume) {
      this.setState("playing"); this.resume();
      const token = this.generation;
      if (this.current) void this.engine.followSpeech(this.current).catch((error: unknown) => {
        if (token !== this.generation) return;
        this.stop(); this.error = error instanceof Error ? error.message : String(error); this.setState("error");
      });
      return;
    }
    // Unlock this same audio element within the click gesture before async synthesis.
    if (this.provider() === "bing") {
      this.audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      void this.audio.play().catch(() => undefined);
      this.audio.pause();
    }
    const token = ++this.generation;
    this.error = "";
    this.setState("loading");
    void this.run(token).catch((error: unknown) => {
      if (token !== this.generation) return;
      this.releaseAudio(); this.engine.clearSpeech();
      this.error = error instanceof Error ? error.message : String(error);
      this.setState("error");
    });
  }
  browse(): void { this.engine.setSpeechFollowing(false); }
  pause(): void {
    if (this.state !== "playing" && this.state !== "loading") return;
    if (this.provider() === "system") {
      // Cancel and resume the same short sentence: Android/Chrome pause is unreliable.
      ++this.generation;
      this.utterance = null;
      if (owners.get(this.win) === this) this.win.speechSynthesis?.cancel();
      this.finishPending?.(); this.finishPending = null;
      this.resume = null;
    } else this.audio.pause();
    this.setState("paused");
  }
  stop(): void {
    ++this.generation;
    this.unpause?.(); this.unpause = null; this.resume = null;
    this.finishPending?.(); this.finishPending = null;
    if (owners.get(this.win) === this) { this.win.speechSynthesis?.cancel(); owners.delete(this.win); }
    this.utterance = null; this.resume = null;
    this.prefetched = null;
    this.releaseAudio(); this.engine.clearSpeech();
    this.batch = null; this.from = undefined; this.index = 0; this.current = null; this.error = "";
    this.setState("idle");
  }
  updateRate(): void { this.audio.playbackRate = this.settings().rate; }
  private releaseAudio(): void {
    this.audio.pause(); this.audio.onended = this.audio.onerror = null;
    this.audio.removeAttribute("src"); this.audio.load();
    if (this.audioUrl) this.win.URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = null;
  }
  private async ready(token: number): Promise<boolean> {
    if (token !== this.generation) return false;
    if (this.state === "paused") await new Promise<void>((resolve) => { this.resume = this.unpause = resolve; });
    this.unpause = null;
    this.resume = null;
    return token === this.generation;
  }
  private async run(token: number): Promise<void> {
    if (!this.batch) {
      const batch = await this.engine.speechText(undefined, this.from);
      if (token !== this.generation) return;
      this.batch = batch;
      this.from = undefined;
    }
    if (!await this.ready(token)) return;
    let spoken = false;
    while (token === this.generation && this.batch) {
      if (this.index >= this.batch.segments.length) {
        if (this.batch.next === null) break;
        const batch = await this.engine.speechText(this.batch.next);
        if (token !== this.generation) return;
        this.batch = batch; this.index = 0;
        if (!await this.ready(token)) return;
        continue;
      }
      this.current = this.batch.segments[this.index];
      this.setState("loading");
      await this.engine.followSpeech(this.current);
      if (!await this.ready(token)) return;
      const s = this.settings();
      if (this.provider() === "system") {
        if (!this.win.speechSynthesis) throw new Error("此设备不支持系统网页语音，请选择在线语音。");
        await new Promise<void>((resolve, reject) => {
          this.finishPending = resolve;
          const utterance = new this.win.SpeechSynthesisUtterance(this.current!.text);
          this.utterance = utterance;
          utterance.lang = /[\u3400-\u9fff]/.test(utterance.text) ? "zh-CN" : "en-US";
          utterance.rate = s.rate;
          const voices = this.win.speechSynthesis.getVoices();
          utterance.voice = voices.find((v) => v.voiceURI === s.voice) ?? voices.find((v) => v.lang.toLowerCase().startsWith(utterance.lang.slice(0, 2))) ?? null;
          utterance.onstart = () => { if (token === this.generation) this.setState("playing"); };
          utterance.onend = () => resolve();
          utterance.onerror = (e) => e.error === "canceled" || e.error === "interrupted" ? resolve() : reject(new Error("系统语音朗读失败，请检查设备语音或选择在线语音。"));
          this.win.speechSynthesis.speak(utterance);
        });
      } else {
        let buffer: ArrayBuffer;
        if (this.prefetched?.text === this.current.text && this.prefetched.voice === s.voice) {
          const result = await this.prefetched.result;
          if (result.error) throw result.error;
          buffer = result.buffer!;
        } else buffer = await this.bing.synthesize(this.current.text, s.voice);
        if (token !== this.generation) return;
        this.prefetched = null;
        if (!await this.ready(token)) return;
        this.releaseAudio();
        this.audioUrl = this.win.URL.createObjectURL(new this.win.Blob([buffer], { type: "audio/mpeg" }));
        this.audio.src = this.audioUrl; this.updateRate();
        await new Promise<void>((resolve, reject) => {
          this.finishPending = resolve;
          this.audio.onended = () => resolve();
          this.audio.onerror = () => reject(new Error("音频播放失败，请重试。"));
          this.resume = () => { void this.audio.play().catch(reject); };
          this.setState("playing");
          void this.audio.play().catch(() => reject(new Error("音频播放被设备阻止，请再次点击播放。")));
          const next = this.batch?.segments[this.index + 1];
          if (next) this.prefetched = { text: next.text, voice: s.voice,
            result: this.bing.synthesize(next.text, s.voice).then((buffer) => ({ buffer }), (error: unknown) => ({ error })) };
        });
      }
      if (!await this.ready(token)) return;
      this.finishPending = null;
      spoken = true; this.index++;
    }
    if (token !== this.generation) return;
    this.releaseAudio(); this.engine.clearSpeech();
    this.batch = null; this.index = 0; this.resume = null;
    if (!spoken) throw new Error("当前位置没有可朗读的文字。图片书和扫描 PDF 需要文字层。");
    this.setState("finished");
  }
}
