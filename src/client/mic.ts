"use client";
// Microphone capture with simple voice-activity detection. Records one complete utterance
// and only then hands it over — partial audio is never sent for recognition.

export interface Capture {
  blob: Blob | null;
  ms: number; // recorded duration (what Sarvam bills, rounded up per request)
  speechMs: number;
  hadSpeech: boolean;
  reason: "silence" | "manual" | "max" | "no-speech" | "cancelled";
  mime: string;
}

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg;codecs=opus"]) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export class Mic {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private stopReason: Capture["reason"] | null = null;
  private stopNow: (() => void) | null = null;
  active = false;

  get ready() {
    return !!this.stream;
  }

  /** Must be called from a tap. Throws a readable error if permission is denied. */
  async init() {
    if (this.stream) {
      await this.ctx?.resume().catch(() => {});
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        window.isSecureContext
          ? "This browser has no microphone API."
          : "Microphone needs HTTPS (or localhost). Open the https:// link, not the LAN http:// address.",
      );
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      const n = (e as Error).name;
      if (n === "NotAllowedError") throw new Error("Microphone permission was denied. Allow it in the browser's site settings and reload.");
      if (n === "NotFoundError") throw new Error("No microphone found.");
      throw e;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    await this.ctx.resume().catch(() => {});
  }

  level(): number {
    if (!this.analyser || !this.buf) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    return Math.sqrt(s / this.buf.length);
  }

  /** End the current capture (tap-to-stop) — keeps the audio. */
  finish() {
    this.stopReason = "manual";
    this.stopNow?.();
  }

  /** Abort the current capture — discards the audio. */
  cancel() {
    this.stopReason = "cancelled";
    this.stopNow?.();
  }

  async capture(opts: {
    auto: boolean; // stop on trailing silence (hands-free); otherwise stop on finish()
    silenceMs?: number;
    maxMs?: number;
    noSpeechMs?: number;
    onLevel?: (lvl: number, speaking: boolean) => void;
  }): Promise<Capture> {
    if (!this.stream) throw new Error("Microphone not initialised");
    const silenceMs = opts.silenceMs ?? 1000; // was 1500: faster replies; elderly callers who pause still get 1 s
    const maxMs = opts.maxMs ?? 30000;
    const noSpeechMs = opts.noSpeechMs ?? 8000;
    const mime = pickMime();
    const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this.stopReason = null;
    this.active = true;

    return new Promise<Capture>((resolve) => {
      const t0 = performance.now();
      let floor = 0.004;
      let calibrated = 0;
      let speechStart = 0;
      let lastVoice = 0;
      let speechMs = 0;
      let lastTick = t0;
      let done = false;

      const stop = (reason: Capture["reason"]) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        this.stopNow = null;
        rec.onstop = () => {
          this.active = false;
          const ms = performance.now() - t0;
          const keep = reason !== "cancelled" && reason !== "no-speech" && speechMs >= 250;
          resolve({
            blob: keep ? new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }) : null,
            ms,
            speechMs,
            hadSpeech: speechMs >= 250,
            reason,
            mime: rec.mimeType || mime,
          });
        };
        try {
          rec.stop();
        } catch {
          rec.onstop?.(new Event("stop"));
        }
      };
      this.stopNow = () => stop(this.stopReason ?? "manual");

      const timer = setInterval(() => {
        const now = performance.now();
        const dt = now - lastTick;
        lastTick = now;
        const lvl = this.level();
        if (calibrated < 6) {
          floor = Math.min(0.008, calibrated === 0 ? lvl : floor * 0.7 + lvl * 0.3);
          calibrated++;
        }
        const threshold = Math.max(0.012, floor * 2.8);
        const speaking = lvl > threshold;
        if (speaking) {
          if (!speechStart) speechStart = now;
          lastVoice = now;
          speechMs += dt;
        }
        opts.onLevel?.(lvl, speaking);
        const elapsed = now - t0;
        if (elapsed > maxMs) return stop(speechStart && now - lastVoice >= silenceMs ? "silence" : "max");
        if (opts.auto) {
          if (!speechStart && elapsed > noSpeechMs) return stop("no-speech");
          if (speechStart && now - lastVoice > silenceMs && speechMs >= 250) return stop("silence");
        }
      }, 50);

      rec.start(250);
    });
  }
}
