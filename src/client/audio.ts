"use client";
// Plays the agent's reply segment by segment. Every segment reports where its audio
// actually came from, so the diagnostics never present a fallback as Sarvam.

export interface PlanSegment {
  text: string;
  key: string;
  cacheable: boolean;
  chars: number;
  prebuiltUrl: string | null;
}

export type AudioSource =
  | "sarvam" // fresh Sarvam synthesis (billed)
  | "sarvam-prebuilt" // pre-generated Sarvam file for a fixed line (not billed)
  | "sarvam-server-cache" // Sarvam audio reused from the server cache (not billed)
  | "sarvam-device-cache" // Sarvam audio reused from this phone's cache (not billed)
  | "device-voice" // phone's built-in voice — fallback, NOT Sarvam
  | "failed"; // nothing played

export interface SegmentPlayback {
  text: string;
  source: AudioSource;
  billedChars: number;
  speaker: string | null;
  error?: string;
  interrupted?: boolean;
  latencyMs?: number;
}

export interface VoiceReq {
  speaker: string;
  pace: number;
}

const CACHE_NAME = "gb-tts-v1";
const memCache = new Map<string, string>(); // key → object URL

async function fromDeviceCache(key: string): Promise<string | null> {
  const m = memCache.get(key);
  if (m) return m;
  try {
    if (!("caches" in window)) return null;
    const c = await caches.open(CACHE_NAME);
    const r = await c.match(`/__tts/${key}`);
    if (!r) return null;
    const url = URL.createObjectURL(await r.blob());
    memCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

async function toDeviceCache(key: string, blob: Blob) {
  memCache.set(key, URL.createObjectURL(blob));
  try {
    if ("caches" in window) await (await caches.open(CACHE_NAME)).put(`/__tts/${key}`, new Response(blob));
  } catch {
    /* private mode etc. — memory cache still works */
  }
}

interface Fetched {
  url: string | null;
  source: AudioSource;
  billedChars: number;
  speaker: string | null;
  error?: string;
  latencyMs?: number;
}

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export class ReplyPlayer {
  private el: HTMLAudioElement | null = null;
  private stopFlag = false;
  private resumeFn: (() => void) | null = null;
  private currentReject: ((why: string) => void) | null = null;
  playing = false;

  constructor(
    private getHeaders: () => Record<string, string>,
    private hooks: { onBlocked: (blocked: boolean) => void },
  ) {}

  /** The <audio> element replies play through (for the phone-line filter). */
  get element(): HTMLAudioElement | null {
    return this.el;
  }

  /** Call inside a user tap: unlocks audio playback on iOS/Android. */
  unlock() {
    if (!this.el) {
      this.el = new Audio();
      this.el.setAttribute("playsinline", "true");
      this.el.preload = "auto";
    }
    this.el.src = SILENT_WAV;
    this.el.play().catch(() => {});
    try {
      window.speechSynthesis?.getVoices();
    } catch {
      /* ignore */
    }
  }

  /** Tap-to-play after the browser blocked autoplay. */
  resume() {
    const f = this.resumeFn;
    this.resumeFn = null;
    this.hooks.onBlocked(false);
    f?.();
  }

  /** Barge-in: stop now. The in-flight play() resolves with interrupted=true. */
  stop() {
    this.stopFlag = true;
    if (this.el) {
      this.el.pause();
      this.el.removeAttribute("src");
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    this.currentReject?.("interrupted");
    if (this.resumeFn) {
      this.resumeFn = null;
      this.hooks.onBlocked(false);
    }
  }

  private async fetchSegment(seg: PlanSegment, voice: VoiceReq): Promise<Fetched> {
    const cached = await fromDeviceCache(seg.key);
    if (cached) return { url: cached, source: "sarvam-device-cache", billedChars: 0, speaker: voice.speaker };
    const t0 = performance.now();
    if (seg.prebuiltUrl) {
      try {
        const r = await fetch(seg.prebuiltUrl);
        if (r.ok) {
          const blob = await r.blob();
          await toDeviceCache(seg.key, blob);
          return { url: memCache.get(seg.key)!, source: "sarvam-prebuilt", billedChars: 0, speaker: voice.speaker, latencyMs: performance.now() - t0 };
        }
      } catch {
        /* fall through to API */
      }
    }
    try {
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.getHeaders() },
        body: JSON.stringify({ text: seg.text, voice }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        return { url: null, source: "failed", billedChars: 0, speaker: null, error: j.error ?? `HTTP ${r.status}` };
      }
      const src = r.headers.get("X-TTS-Source") ?? "sarvam";
      const blob = await r.blob();
      await toDeviceCache(seg.key, blob);
      return {
        url: memCache.get(seg.key)!,
        source: src === "sarvam" ? "sarvam" : "sarvam-server-cache",
        billedChars: Number(r.headers.get("X-TTS-Billed-Chars") ?? 0),
        speaker: r.headers.get("X-TTS-Speaker"),
        latencyMs: performance.now() - t0,
      };
    } catch (e) {
      return { url: null, source: "failed", billedChars: 0, speaker: null, error: String((e as Error).message ?? e) };
    }
  }

  private playUrl(url: string): Promise<"ended" | "interrupted"> {
    const el = this.el ?? (this.el = new Audio());
    return new Promise((resolve, reject) => {
      this.currentReject = (why) => resolve(why === "interrupted" ? "interrupted" : "ended");
      el.onended = () => resolve("ended");
      el.onerror = () => reject(new Error("audio element error"));
      el.src = url;
      el.play().catch((err: Error) => {
        if (err?.name === "NotAllowedError") {
          // Autoplay blocked: wait for a tap.
          this.hooks.onBlocked(true);
          this.resumeFn = () => el.play().catch((e2) => reject(e2));
        } else reject(err);
      });
    });
  }

  private speakDevice(text: string): Promise<"ended" | "interrupted"> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve("ended");
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "te-IN";
      const v = synth.getVoices().find((x) => x.lang?.toLowerCase().startsWith("te"));
      if (v) u.voice = v;
      u.onend = () => resolve(this.stopFlag ? "interrupted" : "ended");
      u.onerror = () => resolve("ended");
      this.currentReject = () => resolve("interrupted");
      synth.speak(u);
    });
  }

  /**
   * Plays all segments in order (fetching them in parallel). Returns per-segment
   * playback records and whether the customer interrupted.
   */
  async play(segments: PlanSegment[], voice: VoiceReq, opts: { deviceFallback: boolean }) {
    this.stopFlag = false;
    this.playing = true;
    const fetches = segments.map((s) => this.fetchSegment(s, voice));
    const out: SegmentPlayback[] = [];
    let interrupted = false;
    try {
      for (let i = 0; i < segments.length; i++) {
        const f = await fetches[i];
        const rec: SegmentPlayback = { text: segments[i].text, source: f.source, billedChars: f.billedChars, speaker: f.speaker, error: f.error, latencyMs: f.latencyMs };
        out.push(rec);
        if (this.stopFlag) { rec.interrupted = true; interrupted = true; break; }
        let res: "ended" | "interrupted" = "ended";
        if (f.url) {
          try {
            res = await this.playUrl(f.url);
          } catch (e) {
            rec.error = `playback: ${(e as Error).message}`;
            if (opts.deviceFallback) { rec.source = "device-voice"; res = await this.speakDevice(segments[i].text); }
            else rec.source = "failed";
          }
        } else if (opts.deviceFallback) {
          rec.source = "device-voice";
          res = await this.speakDevice(segments[i].text);
        }
        if (res === "interrupted" || this.stopFlag) { rec.interrupted = true; interrupted = true; break; }
      }
    } finally {
      this.playing = false;
      this.currentReject = null;
    }
    // Mark segments that never started as interrupted too.
    for (let i = out.length; i < segments.length; i++) {
      const f = await fetches[i];
      out.push({ text: segments[i].text, source: f.source, billedChars: f.billedChars, speaker: f.speaker, interrupted: true });
    }
    return { segments: out, interrupted };
  }

  /** Download segments into the device cache now, so they play instantly later. */
  async prefetch(segments: PlanSegment[], voice: VoiceReq) {
    await Promise.all(segments.map((s) => this.fetchSegment(s, voice).catch(() => null)));
  }

  /** Audition: play one line in a given voice. */
  async audition(seg: PlanSegment, voice: VoiceReq) {
    return this.play([seg], voice, { deviceFallback: false });
  }
}
