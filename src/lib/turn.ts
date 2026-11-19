import { DEMO_ID, shopTurn } from "./workflow/shop";
import { GEMINI_MODEL, geminiAgentRequest } from "./providers/gemini";
import { agentTurn } from "./agent/hospitalAgent";
import { getConfig } from "./config";
import { hospitalTurn, isHospitalCall, type HospitalOptions } from "./workflow/hospital";
// One customer turn: workflow first, at most one LLM request, then the state machine.

import type { Order } from "./orders/orders";
import { interpretHospitalWithLlm, interpretWithLlm, type HospitalIntent, type LlmDiag } from "./providers/openai";
import { MANUAL_OPTIONS, providerFailureStep, step, type StepResult } from "./workflow/engine";
import { isNeedsLlm, matchClear } from "./workflow/matcher";
import type { Interpretation, SessionState } from "./workflow/types";

export type Route = "workflow" | "openai" | "openai_failed";

export interface TurnDiag {
  route: Route;
  intent: string | null;
  /** Why the workflow handed this reply to the LLM. */
  llmReason: string | null;
  llm: LlmDiag | null;
  manualOptions: string[] | null;
}

export interface TurnInput {
  state: SessionState;
  order: Order;
  text: string;
  interrupted?: boolean;
  /** Hospital calls: slots already booked by other calls (slot → count). */
  taken?: Record<string, number>;
  /** AI hospital agent: bookings by other calls, "doctorId|date" → count. */
  agentTaken?: Record<string, number> | (() => Promise<Record<string, number>>);
  /** AI agent streaming: the reply's first sentence, as soon as it is written. */
  onFirst?: (text: string) => void;
  /** The acknowledgement the browser already played for this turn. */
  ackPlayed?: string | null;
}

/** The model's label → a plain phrase the hospital rules already understand. */
const CANONICAL: Record<HospitalIntent, string> = {
  yes: "అవును", no: "వద్దు", is_patient: "నేనే", relative: "నేను వాళ్ళ అబ్బాయిని", wrong_person: "wrong number", not_home: "ఇంట్లో లేరు",
  busy: "ఇప్పుడు బిజీ", book: "appointment book చేయండి", date: "", first_free: "ఏదైనా", name: "",
  q_fee: "fee ఎంత", q_where: "ఎక్కడ", q_when: "ఎప్పుడు", q_doctor: "ఏ డాక్టర్", q_bring: "ఏం తీసుకురావాలి", q_medical: "medicine",
  q_other: "", other_day: "వేరే రోజు",
  // Only the fixed rules may end a call as an emergency; a model guess gets the "call 108 if severe now" advice and the call goes on.
  emergency: "ఛాతీ నొప్పి", do_not_call: "do not call me", not_interested: "not interested", bye: "ok thank you",
  hold: "ఒక్క నిమిషం", repeat: "repeat", robot: "robot", unclear: "",
};

export async function runTurn(
  input: TurnInput,
  llm: typeof interpretWithLlm = interpretWithLlm,
  hospitalLlm: typeof interpretHospitalWithLlm = interpretHospitalWithLlm,
): Promise<StepResult & { diag: TurnDiag }> {
  const { state, order, text, interrupted } = input;
  const ctx = { text, interrupted };

  if (isHospitalCall(order.id) && (state.agentProvider === "gemini" || getConfig().hospitalEngine === "ai")) {
    const r = await agentTurn(state, text, !!interrupted, { taken: input.agentTaken, onFirst: input.onFirst, ackPlayed: input.ackPlayed, ...(state.agentProvider === "gemini" ? { modelOverride: GEMINI_MODEL, request: geminiAgentRequest() } : {}) });
    return { ...r, diag: { route: r.diag ? (r.diag.ok ? "openai" : "openai_failed") : "workflow", intent: r.outcome?.kind ?? null, llmReason: "AI agent", llm: r.diag, manualOptions: null } };
  }

  if (isHospitalCall(order.id)) {
    const opts: HospitalOptions = { taken: input.taken };
    const r = hospitalTurn(state, text, !!interrupted, opts);
    if (!r.needsModel) return { ...r, diag: { route: "workflow", intent: r.state.hospital?.step ?? null, llmReason: null, llm: null, manualOptions: null } };
    // The rules could not place the reply: one small model request labels it, the rules act on the label.
    const step = state.hospital?.step ?? "identify";
    const res = await hospitalLlm(step, state.lastReply.map((s) => s.text).join(" "), text);
    const label = res.label;
    const diag = (route: Route, intent: string | null) => ({ route, intent, llmReason: "Reply not matched by rules", llm: res.diag, manualOptions: null });
    if (!label || label.intent === "unclear") return { ...r, diag: diag(label ? "openai" : "openai_failed", label?.intent ?? null) };
    let canonical = CANONICAL[label.intent];
    if (label.intent === "date") canonical = label.detail && /^\d{1,2}$/.test(label.detail.trim()) ? `${label.detail.trim()} తేదీ కి` : "";
    if (label.intent === "name") canonical = label.detail ? `నా పేరు ${label.detail.trim()}` : "";
    const r2 = label.intent === "q_other"
      ? hospitalTurn(state, text, !!interrupted, { ...opts, fromModel: true, note: "__question__", original: text })
      : canonical ? hospitalTurn(state, canonical, !!interrupted, { ...opts, fromModel: true, original: text }) : null;
    if (!r2) return { ...r, diag: diag("openai", label.intent) };
    if (r2.outcome) r2.outcome.customerWords = text.slice(0, 200);
    return { ...r2, diag: diag("openai", label.intent) };
  }

  if (order.id === DEMO_ID) {
    const recognized = matchClear(state.stage, text);
    const local = shopTurn(state, text, !!interrupted, !isNeedsLlm(recognized) && recognized.intent === "permit" ? recognized : undefined);
    if (local) return { ...local, diag: { route: "workflow", intent: null, llmReason: null, llm: null, manualOptions: null } };
    const result = await llm(state.stage, text, state.pendingDetail);
    const fallback = shopTurn(state, text, !!interrupted, result.interp ?? { intent: "unclear", source: "workflow" })!;
    return { ...fallback, diag: { route: result.interp ? "openai" : "openai_failed", intent: result.interp?.intent ?? null, llmReason: "Ambiguous store request", llm: result.diag, manualOptions: null } };
  }

  if (state.stage === "closed") {
    const r = step(state, order, { intent: "q_other", source: "workflow" }, ctx);
    return { ...r, diag: { route: "workflow", intent: "closed", llmReason: null, llm: null, manualOptions: null } };
  }

  const m = matchClear(state.stage, text);
  if (!isNeedsLlm(m)) {
    const r = step(state, order, m, ctx);
    return { ...r, diag: { route: "workflow", intent: m.intent, llmReason: null, llm: null, manualOptions: null } };
  }

  // Ambiguous or needs details → exactly one model request (plus at most one rate-limit retry).
  const res = await llm(state.stage, text, state.pendingDetail);
  if (!res.interp) {
    const r = providerFailureStep(state);
    return {
      ...r,
      diag: { route: "openai_failed", intent: null, llmReason: m.needsLlm, llm: res.diag, manualOptions: MANUAL_OPTIONS[state.stage] },
    };
  }
  const interp: Interpretation = res.interp;
  const r = step(state, order, interp, ctx);
  return { ...r, diag: { route: "openai", intent: interp.intent, llmReason: m.needsLlm, llm: res.diag, manualOptions: null } };
}
