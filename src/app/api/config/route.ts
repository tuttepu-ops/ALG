import { getConfig } from "@/lib/config";
import { pilotRequired } from "@/lib/auth";
import { getStore } from "@/lib/storage/store";
import { PRICES } from "@/lib/usage";

export const dynamic = "force-dynamic";

// Public, non-secret configuration for the dashboard (never includes key values).
export async function GET() {
  const cfg = getConfig();
  const store = getStore();
  return Response.json({
    pilotRequired: pilotRequired(),
    // Lets the gate explain a rejected code without revealing the code itself.
    pilotHint: !cfg.pilotCode ? "none" : cfg.pilotCode === "change-me" ? "placeholder" : "set",
    providers: { openaiKeySet: !!cfg.openaiKey, sarvamKeySet: !!cfg.sarvamKey },
    llm: { model: cfg.openaiModel, effort: cfg.openaiEffort, maxOutputTokens: cfg.openaiMaxOutputTokens },
    stt: { provider: "Sarvam", model: cfg.sttModel, mode: cfg.sttMode, language: cfg.sttLanguage },
    voices: cfg.voices,
    defaultVoice: cfg.defaultVoice,
    storage: { kind: store.kind, persistent: store.kind !== "memory" },
    usdInr: cfg.usdInr,
    prices: PRICES,
  });
}
