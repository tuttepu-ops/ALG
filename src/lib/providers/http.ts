// Shared provider error classification + the single-retry rule for temporary rate limits.

export type ProviderErrorKind =
  | "not_configured"
  | "quota" // billing / credits exhausted — never retried
  | "rate_limit" // temporary — at most one retry, honouring Retry-After
  | "auth"
  | "timeout"
  | "network"
  | "http"
  | "bad_output";

export interface ProviderError {
  kind: ProviderErrorKind;
  status?: number;
  code?: string;
  message: string;
  retryAfterMs?: number;
}

/** Longest Retry-After we will wait inside a live voice turn. Longer → fail fast, no retry. */
export const MAX_RETRY_WAIT_MS = 3000;

const QUOTA_CODES = new Set([
  // OpenAI
  "insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached", "billing_not_active",
  // Sarvam
  "insufficient_quota_error",
]);

/** Parse Retry-After style headers into milliseconds. */
export function retryAfterMs(h: Headers): number | undefined {
  const ms = h.get("retry-after-ms");
  if (ms && !Number.isNaN(Number(ms))) return Number(ms);
  const ra = h.get("retry-after");
  if (ra) {
    if (!Number.isNaN(Number(ra))) return Number(ra) * 1000;
    const date = Date.parse(ra);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  // OpenAI also sends e.g. x-ratelimit-reset-requests: "1s", "6m0s", "20ms"
  for (const k of ["x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"]) {
    const v = h.get(k);
    if (v) {
      const parsed = parseDuration(v);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

function parseDuration(v: string): number | undefined {
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let total = 0;
  let any = false;
  for (const m of v.matchAll(re)) {
    any = true;
    const n = Number(m[1]);
    total += m[2] === "ms" ? n : m[2] === "s" ? n * 1000 : m[2] === "m" ? n * 60000 : n * 3600000;
  }
  return any ? total : undefined;
}

/** Turn a non-2xx response into a typed error. Reads the provider's error code for 429. */
export async function classifyHttpError(res: Response): Promise<ProviderError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  const err = (body as { error?: { code?: string; type?: string; message?: string } } | null)?.error ?? {};
  const code = err.code || err.type || undefined;
  const message = (err.message || res.statusText || `HTTP ${res.status}`).slice(0, 300);
  const isQuota = (err.code && QUOTA_CODES.has(err.code)) || (err.type && QUOTA_CODES.has(err.type)) || res.status === 402;
  if (isQuota) return { kind: "quota", status: res.status, code, message };
  if (res.status === 429) return { kind: "rate_limit", status: 429, code, message, retryAfterMs: retryAfterMs(res.headers) };
  if (res.status === 401 || res.status === 403) return { kind: "auth", status: res.status, code, message };
  return { kind: "http", status: res.status, code, message };
}

export interface FetchOutcome {
  res?: Response;
  error?: ProviderError;
  retried: boolean;
  /** Error from the first attempt when a retry happened. */
  firstError?: ProviderError;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with a timeout and the retry policy:
 *  - quota/billing errors: no retry
 *  - temporary rate limit (429): one retry after Retry-After (only if ≤ MAX_RETRY_WAIT_MS)
 *  - everything else: no retry
 */
export async function fetchWithPolicy(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchOutcome> {
  let retried = false;
  let firstError: ProviderError | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error)?.name === "AbortError";
      return {
        error: { kind: aborted ? "timeout" : "network", message: aborted ? `timed out after ${timeoutMs} ms` : String((e as Error)?.message ?? e) },
        retried,
        firstError,
      };
    }
    clearTimeout(timer);
    if (res.ok) return { res, retried, firstError };
    const error = await classifyHttpError(res);
    const wait = error.retryAfterMs ?? 1000;
    if (attempt === 0 && error.kind === "rate_limit" && wait <= MAX_RETRY_WAIT_MS) {
      firstError = error;
      retried = true;
      await sleep(wait);
      continue;
    }
    return { error, retried, firstError };
  }
  return { error: { kind: "http", message: "unreachable" }, retried, firstError };
}

/** Customer-safe one-liner for the diagnostics panel. Never claims success. */
export function describeError(e: ProviderError, provider: string): string {
  switch (e.kind) {
    case "quota":
      return `${provider}: billing/quota exhausted (${e.code ?? e.status}). Add credits — not retried.`;
    case "rate_limit":
      return `${provider}: temporary rate limit${e.retryAfterMs !== undefined ? ` (retry-after ${Math.round(e.retryAfterMs)} ms)` : ""}.`;
    case "auth":
      return `${provider}: key rejected (${e.status}).`;
    case "not_configured":
      return `${provider}: API key not configured on the server.`;
    case "timeout":
      return `${provider}: ${e.message}.`;
    default:
      return `${provider}: ${e.kind} ${e.status ?? ""} ${e.message}`.trim();
  }
}
