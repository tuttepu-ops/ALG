// One small OpenAI request per ambiguous reply. The model only labels intent and extracts
// a short detail; order data, transcripts and workflow rules stay in the app.

import { getConfig } from "../config";
import { extractTime } from "../workflow/time";
import type { Intent, Interpretation, Stage } from "../workflow/types";
import { describeError, fetchWithPolicy, type ProviderError } from "./http";

export const LLM_INTENTS = [
  "greet", "permit", "permit_why", "why", "who", "confirm", "no", "change", "cancel", "callback", "time",
  "no_time", "end", "hold", "repeat", "q_total", "q_items", "q_delivery", "q_other", "unclear",
] as const satisfies readonly Intent[];

/** Stable, concise instruction (kept identical across calls). */
export const INSTRUCTIONS = `Label one customer reply in a Telugu/English phone call from Godavari Basket (Andhra sweets & pickles shop) confirming a food order. Replies may be Telugu script, Romanized Telugu, English or mixed, with speech-recognition errors.
Stage = what the agent just asked: opening=may we talk now; confirm=read the order, asked to confirm; change_details=asked what to change; change_readback/cancel_readback=read back a request, asked yes/no; callback_time=asked when to call back.
i: permit=ok to talk; permit_why=ok to talk and asks purpose; why=asks why/what about; who=asks who is calling; greet=only a greeting; confirm=clear yes to what was just asked; no=plain no; change=wants items/qty/address changed; cancel=cancel whole order; callback=busy/call later; time=gives a time; no_time=won't give a time; end=wants to hang up now; hold=asks to wait; repeat=didn't hear; q_total/q_items/q_delivery=asks total/items/delivery; q_other=other question; unclear=noise or can't tell.
d: for change, a short summary of the requested change, max 12 words, item and quantity included, merged with the pending request if given, written in Telugu script with English words kept in English letters (e.g. "కాజా తీసేయాలి, పూతరేకులు ఇంకో box add చేయాలి"); for time/callback, the time in the customer's words; else null.
Use confirm only for explicit agreement; if unsure use unclear.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["i", "d"],
  properties: {
    i: { type: "string", enum: LLM_INTENTS },
    d: { type: ["string", "null"] },
  },
} as const;

export interface LlmUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface LlmDiag {
  called: boolean;
  ok: boolean;
  model: string;
  effort: string;
  maxOutputTokens: number;
  latencyMs: number;
  retried: boolean;
  usage: LlmUsage | null;
  error?: ProviderError & { summary: string };
  firstError?: ProviderError;
  /** Raw structured output (for debugging the Telugu examples). */
  raw?: string;
}

export interface LlmResult {
  interp: Interpretation | null;
  diag: LlmDiag;
}

/** The compact per-call input: stage, optional pending detail, utterance. Nothing else. */
export function buildInput(stage: Stage, utterance: string, pending: string | null): string {
  const lines = [`stage: ${stage}`];
  if (pending) lines.push(`pending: ${pending}`);
  lines.push(`reply: ${utterance.trim().slice(0, 300)}`);
  return lines.join("\n");
}

export function buildRequestBody(stage: Stage, utterance: string, pending: string | null, cfg = getConfig()) {
  return {
    model: cfg.openaiModel,
    instructions: INSTRUCTIONS,
    input: buildInput(stage, utterance, pending),
    reasoning: { effort: cfg.openaiEffort },
    max_output_tokens: cfg.openaiMaxOutputTokens,
    store: false,
    text: { format: { type: "json_schema", name: "reply_label", strict: true, schema: SCHEMA } },
  };
}

interface ResponsesApiBody {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
}

export async function interpretWithLlm(
  stage: Stage,
  utterance: string,
  pending: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LlmResult> {
  const cfg = getConfig();
  const base: LlmDiag = {
    called: false, ok: false, model: cfg.openaiModel, effort: cfg.openaiEffort,
    maxOutputTokens: cfg.openaiMaxOutputTokens, latencyMs: 0, retried: false, usage: null,
  };
  if (!cfg.openaiKey) {
    const e: ProviderError = { kind: "not_configured", message: "OPENAI_API_KEY missing" };
    return { interp: null, diag: { ...base, error: { ...e, summary: describeError(e, "OpenAI") } } };
  }

  const t0 = Date.now();
  const out = await fetchWithPolicy(
    `${cfg.openaiBaseUrl}/responses`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody(stage, utterance, pending, cfg)),
    },
    cfg.openaiTimeoutMs,
    fetchImpl,
  );
  const diag: LlmDiag = { ...base, called: true, latencyMs: Date.now() - t0, retried: out.retried, firstError: out.firstError };
  if (out.error || !out.res) {
    const e = out.error!;
    return { interp: null, diag: { ...diag, error: { ...e, summary: describeError(e, "OpenAI") } } };
  }

  let body: ResponsesApiBody;
  try {
    body = (await out.res.json()) as ResponsesApiBody;
  } catch {
    const e: ProviderError = { kind: "bad_output", message: "response was not JSON" };
    return { interp: null, diag: { ...diag, error: { ...e, summary: describeError(e, "OpenAI") } } };
  }
  diag.usage = {
    inputTokens: body.usage?.input_tokens ?? 0,
    cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    reasoningTokens: body.usage?.output_tokens_details?.reasoning_tokens ?? 0,
  };
  const text = body.output?.find((o) => o.type === "message")?.content?.find((c) => c.type === "output_text")?.text;
  diag.raw = text;
  if (body.status === "incomplete" || !text) {
    const e: ProviderError = {
      kind: "bad_output",
      message: `incomplete output (${body.incomplete_details?.reason ?? "no text"}) — raise OPENAI_MAX_OUTPUT_TOKENS`,
    };
    return { interp: null, diag: { ...diag, error: { ...e, summary: describeError(e, "OpenAI") } } };
  }
  let parsed: { i?: string; d?: string | null };
  try {
    parsed = JSON.parse(text);
  } catch {
    const e: ProviderError = { kind: "bad_output", message: `unparseable: ${text.slice(0, 80)}` };
    return { interp: null, diag: { ...diag, error: { ...e, summary: describeError(e, "OpenAI") } } };
  }
  if (!parsed.i || !(LLM_INTENTS as readonly string[]).includes(parsed.i)) {
    const e: ProviderError = { kind: "bad_output", message: `unknown intent: ${parsed.i}` };
    return { interp: null, diag: { ...diag, error: { ...e, summary: describeError(e, "OpenAI") } } };
  }
  diag.ok = true;
  return { interp: toInterpretation(parsed.i as Intent, parsed.d ?? null), diag };
}

// ---------- hospital visiting-doctor call ----------
export const HOSPITAL_INTENTS = [
  "yes", "no", "is_patient", "relative", "wrong_person", "not_home", "busy", "book", "date", "first_free", "name",
  "q_fee", "q_where", "q_when", "q_doctor", "q_bring", "q_medical", "q_other", "other_day",
  "emergency", "do_not_call", "not_interested", "bye", "hold", "repeat", "robot", "unclear",
] as const;
export type HospitalIntent = (typeof HOSPITAL_INTENTS)[number];

export const HOSPITAL_INSTRUCTIONS = `Label one caller reply in a phone call with Sai Viswas Hospital's booking agent. A cardiologist (Dr. Viswanath) visits on a few dates; the agent books a date. Calls are outbound (agent calls a patient) or inbound (anyone calls the hospital). Replies may be Telugu script, Romanized Telugu, English or mixed, with speech-recognition errors.
You get: step (open=inbound, asked how it can help; identify=asked if this is the patient; offer=asked to book; date=asked which date; name=asked the patient's name; readback=read the booking, asked to confirm; rebook=asked change date or not now), the agent's last line, and the reply.
i: yes=agrees to what was asked; no=declines; is_patient=says they are the patient; relative=family member answering or booking for family; wrong_person=wrong number/doesn't know the patient; not_home=patient not there; busy=call later; book=wants an appointment; date=picks a visit date; first_free=any/earliest date; name=gives a person's name; q_fee/q_where/q_when/q_doctor/q_bring=asks fee/location/dates-timings/which doctor/what to bring; q_medical=asks medical advice; q_other=any other question; other_day=those dates don't work; emergency=severe symptoms happening right now (not past or occasional); do_not_call=never call again; not_interested=refuses; bye=ending the call politely; hold=asks to wait; repeat=didn't hear; robot=asks if this is a robot/AI/real person; unclear=noise or can't tell.
d: for date, the day of the month as a number (e.g. "22"); for name, the name only; for q_other, the question in short English (max 12 words); else null.
Negations matter ("noppi ledu" = no pain). Use yes only for clear agreement; if unsure use unclear.`;

const HOSPITAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["i", "d"],
  properties: { i: { type: "string", enum: HOSPITAL_INTENTS }, d: { type: ["string", "null"] } },
} as const;

export interface HospitalLlmResult {
  label: { intent: HospitalIntent; detail: string | null } | null;
  diag: LlmDiag;
}

export function buildHospitalInput(step: string, agentLine: string, utterance: string): string {
  return `step: ${step}\nagent: ${agentLine.slice(-220)}\nreply: ${utterance.trim().slice(0, 300)}`;
}

export async function interpretHospitalWithLlm(
  step: string,
  agentLine: string,
  utterance: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HospitalLlmResult> {
  const cfg = getConfig();
  const base: LlmDiag = {
    called: false, ok: false, model: cfg.openaiModel, effort: cfg.openaiEffort,
    maxOutputTokens: cfg.openaiMaxOutputTokens, latencyMs: 0, retried: false, usage: null,
  };
  const fail = (diag: LlmDiag, e: ProviderError): HospitalLlmResult => ({ label: null, diag: { ...diag, error: { ...e, summary: describeError(e, "OpenAI") } } });
  if (!cfg.openaiKey) return fail(base, { kind: "not_configured", message: "OPENAI_API_KEY missing" });
  const t0 = Date.now();
  const out = await fetchWithPolicy(
    `${cfg.openaiBaseUrl}/responses`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.openaiModel,
        instructions: HOSPITAL_INSTRUCTIONS,
        input: buildHospitalInput(step, agentLine, utterance),
        reasoning: { effort: cfg.openaiEffort },
        max_output_tokens: cfg.openaiMaxOutputTokens,
        store: false,
        text: { format: { type: "json_schema", name: "hospital_reply_label", strict: true, schema: HOSPITAL_SCHEMA } },
      }),
    },
    cfg.openaiTimeoutMs,
    fetchImpl,
  );
  const diag: LlmDiag = { ...base, called: true, latencyMs: Date.now() - t0, retried: out.retried, firstError: out.firstError };
  if (out.error || !out.res) return fail(diag, out.error!);
  const body = (await out.res.json().catch(() => null)) as ResponsesApiBody | null;
  if (!body) return fail(diag, { kind: "bad_output", message: "response was not JSON" });
  diag.usage = {
    inputTokens: body.usage?.input_tokens ?? 0,
    cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    reasoningTokens: body.usage?.output_tokens_details?.reasoning_tokens ?? 0,
  };
  const text = body.output?.find((o) => o.type === "message")?.content?.find((c) => c.type === "output_text")?.text;
  diag.raw = text;
  if (!text) return fail(diag, { kind: "bad_output", message: "no text" });
  try {
    const p = JSON.parse(text) as { i?: string; d?: string | null };
    if (!p.i || !(HOSPITAL_INTENTS as readonly string[]).includes(p.i)) return fail(diag, { kind: "bad_output", message: `unknown intent: ${p.i}` });
    diag.ok = true;
    return { label: { intent: p.i as HospitalIntent, detail: p.d?.trim() || null }, diag };
  } catch {
    return fail(diag, { kind: "bad_output", message: `unparseable: ${text.slice(0, 80)}` });
  }
}

/** Validate the model's labels into an app Interpretation (the app decides what they mean). */
export function toInterpretation(intent: Intent, detail: string | null): Interpretation {
  const interp: Interpretation = { intent, source: "openai", detail: null };
  const d = detail?.trim() || null;
  if ((intent === "time" || intent === "callback") && d) {
    const parsed = extractTime(d);
    interp.time = { raw: d, spoken: parsed?.spoken ?? null };
  } else if (intent === "change" || intent === "cancel") {
    interp.detail = d;
  }
  if (intent === "time" && !d) interp.intent = "unclear";
  return interp;
}
