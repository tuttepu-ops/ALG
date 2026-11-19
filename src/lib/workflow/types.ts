import type { ShopDraft } from "./shop";
import type { HospitalDraft } from "./hospital";
import type { AgentMemory } from "../agent/hospitalAgent";

export type Stage =
  | "opening" // agent asked permission to talk
  | "confirm" // agent read the order and asked "Confirm చేయనా?"
  | "change_details" // agent asked what to change
  | "change_readback" // agent read back a change request, asked yes/no
  | "cancel_readback" // agent asked whether to raise a cancel request
  | "callback_time" // agent asked for a convenient callback time
  | "closed";

export type Intent =
  | "empty" // nothing recognised (silence / blank)
  | "greet"
  | "permit" // ok to talk
  | "permit_why" // ok to talk + asks what it is about
  | "why" // asks why / what about
  | "who" // asks who is calling
  | "what" // "ఏంటి?" / "what?" — didn't catch it
  | "confirm" // explicit agreement to confirm the order
  | "yes" // generic yes (used for read-backs)
  | "no" // plain no without details
  | "change" // change with details (detail = summary)
  | "change_bare" // wants a change but gave no details
  | "cancel" // cancel whole order
  | "callback" // busy / call later (time optional)
  | "end" // wants to end immediately
  | "time" // gives a time (callback_time stage)
  | "no_time" // won't give a time
  | "hold" // asks to wait
  | "repeat"
  | "q_total"
  | "q_items"
  | "q_delivery"
  | "q_other"
  | "unclear";

export interface CallbackTime {
  /** Customer's own words for the time, stored for staff. */
  raw: string;
  /** Clean Telugu phrase the agent can say back, when the app could parse it. */
  spoken: string | null;
}

export interface Interpretation {
  intent: Intent;
  detail?: string | null;
  time?: CallbackTime | null;
  source: "workflow" | "openai";
  /** Why the workflow could not decide alone (sent to the LLM), for diagnostics. */
  needsLlmReason?: string;
}

export type OutcomeKind =
  | "confirmed" | "change_request" | "cancel_request" | "callback" | "pending_staff" | "do_not_call"
  // hospital visiting-doctor workflow
  | "appointment_booked" | "not_interested" | "urgent_referral" | "enquiry_answered";

export interface Outcome {
  sessionId: string;
  orderId: string;
  kind: OutcomeKind;
  detail: string | null;
  callbackTime: string | null;
  customerWords: string;
  route: "workflow" | "openai";
  turn: number;
  recordedAt: string;
  /** Call record fields for tracking (direction, phone, name, language, booked date, questions for reception…). */
  meta?: Record<string, unknown>;
}

export interface Segment {
  text: string;
  /** true = fixed template text (same audio every time) → reuse cached audio. */
  cacheable: boolean;
}

export interface SessionState {
  agentProvider?: "gemini";
  confirmedCallbackNumber?: string;
  v: 1;
  sessionId: string;
  orderId: string;
  stage: Stage;
  turn: number;
  unclearStreak: number;
  greetCount: number;
  pendingDetail: string | null;
  outcome: OutcomeKind | null;
  /** What the agent last said — replayed on "repeat". */
  lastReply: Segment[];
  startedAt: string;
  shop?: ShopDraft;
  hospital?: HospitalDraft;
  /** AI hospital agent's memory (conversation, bookings, follow-ups). */
  agent?: AgentMemory;
}
