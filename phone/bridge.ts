// One live phone call: caller audio in (8 kHz μ-law frames), Ravi's voice out.
// Provider-agnostic: Twilio/Exotel/Plivo adapters only translate their WebSocket messages to these calls.
//
//   caller speaks → speech detector notices the end of the sentence
//     → plays "హా అండి." instantly (pre-made) while → Sarvam recognises the words
//     → Ravi (AI agent) streams the reply → first sentence is voiced and played while the rest is written
//   caller talks over Ravi → playback is cut immediately (barge-in) and Ravi listens.

import { pcmToUlaw, rms, ulawToPcm } from "./audio";

export type Outgoing = { type: "audio"; ulaw: Uint8Array } | { type: "clear" } | { type: "hangup" };

export interface TurnResult { text: string; closed: boolean; lang: "te" | "en"; outcome: unknown | null }

export interface PhoneDeps {
  /** Opening line for this call. */
  opening(): string;
  /** 8 kHz 16-bit PCM → words. */
  stt(pcm: Int16Array): Promise<string>;
  /** Words → 8 kHz 16-bit PCM in Ravi's voice. */
  tts(text: string): Promise<Int16Array>;
  /** One caller turn; onFirst gets the first sentence early. */
  turn(text: string, interrupted: boolean, ackPlayed: string | null, onFirst: (s: string) => void): Promise<TurnResult>;
  acks: { te: string[]; en: string[] };
  /** The last reply was dropped because the caller spoke first — the agent should know they didn't hear it. */
  unheard?: () => void;
  log?: (line: string) => void;
}

const FRAME = 160; // 20 ms at 8 kHz
const ms = (frames: number) => frames * 20;

export interface TurnTiming { said: string; reply: string; sttMs: number; ackAfterMs: number | null; firstAudioAfterMs: number | null; totalReplyMs: number }

export class CallSession {
  // ----- recording (left = caller, right = Ravi) -----
  private callerPcm: Int16Array[] = [];
  private callerSamples = 0;
  private agentTrack: { at: number; pcm: Int16Array }[] = [];
  readonly transcript: { at: number; who: "ravi" | "caller"; text: string }[] = [];
  readonly timings: TurnTiming[] = [];
  outcome: unknown = null;
  closed = false;

  // ----- speech detection -----
  private floor = 300;
  private inSpeech = false;
  private speechFrames = 0;
  private silenceFrames = 0;
  private runFrames = 0;
  private utterance: Int16Array[] = [];
  private preRoll: Int16Array[] = [];
  private idleFrames = 0;
  private silencePrompts = 0;

  // ----- playback -----
  /** Sample index (on the caller timeline) when Ravi's queued audio ends. */
  private playEnd = 0;
  private gen = 0;
  private queue: Promise<void> = Promise.resolve();
  private busy = false;
  private interruptedNext = false;
  private ackCache = new Map<string, Int16Array>();
  private ackIdx = 0;
  private lang: "te" | "en" = "te";
  private hangupAt: number | null = null;

  constructor(private send: (m: Outgoing) => void, private deps: PhoneDeps) {}

  private now() { return this.callerSamples; }
  private speaking() { return this.playEnd > this.now(); }
  private log(s: string) { this.deps.log?.(s); }

  /** Call answered: pre-make the acknowledgements and say the opening. */
  async start() {
    const opening = this.deps.opening();
    const generation = this.gen;
    const [pcm] = await Promise.all([
      this.deps.tts(opening),
      ...[...this.deps.acks.te, ...this.deps.acks.en].map(async (a) => { try { this.ackCache.set(a, await this.deps.tts(a)); } catch { /* ack is optional */ } }),
    ]);
    if (this.closed || this.inSpeech || generation !== this.gen) return;
    this.transcript.push({ at: this.now(), who: "ravi", text: opening });
    this.play(pcm);
  }

  /** Queue audio to the phone line (and the recording). */
  private play(pcm: Int16Array) {
    if (this.closed || !pcm.length) return;
    const at = Math.max(this.now(), this.playEnd);
    this.agentTrack.push({ at, pcm });
    this.playEnd = at + pcm.length;
    for (let i = 0; i < pcm.length; i += FRAME * 10) this.send({ type: "audio", ulaw: pcmToUlaw(pcm.subarray(i, i + FRAME * 10)) });
  }

  /** Caller talked over Ravi: stop his audio now. */
  private bargeIn() {
    this.send({ type: "clear" });
    const cut = this.now();
    for (const t of this.agentTrack) if (t.at + t.pcm.length > cut) t.pcm = t.pcm.subarray(0, Math.max(0, cut - t.at));
    this.playEnd = cut;
    this.gen++; // drop audio still being prepared for the old reply
    this.interruptedNext = true;
    this.log(`[barge-in at ${(cut / 8000).toFixed(1)}s]`);
  }

  /** One 20 ms (or any size) frame of caller audio. */
  onAudio(ulaw: Uint8Array) {
    if (this.closed) return;
    const pcm = ulawToPcm(ulaw);
    this.callerPcm.push(pcm);
    this.callerSamples += pcm.length;
    if (this.hangupAt !== null && this.callerSamples >= this.hangupAt) { this.finish(); return; }
    const level = rms(pcm);
    const speakingNow = this.speaking();
    const threshold = Math.max(speakingNow ? 900 : 550, this.floor * (speakingNow ? 4 : 3));
    const voiced = level > threshold;
    if (!this.inSpeech) {
      // Background noise level: learned only from quiet frames (speech must never raise it).
      if (!voiced) this.floor = Math.min(1200, this.floor * 0.95 + level * 0.05);
      this.preRoll.push(pcm);
      if (this.preRoll.length > 15) this.preRoll.shift();
      this.runFrames = voiced ? this.runFrames + 1 : 0;
      // Start of speech: 60 ms of voice (120 ms while Ravi talks, to filter brief clicks).
      if (this.runFrames >= (speakingNow ? 6 : 3)) {
        this.inSpeech = true;
        this.utterance = [...this.preRoll];
        this.preRoll = [];
        this.speechFrames = this.runFrames;
        this.silenceFrames = 0;
        if (speakingNow) this.bargeIn();
      }
      // Long silence after Ravi finished: gently check the line.
      if (!speakingNow && !this.busy) {
        this.idleFrames++;
        if (ms(this.idleFrames) >= 9000) { this.idleFrames = 0; void this.handleUtterance(new Int16Array(0), true); }
      } else this.idleFrames = 0;
      return;
    }
    this.utterance.push(pcm);
    if (voiced) { this.speechFrames++; this.silenceFrames = 0; } else this.silenceFrames++;
    const total = this.utterance.length;
    // End of sentence: 700 ms of quiet after at least 300 ms of speech (or 15 s max).
    if ((this.silenceFrames >= 35 && this.speechFrames >= 15) || total >= 750) {
      const all = new Int16Array(this.utterance.reduce((n, a) => n + a.length, 0));
      let o = 0;
      for (const a of this.utterance) { all.set(a, o); o += a.length; }
      this.inSpeech = false;
      this.utterance = [];
      this.runFrames = 0;
      this.idleFrames = 0;
      void this.handleUtterance(all, false);
    } else if (this.silenceFrames >= 35) {
      // Too short to be speech (a click or a breath).
      this.inSpeech = false;
      this.utterance = [];
      this.runFrames = 0;
    }
  }

  private async handleUtterance(pcm: Int16Array, silence: boolean) {
    if (this.closed) return;
    const t0 = Date.now();
    const myGen = ++this.gen;
    const interrupted = this.interruptedNext;
    this.interruptedNext = false;
    this.busy = true;
    // Instant acknowledgement while we recognise and think.
    let ack: string | null = null;
    let ackAfterMs: number | null = null;
    if (!silence && this.deps.acks[this.lang].length && !this.inSpeech) {
      const list = this.deps.acks[this.lang];
      ack = list[this.ackIdx++ % list.length];
      const a = this.ackCache.get(ack);
      if (a) { this.play(a); ackAfterMs = Date.now() - t0; } else ack = null;
    }
    let text = "";
    const ts = Date.now();
    if (!silence) {
      try { text = (await this.deps.stt(pcm)).trim(); } catch (e) { this.log(`[stt failed: ${(e as Error).message}]`); }
      if (!text) { this.busy = false; return; } // noise: the ack was enough, keep listening
    }
    const sttMs = Date.now() - ts;
    if (myGen !== this.gen) { this.busy = false; return; } // caller spoke again meanwhile
    this.transcript.push({ at: this.now(), who: "caller", text: text || "(silence)" });
    this.log(`CALLER: ${text || "(silence)"}`);
    if (silence && ++this.silencePrompts > 3) { this.finish(); return; }
    let firstAudioAfterMs: number | null = null;
    const say = (s: string) => {
      const p = this.deps.tts(s);
      this.queue = this.queue.then(async () => {
        const audio = await p.catch(() => new Int16Array(0));
        if (myGen !== this.gen || this.closed || this.inSpeech) return;
        if (firstAudioAfterMs === null) firstAudioAfterMs = Date.now() - t0;
        this.play(audio);
      });
    };
    let first: string | null = null;
    const r = await this.deps.turn(text, interrupted, ack, (f) => { first = f; say(f); });
    if (myGen !== this.gen) { if (!first) this.deps.unheard?.(); this.busy = false; return; }
    if (r.lang) this.lang = r.lang;
    const rest = first && r.text.startsWith(first) ? r.text.slice((first as string).length).trim() : first ? "" : r.text;
    if (rest) say(rest);
    const full = `${ack ? `${ack} ` : ""}${r.text}`;
    this.transcript.push({ at: this.now(), who: "ravi", text: full });
    this.log(`RAVI  : ${full}`);
    await this.queue;
    this.timings.push({ said: text, reply: r.text, sttMs, ackAfterMs, firstAudioAfterMs, totalReplyMs: Date.now() - t0 });
    if (r.outcome) this.outcome = r.outcome;
    this.busy = false;
    if (r.closed && myGen === this.gen && !this.inSpeech) {
      // Let the goodbye finish (measured on the call's own audio clock), then hang up; a timer is the backup.
      this.hangupAt = this.playEnd + 4800;
      setTimeout(() => this.finish(), Math.max(0, ((this.playEnd - this.now()) / 8000) * 1000) + 4000);
    }
  }

  finish() {
    if (this.closed) return;
    this.log(`[hang up${process.env.PHONE_DEBUG ? ` ${new Error().stack}` : ""}]`);
    this.closed = true;
    this.send({ type: "hangup" });
  }

  /** Stereo recording: left = caller, right = Ravi. */
  recording(): { left: Int16Array; right: Int16Array } {
    const left = new Int16Array(this.callerSamples);
    let o = 0;
    for (const a of this.callerPcm) { left.set(a, o); o += a.length; }
    const end = Math.max(left.length, ...this.agentTrack.map((t) => t.at + t.pcm.length));
    const right = new Int16Array(end);
    for (const t of this.agentTrack) right.set(t.pcm.subarray(0, Math.max(0, end - t.at)), t.at);
    return { left, right };
  }
}
