// Provider usage + cost estimate per session. Shared by browser and server (no Node imports).
// Prices: OpenAI gpt-5.4-mini model page; Sarvam pricing page (pay-as-you-go), Nov 2026.

export const PRICES = {
  openai: {
    "gpt-5.4-mini": { inputUsdPer1M: 0.75, cachedInputUsdPer1M: 0.075, outputUsdPer1M: 4.5 },
    "gpt-5.4-nano": { inputUsdPer1M: 0.2, cachedInputUsdPer1M: 0.02, outputUsdPer1M: 1.25 },
  } as Record<string, { inputUsdPer1M: number; cachedInputUsdPer1M: number; outputUsdPer1M: number }>,
  /** ₹ per 1,000 characters */
  sarvamTtsInrPer1k: { "bulbul:v4-flash": 1.0, "bulbul:v3": 3.0, "voice-clone": 2.0 } as Record<string, number>,
  /** ₹ per minute, billed per second, rounded up per request */
  sarvamSttInrPerMin: 0.49,
};

export interface SessionUsage {
  turns: number;
  workflowTurns: number;
  openaiTurns: number;
  llmRequests: number; // HTTP requests actually sent (a retry counts)
  llmFailures: number;
  llmInputTokens: number;
  llmCachedInputTokens: number;
  llmOutputTokens: number;
  ttsCharsBilled: number; // characters sent to Sarvam
  ttsCharsReused: number; // characters served from a cache instead
  ttsSarvamRequests: number;
  ttsCacheHits: number;
  ttsFailures: number;
  deviceVoiceSegments: number;
  sttRequests: number;
  sttSecondsBilled: number;
  sttFailures: number;
  sessionSeconds: number;
}

export const emptyUsage = (): SessionUsage => ({
  turns: 0, workflowTurns: 0, openaiTurns: 0, llmRequests: 0, llmFailures: 0, llmInputTokens: 0,
  llmCachedInputTokens: 0, llmOutputTokens: 0, ttsCharsBilled: 0, ttsCharsReused: 0, ttsSarvamRequests: 0,
  ttsCacheHits: 0, ttsFailures: 0, deviceVoiceSegments: 0, sttRequests: 0, sttSecondsBilled: 0, sttFailures: 0,
  sessionSeconds: 0,
});

export interface CostBreakdown {
  llmInr: number;
  ttsInr: number;
  sttInr: number;
  totalInr: number;
  perMinuteInr: number | null;
}

export function costInr(u: SessionUsage, opts: { model: string; ttsModel: string; usdInr: number }): CostBreakdown {
  const p = PRICES.openai[opts.model] ?? PRICES.openai["gpt-5.4-mini"];
  const uncached = Math.max(0, u.llmInputTokens - u.llmCachedInputTokens);
  const llmUsd =
    (uncached * p.inputUsdPer1M + u.llmCachedInputTokens * p.cachedInputUsdPer1M + u.llmOutputTokens * p.outputUsdPer1M) / 1e6;
  const llmInr = llmUsd * opts.usdInr;
  const ttsInr = (u.ttsCharsBilled / 1000) * (PRICES.sarvamTtsInrPer1k[opts.ttsModel] ?? 1.0);
  const sttInr = (u.sttSecondsBilled / 60) * PRICES.sarvamSttInrPerMin;
  const totalInr = llmInr + ttsInr + sttInr;
  return {
    llmInr, ttsInr, sttInr, totalInr,
    perMinuteInr: u.sessionSeconds > 0 ? totalInr / (u.sessionSeconds / 60) : null,
  };
}

export const inr = (n: number) => `₹${n < 0.1 ? n.toFixed(4) : n.toFixed(2)}`;
