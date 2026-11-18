"use client";
// Call sound: makes the agent sound like a person on a phone in a hospital front office.
//  - Ambience: a quiet looping room sound (murmur, keyboard, room tone) under the whole call,
//    also while the caller speaks, the way a real office line never goes fully silent.
//  - Phone line: band-limits the agent's voice to 300–3400 Hz like a real call. This also hides
//    the clean "studio" quality that makes synthetic speech feel artificial.
// Everything runs in the browser (Web Audio); the voice audio and its cost are unchanged.

export interface CallSoundSettings {
  ambience: boolean;
  /** 0..1 — level of the room sound under the voice. */
  ambienceLevel: number;
  phoneLine: boolean;
}

export const DEFAULT_CALL_SOUND: CallSoundSettings = { ambience: true, ambienceLevel: 0.35, phoneLine: true };

const AMBIENCE_URL = "/ambience/hospital-office.mp3";

export class CallSound {
  private ctx: AudioContext | null = null;
  private ambienceBuf: AudioBuffer | null = null;
  private ambienceSrc: AudioBufferSourceNode | null = null;
  private ambienceGain: GainNode | null = null;
  private voiceSrc: MediaElementAudioSourceNode | null = null;
  private voiceEl: HTMLAudioElement | null = null;
  private lineIn: AudioNode | null = null;
  private settings: CallSoundSettings = { ...DEFAULT_CALL_SOUND };
  private wantAmbience = false;

  /** Call inside a tap (browsers only allow audio to start from a user gesture). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.ambienceGain = this.ctx.createGain();
      this.ambienceGain.gain.value = 0;
      this.ambienceGain.connect(this.ctx.destination);
      // Phone line: high-pass 300 Hz → low-pass 3400 Hz → light compression, like a handset.
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 300; hp.Q.value = 0.7;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 3400; lp.Q.value = 0.7;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -24; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.15;
      const makeup = this.ctx.createGain();
      makeup.gain.value = 1.25;
      hp.connect(lp).connect(comp).connect(makeup).connect(this.ctx.destination);
      this.lineIn = hp;
    }
    void this.ctx.resume().catch(() => {});
    if (!this.ambienceBuf) void this.load();
  }

  private async load() {
    try {
      const r = await fetch(AMBIENCE_URL);
      const data = await r.arrayBuffer();
      this.ambienceBuf = await new Promise<AudioBuffer>((res, rej) => this.ctx!.decodeAudioData(data, res, rej));
      if (this.wantAmbience) this.startAmbience();
    } catch {
      /* no ambience: the call still works */
    }
  }

  /** Route the agent's <audio> element through the phone-line filter (once per element). */
  attachVoice(el: HTMLAudioElement | null) {
    if (!el || !this.ctx || this.voiceEl === el) return;
    try {
      this.voiceSrc = this.ctx.createMediaElementSource(el);
      this.voiceEl = el;
      this.routeVoice();
    } catch {
      /* some browsers refuse; the voice then plays unfiltered */
    }
  }

  private routeVoice() {
    if (!this.voiceSrc || !this.ctx) return;
    this.voiceSrc.disconnect();
    this.voiceSrc.connect(this.settings.phoneLine && this.lineIn ? this.lineIn : this.ctx.destination);
  }

  set(s: Partial<CallSoundSettings>) {
    this.settings = { ...this.settings, ...s };
    this.routeVoice();
    if (this.ambienceGain && this.ctx) {
      const target = this.wantAmbience && this.settings.ambience ? this.settings.ambienceLevel * 0.6 : 0;
      this.ambienceGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
    }
  }

  /** Start the room sound for a call (fades in). */
  startAmbience() {
    this.wantAmbience = true;
    if (!this.ctx || !this.ambienceBuf || !this.ambienceGain) return;
    if (!this.ambienceSrc) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.ambienceBuf;
      src.loop = true;
      src.connect(this.ambienceGain);
      // Start somewhere random in the loop so every call sounds a little different.
      src.start(0, Math.random() * this.ambienceBuf.duration);
      this.ambienceSrc = src;
    }
    this.set({});
  }

  /** End of call: fade the room sound out. */
  stopAmbience() {
    this.wantAmbience = false;
    if (!this.ctx || !this.ambienceGain) return;
    this.ambienceGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    const src = this.ambienceSrc;
    this.ambienceSrc = null;
    if (src) setTimeout(() => { try { src.stop(); } catch { /* already stopped */ } }, 1500);
  }
}
