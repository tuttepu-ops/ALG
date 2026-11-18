// Server-side configuration. API keys are read only on the server and never sent to the browser.

export interface VoiceOption {
  id: string; // speaker id sent to Sarvam
  model: "bulbul:v4-flash" | "bulbul:v3" | "voice-clone";
  label: string;
  inrPer1kChars: number;
}

/** Telugu-capable stock voices offered in the audition panel (from Sarvam's catalog). */
export const VOICES: VoiceOption[] = [
  { id: "kavitha_te_conversation", model: "bulbul:v4-flash", label: "Kavitha · conversation (v4 Flash)", inrPer1kChars: 1.0 },
  { id: "pooja_te_conversation", model: "bulbul:v4-flash", label: "Pooja · conversation (v4 Flash)", inrPer1kChars: 1.0 },
  { id: "kavitha_te_narration", model: "bulbul:v4-flash", label: "Kavitha · narration (v4 Flash)", inrPer1kChars: 1.0 },
  { id: "tarun_te_narration", model: "bulbul:v4-flash", label: "Tarun · narration (v4 Flash, male)", inrPer1kChars: 1.0 },
  { id: "kavitha", model: "bulbul:v3", label: "Kavitha (v3)", inrPer1kChars: 3.0 },
  { id: "priya", model: "bulbul:v3", label: "Priya (v3)", inrPer1kChars: 3.0 },
  { id: "roopa", model: "bulbul:v3", label: "Roopa (v3)", inrPer1kChars: 3.0 },
];

export interface VoiceSettings {
  model: VoiceOption["model"];
  speaker: string;
  pace: number;
}

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export function getConfig() {
  const e = process.env;
  const cloneId = e.SARVAM_CLONE_VOICE_ID?.trim();
  const clone: VoiceOption | undefined = cloneId && /^svc-[a-f0-9-]{36}$/i.test(cloneId)
    ? { id: cloneId, model: "voice-clone", label: "Sarvam cloned voice", inrPer1kChars: 2 }
    : undefined;
  const voices = clone ? [...VOICES, clone] : VOICES;
  const defaultSpeaker = clone?.id || e.SARVAM_TTS_SPEAKER || "kavitha_te_conversation";
  const defaultVoice = voices.find((v) => v.id === defaultSpeaker) ?? VOICES[0];
  return {
    openaiKey: e.OPENAI_API_KEY || "",
    openaiModel: e.OPENAI_MODEL || "gpt-5.4-mini",
    openaiEffort: e.OPENAI_REASONING_EFFORT || "none",
    openaiMaxOutputTokens: num(e.OPENAI_MAX_OUTPUT_TOKENS, 60),
    openaiTimeoutMs: num(e.OPENAI_TIMEOUT_MS, 8000),
    openaiBaseUrl: e.OPENAI_BASE_URL || "https://api.openai.com/v1",
    /** Hospital calls: "ai" = the model writes every reply (Ravi); "rules" = the fixed-line workflow. */
    hospitalEngine: (e.HOSPITAL_ENGINE === "rules" ? "rules" : "ai") as "ai" | "rules",
    /** The model that talks to callers. Quality first; see README for the comparison. */
    agentModel: e.AGENT_MODEL || "gpt-5.5",
    agentEffort: e.AGENT_REASONING_EFFORT || "none",
    agentTimeoutMs: num(e.AGENT_TIMEOUT_MS, 15000),
    sarvamKey: e.SARVAM_API_KEY || "",
    sarvamBaseUrl: e.SARVAM_BASE_URL || "https://api.sarvam.ai",
    voices,
    defaultVoice: {
      model: clone ? clone.model : (e.SARVAM_TTS_MODEL as VoiceOption["model"]) || defaultVoice.model,
      speaker: defaultVoice.id,
      pace: num(e.SARVAM_TTS_PACE, 1.0),
    } satisfies VoiceSettings,
    /** 24000 for laptop listening; 8000 to hear roughly what a phone line will sound like. */
    /** How common English words are sent to Sarvam: "telugu" (అపాయింట్మెంట్) or "roman" (appointment). */
    englishAs: (e.SARVAM_ENGLISH_WORDS === "roman" ? "roman" : "telugu") as "roman" | "telugu",
    /** How numbers are spoken: "english" (default, Tenglish: "టెన్ థర్టీ", "ఫోర్ హండ్రెడ్ రుపీస్") or "telugu" ("పదిన్నర", "నాలుగు వందల రూపాయలు"). */
    numbersAs: (e.SPEECH_NUMBERS === "telugu" ? "telugu" : "english") as "english" | "telugu",
    ttsSampleRate: [8000, 16000, 22050, 24000].includes(num(e.SARVAM_TTS_SAMPLE_RATE, 24000)) ? num(e.SARVAM_TTS_SAMPLE_RATE, 24000) : 24000,
    ttsCodec: "mp3" as const,
    sttModel: e.SARVAM_STT_MODEL || "saaras:v3",
    sttMode: e.SARVAM_STT_MODE || "codemix",
    sttLanguage: e.SARVAM_STT_LANGUAGE || "te-IN",
    // Trimmed and unquoted, so `PILOT_ACCESS_CODE="abc "` and `abc` behave the same.
    pilotCode: (e.PILOT_ACCESS_CODE || "").trim().replace(/^["']|["']$/g, "").trim(),
    sessionSecret: e.SESSION_SECRET || "",
    usdInr: num(e.USD_INR, 88),
    isVercel: !!e.VERCEL,
    isProd: e.NODE_ENV === "production",
  };
}

export type AppConfig = ReturnType<typeof getConfig>;

/** Validate a voice requested by the browser against the allowlist. */
export function resolveVoice(req: Partial<VoiceSettings> | undefined, cfg = getConfig()): VoiceSettings {
  const v = cfg.voices.find((x) => x.id === req?.speaker);
  const pace = typeof req?.pace === "number" && req.pace >= 0.8 && req.pace <= 1.2 ? req.pace : cfg.defaultVoice.pace;
  if (!v) return { ...cfg.defaultVoice, pace };
  return { model: v.model, speaker: v.id, pace };
}
