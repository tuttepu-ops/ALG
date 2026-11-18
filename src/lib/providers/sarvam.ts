// Sarvam Bulbul (speech playback) and Saaras (speech recognition) over REST.

import { getConfig, type VoiceSettings } from "../config";
import { describeError, fetchWithPolicy, type ProviderError } from "./http";
import { createHash } from "node:crypto";
import { isEnglishReply } from "../telugu/speech";

/** Sarvam bills TTS per character; count Unicode code points (what we send). */
export function billableChars(text: string): number {
  return [...text].length;
}

/** Cache key: identical text + identical voice settings → identical audio. */
export function ttsKey(text: string, v: VoiceSettings, sampleRate: number, codec: string): string {
  return createHash("sha256")
    .update(JSON.stringify([v.model, v.speaker, v.pace, "te-IN", sampleRate, codec, text]))
    .digest("hex")
    .slice(0, 32);
}

export interface TtsResult {
  ok: boolean;
  audio?: Buffer;
  mime?: string;
  chars: number;
  requestId?: string;
  latencyMs: number;
  retried: boolean;
  error?: ProviderError & { summary: string };
}

/** Phone calls need 8 kHz audio; the browser uses the configured rate/codec. */
export interface TtsFormat { codec?: string; sampleRate?: number }

export async function sarvamTts(text: string, voice: VoiceSettings, fetchImpl: typeof fetch = fetch, format: TtsFormat = {}): Promise<TtsResult> {
  const cfg = getConfig();
  const chars = billableChars(text);
  if (!cfg.sarvamKey) {
    const e: ProviderError = { kind: "not_configured", message: "SARVAM_API_KEY missing" };
    return { ok: false, chars: 0, latencyMs: 0, retried: false, error: { ...e, summary: describeError(e, "Sarvam TTS") } };
  }
  const clone = voice.model === "voice-clone";
  const headers = { "api-subscription-key": cfg.sarvamKey };
  const options = {
    text,
    // English replies (no Telugu letters) are spoken with the English model settings.
    language_code: isEnglishReply(text) ? "en-IN" : "te-IN",
    pace: voice.pace,
    speech_sample_rate: format.sampleRate ?? cfg.ttsSampleRate,
    output_audio_codec: format.codec ?? cfg.ttsCodec,
  };
  const form = new FormData();
  if (clone) {
    form.set("voice_id", voice.speaker);
    for (const [key, value] of Object.entries(options)) form.set(key, String(value));
  }
  const t0 = Date.now();
  if (clone) {
    // Cloned voice: the streaming endpoint returns the whole reply in ~1 s (the JSON endpoint
    // takes ~3 s), so each reply stays one natural take instead of stitched sentences.
    // `pace` is honoured here although Sarvam's docs don't list it (measured: 0.85 → slower).
    const s = await fetchWithPolicy(`${cfg.sarvamBaseUrl}/voices/clone/stream`, { method: "POST", headers, body: form }, 15000, fetchImpl);
    if (s.res && !s.error && (s.res.headers.get("content-type") ?? "").startsWith("audio")) {
      const audio = Buffer.from(await s.res.arrayBuffer());
      if (audio.length > 0) {
        return { ok: true, audio, mime: "audio/mpeg", chars, requestId: s.res.headers.get("request-id") ?? undefined, latencyMs: Date.now() - t0, retried: s.retried };
      }
    }
    // Stream unavailable → fall back to the JSON endpoint below.
  }
  const out = await fetchWithPolicy(
    `${cfg.sarvamBaseUrl}${clone ? "/voices/clone" : "/text-to-speech"}`,
    clone
      ? { method: "POST", headers, body: form }
      : {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ...options, model: voice.model, speaker: voice.speaker }),
      },
    15000,
    fetchImpl,
  );
  const latencyMs = Date.now() - t0;
  if (out.error || !out.res) {
    const e = out.error!;
    return { ok: false, chars: 0, latencyMs, retried: out.retried, error: { ...e, summary: describeError(e, "Sarvam TTS") } };
  }
  const body = (await out.res.json().catch(() => null)) as { request_id?: string; audios?: string[]; audio_b64?: string } | null;
  const b64 = clone ? body?.audio_b64 : body?.audios?.[0];
  if (!b64) {
    const e: ProviderError = { kind: "bad_output", message: "no audio in response" };
    return { ok: false, chars, latencyMs, retried: out.retried, error: { ...e, summary: describeError(e, "Sarvam TTS") } };
  }
  return {
    ok: true,
    audio: Buffer.from(b64, "base64"),
    mime: "audio/mpeg",
    chars,
    requestId: body?.request_id,
    latencyMs,
    retried: out.retried,
  };
}

export interface SttResult {
  ok: boolean;
  transcript: string;
  languageCode: string | null;
  requestId?: string;
  model: string;
  mode: string;
  latencyMs: number;
  retried: boolean;
  error?: ProviderError & { summary: string };
}

export async function sarvamStt(audio: Blob, filename: string, fetchImpl: typeof fetch = fetch): Promise<SttResult> {
  const cfg = getConfig();
  const base = { model: cfg.sttModel, mode: cfg.sttMode, transcript: "", languageCode: null, retried: false };
  if (!cfg.sarvamKey) {
    const e: ProviderError = { kind: "not_configured", message: "SARVAM_API_KEY missing" };
    return { ...base, ok: false, latencyMs: 0, error: { ...e, summary: describeError(e, "Sarvam STT") } };
  }
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", cfg.sttModel);
  form.append("language_code", cfg.sttLanguage);
  if (cfg.sttModel.startsWith("saaras:v3")) form.append("mode", cfg.sttMode);
  const t0 = Date.now();
  const out = await fetchWithPolicy(
    `${cfg.sarvamBaseUrl}/speech-to-text`,
    { method: "POST", headers: { "api-subscription-key": cfg.sarvamKey }, body: form },
    20000,
    fetchImpl,
  );
  const latencyMs = Date.now() - t0;
  if (out.error || !out.res) {
    const e = out.error!;
    return { ...base, ok: false, latencyMs, retried: out.retried, error: { ...e, summary: describeError(e, "Sarvam STT") } };
  }
  const body = (await out.res.json().catch(() => null)) as { transcript?: string; language_code?: string; request_id?: string } | null;
  if (!body || typeof body.transcript !== "string") {
    const e: ProviderError = { kind: "bad_output", message: "no transcript in response" };
    return { ...base, ok: false, latencyMs, retried: out.retried, error: { ...e, summary: describeError(e, "Sarvam STT") } };
  }
  return {
    ...base,
    ok: true,
    transcript: body.transcript.trim(),
    languageCode: body.language_code ?? null,
    requestId: body.request_id,
    latencyMs,
    retried: out.retried,
  };
}
