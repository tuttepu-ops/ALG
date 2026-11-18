import { DEMO_ID, initialShop } from "./shop";
import { findPatientCall, hospitalOpening, initialHospital, isHospitalCall, toSegments } from "./hospital";
import { newAgentMemory } from "../agent/hospitalAgent";
// The conversation state machine. The app — not the model — owns stages, order data,
// totals, confirmations and outcomes. An outcome is recorded at most once per session.

import { CATALOG_ALIASES, type Order } from "../orders/orders";
import { T, callbackSaved, changeReadback, orderReadout, totalAnswer } from "./templates";
import type { Interpretation, Outcome, OutcomeKind, Segment, SessionState, Stage } from "./types";

export interface StepContext {
  /** The customer's words for this turn (stored with any outcome). */
  text: string;
  /** Customer barged in while the agent's previous reply was still playing. */
  interrupted?: boolean;
  now?: Date;
}

export interface StepResult {
  state: SessionState;
  segments: Segment[];
  outcome: Outcome | null;
}

export function newSession(sessionId: string, order: Order, now = new Date()): { state: SessionState; segments: Segment[] } {
  const demo = order.id === DEMO_ID;
  const patient = isHospitalCall(order.id) ? findPatientCall(order.id) : null;
  const segments = patient ? toSegments(hospitalOpening(patient))
    : demo ? [{ text: "హలో అండి, Godavari Basket voice assistant‌ని. మీ order గురించి ఇప్పుడు మాట్లాడొచ్చా?", cacheable: false }] : [T.opening];
  return {
    state: {
      v: 1,
      sessionId,
      orderId: order.id,
      stage: "opening",
      turn: 0,
      unclearStreak: 0,
      greetCount: 0,
      pendingDetail: null,
      outcome: null,
      lastReply: segments,
      startedAt: now.toISOString(),
      ...(demo ? { shop: initialShop() } : {}),
      ...(patient ? { hospital: initialHospital(patient), agent: { ...newAgentMemory(), history: [{ who: "ravi" as const, text: hospitalOpening(patient) }] } } : {}),
    },
    segments,
  };
}

/** Max length for model-extracted detail that the agent will read back. */
const MAX_DETAIL = 90;

export function cleanDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const d = teluguize(detail.replace(/[\r\n\t]+/g, " ").replace(/[<>{}[\]"`]/g, "").replace(/\s+/g, " ").trim());
  if (!d) return null;
  return d.length > MAX_DETAIL ? d.slice(0, MAX_DETAIL).replace(/\s+\S*$/, "") : d;
}

// Romanized Telugu reads poorly on Bulbul. Known product names and common words are
// converted to Telugu script in code (English words like box/add/address stay English).
const ROMAN_TO_TELUGU: Array<[RegExp, string]> = [
  ...Object.entries(CATALOG_ALIASES).flatMap(([, aliases]) => {
    const te = aliases[0];
    return aliases.filter((a) => /^[a-z ]+$/i.test(a)).map((a) => [new RegExp(`\\b${a}\\b`, "gi"), te] as [RegExp, string]);
  }),
  ...([
    ["vaddu", "వద్దు"], ["kavali", "కావాలి"], ["kaavali", "కావాలి"], ["inko", "ఇంకో"], ["inkoka", "ఇంకొక"],
    ["teeseyandi", "తీసేయండి"], ["teeseyali", "తీసేయాలి"], ["tiseyandi", "తీసేయండి"], ["cheyandi", "చేయండి"],
    ["cheyyandi", "చేయండి"], ["cheyali", "చేయాలి"], ["pampandi", "పంపండి"], ["pampinchandi", "పంపించండి"],
    ["matrame", "మాత్రమే"], ["matram", "మాత్రం"], ["ki", "కి"], ["ga", "గా"], ["rendu", "రెండు"], ["okati", "ఒకటి"],
    ["ara", "అర"], ["kilo", "కిలో"], ["marchali", "మార్చాలి"], ["marchandi", "మార్చండి"], ["kuda", "కూడా"],
  ] as Array<[string, string]>).map(([a, te]) => [new RegExp(`\\b${a}\\b`, "gi"), te] as [RegExp, string]),
];

export function teluguize(s: string): string {
  let out = s;
  for (const [re, te] of ROMAN_TO_TELUGU) out = out.replace(re, te);
  return out;
}

export function step(prev: SessionState, order: Order, interp: Interpretation, ctx: StepContext): StepResult {
  const state: SessionState = { ...prev, turn: prev.turn + 1 };
  let outcome: Outcome | null = null;
  let segments: Segment[] = [];
  let keepLastReply = false;

  const go = (stage: Stage) => (state.stage = stage);
  const say = (...segs: Segment[]) => (segments = segs);
  const record = (kind: OutcomeKind, detail: string | null = null, callbackTime: string | null = null) => {
    if (state.outcome) return; // never twice
    state.outcome = kind;
    outcome = {
      sessionId: state.sessionId,
      orderId: state.orderId,
      kind,
      detail,
      callbackTime,
      customerWords: ctx.text,
      route: interp.source,
      turn: state.turn,
      recordedAt: (ctx.now ?? new Date()).toISOString(),
    };
  };
  const readOrder = (...lead: Segment[]) => {
    say(...lead, orderReadout(order));
    go("confirm");
  };
  const repeat = () => {
    say(...prev.lastReply);
    keepLastReply = true;
  };
  const hold = () => {
    say(T.hold);
    keepLastReply = true; // "repeat" after hold replays the pending question
  };
  const unclear = (clarify: Segment) => {
    state.unclearStreak = prev.unclearStreak + 1;
    if (state.unclearStreak >= 2) {
      record("pending_staff", `unclear twice at stage: ${prev.stage}`);
      say(T.pendingStaff);
      go("closed");
    } else {
      say(clarify);
      keepLastReply = true;
    }
  };
  const callbackWithOptionalTime = () => {
    const t = interp.time;
    if (t) {
      record("callback", null, t.raw);
      say(t.spoken ? callbackSaved(t.spoken) : T.callbackSavedGeneric);
      go("closed");
    } else {
      say(T.askCallbackTime);
      go("callback_time");
    }
  };
  const startChangeReadback = (detail: string | null | undefined) => {
    const d = cleanDetail(detail);
    if (!d) {
      say(T.askChange);
      go("change_details");
      return;
    }
    state.pendingDetail = d;
    say(changeReadback(d));
    go("change_readback");
  };
  const startCancel = (detail: string | null | undefined) => {
    state.pendingDetail = cleanDetail(detail) ?? "cancel full order";
    say(T.cancelReadback);
    go("cancel_readback");
  };

  const intent = interp.intent;
  if (intent !== "unclear" && intent !== "empty") state.unclearStreak = 0;

  if (prev.stage === "closed") {
    say(T.closed);
    return { state, segments, outcome: null };
  }

  // Common to every open stage.
  if (intent === "end") {
    record("callback", null, null);
    say(T.endNow);
    go("closed");
    return finish();
  }

  switch (prev.stage) {
    case "opening":
      switch (intent) {
        case "greet":
          state.greetCount = prev.greetCount + 1;
          say(state.greetCount === 1 ? T.greetAck : T.greetAgain);
          break;
        case "permit":
        case "confirm": // "yes, confirm it" before the order is read = permission only
        case "yes":
          readOrder(prev.greetCount > 0 ? T.permitAck : T.greetPermitAck);
          break;
        case "permit_why":
        case "q_total":
        case "q_items":
        case "q_delivery":
        case "change_bare":
          readOrder(T.permitWhyAck);
          break;
        case "change":
          startChangeReadback(interp.detail);
          break;
        case "cancel":
          startCancel(interp.detail);
          break;
        case "why":
        case "what":
        case "q_other":
          say(T.whyOpening);
          break;
        case "who":
          say(T.whoOpening);
          break;
        case "no":
        case "no_time":
          say(T.askCallbackTime);
          go("callback_time");
          break;
        case "callback":
        case "time":
          callbackWithOptionalTime();
          break;
        case "hold":
          hold();
          break;
        case "repeat":
          repeat();
          break;
        default:
          unclear(T.clarifyOpening);
      }
      break;

    case "confirm":
      switch (intent) {
        case "confirm":
        case "yes":
          if (ctx.interrupted) {
            // They spoke over the readout — make sure they heard the full order first.
            say(T.interruptedReread, orderReadout(order));
          } else {
            record("confirmed");
            say(T.confirmed);
            go("closed");
          }
          break;
        case "why":
          say(T.whyConfirm);
          break;
        case "who":
          say(T.whoConfirm);
          break;
        case "q_total":
          say(totalAnswer(order));
          break;
        case "q_items":
        case "repeat":
        case "what":
        case "greet":
        case "permit":
        case "permit_why":
          say(orderReadout(order));
          break;
        case "q_delivery":
          say(T.delivery, T.q.confirm);
          break;
        case "q_other":
          say(T.offTopic, T.q.confirm);
          break;
        case "no":
          say(T.noInConfirm);
          break;
        case "change_bare":
          say(T.askChange);
          go("change_details");
          break;
        case "change":
          startChangeReadback(interp.detail);
          break;
        case "cancel":
          startCancel(interp.detail);
          break;
        case "callback":
        case "time":
          callbackWithOptionalTime();
          break;
        case "hold":
          hold();
          break;
        default:
          unclear(T.clarifyConfirm);
      }
      break;

    case "change_details":
      switch (intent) {
        case "change":
          startChangeReadback(interp.detail);
          break;
        case "no":
        case "confirm":
        case "yes":
          say(T.backToConfirm);
          go("confirm");
          break;
        case "cancel":
          startCancel(interp.detail);
          break;
        case "callback":
        case "time":
          callbackWithOptionalTime();
          break;
        case "hold":
          hold();
          break;
        case "repeat":
        case "what":
          say(T.askChange);
          break;
        default:
          unclear(T.clarifyChange);
      }
      break;

    case "change_readback":
      switch (intent) {
        case "yes":
        case "confirm":
        case "permit":
          record("change_request", prev.pendingDetail);
          say(T.changeSaved);
          go("closed");
          break;
        case "no":
          state.pendingDetail = null;
          say(T.readbackNo);
          go("change_details");
          break;
        case "change":
          startChangeReadback(interp.detail);
          break;
        case "cancel":
          startCancel(interp.detail);
          break;
        case "callback":
        case "time":
          callbackWithOptionalTime();
          break;
        case "hold":
          hold();
          break;
        case "repeat":
        case "what":
        case "greet":
          repeat();
          break;
        default:
          unclear(T.clarifyReadback);
      }
      break;

    case "cancel_readback":
      switch (intent) {
        case "yes":
        case "confirm":
        case "permit":
        case "cancel":
          record("cancel_request", prev.pendingDetail);
          say(T.cancelSaved);
          go("closed");
          break;
        case "no":
          state.pendingDetail = null;
          say(T.backToConfirm);
          go("confirm");
          break;
        case "change":
          startChangeReadback(interp.detail);
          break;
        case "callback":
        case "time":
          callbackWithOptionalTime();
          break;
        case "hold":
          hold();
          break;
        case "repeat":
        case "what":
        case "greet":
          repeat();
          break;
        default:
          unclear(T.clarifyReadback);
      }
      break;

    case "callback_time":
      switch (intent) {
        case "time":
        case "callback":
          if (interp.time) callbackWithOptionalTime();
          else unclear(T.clarifyCallback);
          break;
        case "no_time":
        case "no":
          record("callback", null, null);
          say(T.callbackSavedNoTime);
          go("closed");
          break;
        case "permit":
        case "confirm":
        case "yes":
        case "permit_why":
          // Changed their mind and can talk now.
          readOrder(T.permitAck);
          break;
        case "hold":
          hold();
          break;
        case "repeat":
        case "what":
          say(T.clarifyCallback);
          break;
        default:
          unclear(T.clarifyCallback);
      }
      break;
  }

  return finish();

  function finish(): StepResult {
    if (!keepLastReply) state.lastReply = segments;
    return { state, segments, outcome };
  }
}

/**
 * Reply when the understanding provider failed. Stage, pending detail and unclear count are
 * kept (a provider failure is not the customer's fault); the agent asks a short question
 * relevant to the current stage and the UI offers manual options.
 */
export function providerFailureStep(prev: SessionState): StepResult {
  const state: SessionState = { ...prev, turn: prev.turn + 1 };
  const byStage: Record<Stage, Segment> = {
    opening: T.clarifyOpening,
    confirm: T.providerTrouble,
    change_details: T.clarifyChange,
    change_readback: T.clarifyReadback,
    cancel_readback: T.clarifyReadback,
    callback_time: T.clarifyCallback,
    closed: T.closed,
  };
  return { state, segments: [byStage[prev.stage]], outcome: null };
}

/** Deterministic quick replies per stage (each is understood without the LLM). */
export const MANUAL_OPTIONS: Record<Stage, string[]> = {
  opening: ["ఆ మాట్లాడండి", "why?", "కాల్ బ్యాక్"],
  confirm: ["yes, confirm it", "change చేయాలి", "cancel చేయండి", "కాల్ బ్యాక్"],
  change_details: ["ఏమీ లేదు", "cancel చేయండి"],
  change_readback: ["అవును", "కాదు"],
  cancel_readback: ["అవును", "కాదు"],
  callback_time: ["సాయంత్రం 6 గంటలకి", "రేపు ఉదయం", "తెలీదు"],
  closed: [],
};
