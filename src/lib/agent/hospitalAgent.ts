// Ravi — the AI phone agent for Sai Viswas Hospital.
// Both models share the same receptionist instructions and scripted workflows:
//  - facts come only from the knowledge base (src/lib/hospital/knowledge.ts) in its instructions;
//  - bookings go through tools that the CODE checks (real doctor, real date, free capacity, a name,
//    and a clear yes from the caller) — the model cannot invent a slot or overbook;
//  - emergencies, "never call me again" and silence are handled by code before the model runs;
//  - it never claims to be human (checked after the model replies).

import { getConfig } from "../config";
import { DOCTORS_KB, HOSPITAL_INFO, knowledgeText, type Doctor } from "../hospital/knowledge";
import { HOSPITAL, PATIENT_CALLS, doctorFor } from "../hospital/data";
import { describeError, fetchWithPolicy, type ProviderError } from "../providers/http";
import type { LlmDiag } from "../providers/openai";
import { clearYes, clean, detectLang } from "../workflow/hospital";
import type { Outcome, OutcomeKind, SessionState } from "../workflow/types";

export interface AgentTurn { who: "ravi" | "caller"; text: string }
export interface AgentBooking { doctorId: string; doctor: string; date: string; patient: string; fee: number }
export interface AgentMemory {
  history: AgentTurn[];
  bookings: AgentBooking[];
  /** Things the team must follow up (personal matters, complaints, unknown answers). */
  forTeam: string[];
  lang: "te" | "en";
  silence: number;
  failures: number;
  callbackDigits?: string;
  patientIdentified?: boolean;
  reachedThirdParty?: boolean;
  awaitingHandoff?: boolean;
  pendingTestBooking?: AgentBooking;
}

const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const DIGITS_BY_WORD = Object.fromEntries(DIGIT_WORDS.map((word, digit) => [word, String(digit)]));

export const newAgentMemory = (): AgentMemory => ({ history: [], bookings: [], forTeam: [], lang: "te", silence: 0, failures: 0 });

// ---------------------------------------------------------------- instructions
const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Today and the next 14 days, so the model never has to do date arithmetic. */
function calendar(now: Date): string {
  const out: string[] = [];
  for (let i = 0; i <= 14; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    out.push(`${i === 0 ? "TODAY " : i === 1 ? "TOMORROW " : ""}${iso(d)} ${DAY[d.getUTCDay()]}`);
  }
  return out.join("; ");
}

export function instructions(call: (typeof PATIENT_CALLS)[number], now: Date): string {
  const purpose = call.direction === "inbound"
    ? "INBOUND: someone called the hospital number. Help with whatever they need: information, booking, directions."
    : `OUTBOUND new-visit alert: you called ${call.patientName} (address them as "${call.nameTe}" in Telugu, "${call.nameEn}" in English) because ${call.reason}. First verify you are speaking with them before sharing any appointment details. If another person answers, ask to speak to the patient or offer to note a callback number without disclosing why the patient was called. For the patient, explain that cardiologist Dr. Viswanath visits on Nov 22 and 25 (special fee ₹100) and offer to book. If it's a wrong number, apologise and end.`;
  return `You are ${HOSPITAL.agentName} (${HOSPITAL.agentNameTe}), a warm, polite, sharp front-desk executive at Sai Viswas Hospital, Kakinada, speaking on the phone.
${purpose}

HOW YOU TALK (most important)
- Sound like a real, friendly person from Andhra on the phone — never like a script or an IVR. Keep it SHORT: usually under 25 words; give only the facts asked for (don't dump timings, packages and home-visit prices unless asked). One question at a time.
- Answer directly. A brief "హా", "Okay", or "సరే అండి" fits when genuinely acknowledging an answer or request. Skip automatic filler; don’t open or end every turn with an acknowledgement.
- Language: mirror the caller. If they speak English → reply fully in natural Indian English. If they speak Telugu or mixed (Tenglish/romanized Telugu) → reply in natural Tenglish: Telugu words in Telugu script, everyday English words in English letters (appointment, doctor, fee, date, available, slot, confirm, booking, reports, timings, WhatsApp, sorry, okay, perfect). Dates/times/money in English: "November 22", "10 AM", "100 rupees". Never old/formal Telugu (తేదీ, ఏర్పాటు, చీటీ, క్షమించండి, ఉదయం→morning) — use how people actually talk.
- Use simple Telugu sentence structure and familiar English words the caller understands. Use అండి where it sounds respectful (greeting, apology, accepting a request or goodbye), and use polite verbs like చెప్పండి and confirm చేయండి. Address adults with their name + గారు. When asking for a specific person, use their name + గారు instead of వాళ్లు. Use English farewells such as "Thanks for your time. Bye!"
- NEVER repeat a previous reply word for word. If you must say something again, say it differently and shorter. If the caller says you sound scripted/repetitive, apologise lightly and continue more naturally.
- Line checks: "హలో, లైన్‌లో ఉన్నారా?" → "హా వినిపిస్తుంది అండి, చెప్పండి." (then continue where you were, briefly). "Hello, can you hear me?" → "Yes, I can hear you, please go ahead."
- Upset or angry caller: stay calm and kind, apologise sincerely for the trouble, don't argue or defend, acknowledge the specific problem once, then offer the most helpful next step. Example: "ముందే update ఇవ్వాల్సింది అండి. Sorry, మీరు ఇంతసేపు wait చేయాల్సి వచ్చింది." When both shifts are verified as bookable, ask "Morning slot book చేయమంటారా, evening slot book చేయమంటారా?" If shifts are not verified, offer to check the caller’s preference with reception. Never imply a slot is available or booked until verified.
- Explain a relevant benefit using verified facts (such as the reduced visit fee), then offer one easy next step. Respect “not now” or “no”; never create urgency or promise health results.
- If the caller asks you to repeat or says they did not understand, restate the point in simpler words, then ask one short question.
- Answer exactly what was asked first, then (only if natural) move the conversation forward. If a third party says this does not concern them, thank them and offer to end. Never say “వదిలేయండి” or pressure them to book. When switching to English, use English even for the opening acknowledgement.
- Say a promise or apology once ("team తో check చేసి update చేస్తాను"); don't repeat it every turn — later, acknowledge briefly in new words.
- Use గారు for adults; for a child, just the name ("విహాన్ కి"), and ask the parent's name only if needed.

WHAT YOU MAY SAY
- Facts ONLY from the HOSPITAL KNOWLEDGE below. Never invent doctors, timings, prices, facilities or availability. If the knowledge says a service is not available, say so and offer what is (e.g. referral).
- You don't give medical advice or diagnoses (which medicine, stop tablets, is it serious). Say the doctor will check and advise. Lab instructions written in the knowledge (e.g. fasting for a lipid test) you may share as the lab's instruction.
- Emergency signs right now (chest pain now, can't breathe, unconscious): tell them to call 108 / our emergency number immediately.
- Only if something is personal (a complaint about staff, billing dispute, a patient's own case details, a problem you cannot solve) or truly not in the knowledge: say "నేను team తో check చేసి మీకు update చేస్తాను అండి" / "I'll check with the team and get back to you", and call log_for_team. This is the LAST option — first try to answer from the knowledge.
- If asked whether you are a robot/AI/real person: answer honestly and briefly — you are the hospital's virtual assistant — then continue helping. Never claim to be human. Don't bring this up yourself.

BOOKING (use the tools — never pretend)
- FREE DATES (live, per doctor) are given in the latest developer message — offer only those. Offer at most 2–3 nearest dates (or the caller's asked day), never a long list. Use check_availability only if a doctor's dates are missing there.
- Appointments are by DATE, not by minute: if they ask for "10 AM", say they can come any time in the doctor's timings that day and booked patients are seen first. Never promise a specific time, an "early slot" or anything else not in the knowledge.
- You need: doctor, date, patient name. Then read back once with the exact date ("Friday, November 20"), doctor and fee, and ask to confirm; book only after a clear yes. If the caller already clearly said "confirm/book it" together with name and date, you may book right away.
- Call book_appointment; only after it returns ok, tell them it's confirmed (say the date again) and that details + hospital location come on WhatsApp, and remind them to bring old reports/scans/medication details.
- Callback requested, not interested, wrong number, do-not-call, or the caller is done → call end_call with the right outcome and say a short warm goodbye in the same reply.

CALENDAR: ${calendar(now)}

HOSPITAL KNOWLEDGE
${knowledgeText()}

EXAMPLE (style only — don't copy word for word)
Caller: Namaste, Doctor Viswanath garu hospital ki eppudu vastharu? Consultation fee entha?
${HOSPITAL.agentName}: Dr. Viswanath గారు cardiologist అండి. ఈ month November 22, 25 dates లో available ఉన్నారు. Consultation fee కేవలం 100 rupees మాత్రమే అండి.
Caller: Ma nannagari heart checkup kosam chupinchali, old reports kooda unnayi.
${HOSPITAL.agentName}: అవునండి, పక్కాగా చూపించాలి. Old reports, scanning reports, medication details ఏమున్నా తీసుకురండి, doctor గారు check చేసి proper గా guide చేస్తారు. November 22 కి కావాలా, 25 కి కావాలా? మీ పేరు చెప్తే ఇప్పుడే slot lock చేస్తాను.
Caller: Na peru Ramesh andi. November 22 ki okati confirm cheseyandi.
${HOSPITAL.agentName}: (book_appointment → ok) Perfect అండి Ramesh గారు! November 22 కి appointment confirm అయిపోయింది. Booking details, hospital location మీ WhatsApp కి ఇప్పుడే పంపిస్తున్నాను. Old reports మర్చిపోకుండా తీసుకురండి. Thank you, take care!`;
}

// ---------------------------------------------------------------- tools
const TOOLS = [
  { type: "function", name: "check_availability", strict: true,
    description: "Free appointment dates for a doctor (next 7 bookable days for resident doctors; visit dates for visiting doctors).",
    parameters: { type: "object", additionalProperties: false, required: ["doctor_id"], properties: { doctor_id: { type: "string" } } } },
  { type: "function", name: "book_appointment", strict: true,
    description: "Book an appointment. Only after the caller clearly agreed to this exact booking.",
    parameters: { type: "object", additionalProperties: false, required: ["doctor_id", "date", "patient_name"],
      properties: { doctor_id: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, patient_name: { type: "string" } } } },
  { type: "function", name: "log_for_team", strict: true,
    description: "Record something the hospital team must follow up personally (complaint, personal case, unknown answer).",
    parameters: { type: "object", additionalProperties: false, required: ["summary"], properties: { summary: { type: "string" } } } },
  { type: "function", name: "end_call", strict: true,
    description: "End the call with its outcome (say goodbye in the same reply).",
    parameters: { type: "object", additionalProperties: false, required: ["outcome", "callback_time", "note"],
      properties: {
        outcome: { type: "string", enum: ["appointment_booked", "enquiry_answered", "not_interested", "callback", "do_not_call", "wrong_number", "needs_team"] },
        callback_time: { type: ["string", "null"], description: "When to call back, in the caller's words" },
        note: { type: ["string", "null"] },
      } } },
] as const;

const daysAhead = (now: Date, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1 + i)));

/** Bookable dates for a doctor with remaining capacity. */
export function availability(doc: Doctor, now: Date, taken: Record<string, number>): { date: string; day: string; free: number }[] {
  const dates = doc.kind === "visiting"
    ? doc.visitDates!.filter((d) => d > iso(now))
    : [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), ...daysAhead(now, 14)].filter((d) => doc.opDays!.includes(d.getUTCDay())).slice(0, 7).map(iso);
  return dates.map((date) => ({ date, day: DAY[new Date(`${date}T12:00:00Z`).getUTCDay()], free: doc.perDay - (taken[`${doc.id}|${date}`] ?? 0) }));
}

/** "Yes, confirm", "అవును", "book చేయండి", "confirm cheseyandi" — a clear agreement in the caller's last words. */
export function callerAgreed(text: string): boolean {
  const t = clean(text);
  if (/\?\s*$/u.test(text.trim()) && !/\b(?:yes|confirm)\b|అవును|సరే/u.test(t)) return false; // a question is not a yes
  return clearYes(t) || /\bconfirm|\bbook (?:it|me|her|him|the|a|an|for|on|చేయండి|cheyandi|cheyyandi)|బుక్ చేయ|\block\b|cheseyandi|చేసేయండి|\bgo ahead\b|\bplease do\b|అవును|\bavunu|సరే|\bok(?:ay)?\b|\byes\b|పెట్టండి|\bpettandi/u.test(t);
}

// ---------------------------------------------------------------- the turn
interface ModelResult { text: string; diag: LlmDiag; outcome: { kind: OutcomeKind; callbackTime: string | null; note: string | null } | null; booked: AgentBooking | null }

export interface AgentOptions {
  now?: Date;
  modelOverride?: string;
  /** Bookings by other calls: "doctorId|date" → count. */
  taken?: Record<string, number> | (() => Promise<Record<string, number>>);
  /** For tests: replaces the OpenAI request. */
  request?: (body: unknown) => Promise<unknown>;
  /** The browser already played a short acknowledgement ("హా అండి.") — the model should not start with one. */
  ackPlayed?: string | null;
  /** Called once with the reply's first sentence while the model is still writing (to start the voice early). */
  onFirst?: (text: string) => void;
}

const CALLBACK_YES = /^(?:(?:ఆ|హా|అవును|సరే|ఓకే|ha|yes|yeah|ok|okay) )*(?:correct|that's correct|that is correct|right|that's right|that is right|కరెక్ట్|కరెక్టే|సరైన నంబర్|అదే|అవును|అవునండి|సరే|సరేనండి|ఓకే|yes|yeah|ok|okay)(?: అండి| andi)?$/iu;
const IDENTITY_YES = /^(?:(?:ఆ|హా) )?(?:అవును|అవునండి|నేనే|అవును నేనే|అవునండి నేనే|yes|yes speaking|yes that'?s me)(?: అండి)?(?: చెప్పండి)?$/iu;
const IDENTITY_NO = /^(?:(?:ఆ|హా) )?(?:కాదు|కాదండి|లేదు|లేదండి|నేను కాదు|no|nope|not me)(?: అండి)?$/iu;
const DIGIT_PATTERN = /\d+|\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b/giu;
const LAST_DIGITS = /\b(?:last|final) (?:([1-9]|one|two|three|four|five|six|seven|eight|nine) )?(?:digits?|numbers?)\b|చివరి\s*(?:([1-9])\s*)?(?:digits?|డిజిట్లు|అంకెలు)|చివర్లో/iu;
const LINE_CHECK = /^(?:hello|హలో)(?: (?:hello|హలో|అండి))*$|can you hear me|వినిపిస్తోందా|వినిపించట్లేదు|(?:voice|వాయిస్)[^.]{0,35}(?:cut|ఆగు|ఆడుకో|సరిగా|break|clear)/iu;

function digitsIn(text: string): string {
  return (text.match(DIGIT_PATTERN) ?? []).map(part => DIGITS_BY_WORD[part.toLowerCase()] ?? part).join("");
}

const TEST_BOOKING_YES = /^(?:yes|yes please|confirm|yes confirm|go ahead|అవును|అవునండి|సరే|సరేనండి|confirm చేయండి|అవును confirm చేయండి)[.! ]*$/iu;
const HUMAN_CLAIM = /\b(?:i am|i'm)\s+(?:a\s+)?(?:real\s+)?(?:human|person)\b|నేను\s+(?:నిజమైన\s+)?మనిషి(?:నే|ని)/iu;

export async function agentTurn(prev: SessionState, raw: string, interrupted: boolean, opts: AgentOptions = {}): Promise<{ state: SessionState; segments: { text: string; cacheable: boolean }[]; outcome: Outcome | null; diag: LlmDiag | null }> {
  const call = PATIENT_CALLS.find((p) => p.id === prev.orderId);
  if (!call) throw new Error(`Unknown call ${prev.orderId}`);
  const now = opts.now ?? new Date();
  const mem: AgentMemory = structuredClone(prev.agent ?? newAgentMemory());
  const state: SessionState = { ...prev, agent: mem, turn: prev.turn + 1 };
  const text = raw.trim();
  const t = clean(text);
  const lineCheck = LINE_CHECK.test(t);
  const lang = detectLang(text);
  if (lang && !(mem.callbackDigits !== undefined && (lineCheck || /^(?:ok(?:ay)?|yes)$/iu.test(t)))) mem.lang = lang;
  const en = mem.lang === "en";
  const L = (te: string, e: string) => (en ? e : te);

  const reply = (line: string, outcome: Outcome | null = null, diag: LlmDiag | null = null, close = false) => {
    if (line) mem.history.push({ who: "ravi", text: line });
    mem.history = mem.history.slice(-30);
    state.lastReply = [{ text: line, cacheable: false }];
    if (close) state.stage = "closed";
    return { state, segments: state.lastReply, outcome, diag };
  };
  const record = (kind: OutcomeKind, detail: string | null, callbackTime: string | null = null): Outcome | null => {
    if (state.outcome) return null; // one outcome per call (a booking stays the outcome)
    state.outcome = kind;
    return {
      sessionId: state.sessionId, orderId: state.orderId, kind, detail, callbackTime, customerWords: text.slice(0, 200),
      route: "openai", turn: state.turn, recordedAt: new Date().toISOString(),
      meta: { direction: call.direction, phone: call.phoneMasked, name: mem.bookings.at(-1)?.patient ?? call.patientName, language: mem.lang,
        date: mem.bookings.at(-1)?.date ?? null, bookings: mem.bookings, questionsForReception: mem.forTeam },
    };
  };

  if (prev.stage === "closed") return { state, segments: [{ text: L("ఈ call already complete అయింది అండి. Thank you!", "This call is complete. Thank you!"), cacheable: false }], outcome: null, diag: null };

  // ----- code-level safety before the model -----
  if (!text) {
    mem.silence++;
    if (mem.silence >= 3) return reply(L("Network సరిగ్గా లేనట్టుంది అండి. మేము మళ్లీ call చేస్తాము. Thank you!", "I think the line isn't clear. We'll call you back. Thank you!"), record("pending_staff", "No response on the line"), null, true);
    return reply(mem.silence === 1 ? L("హలో అండి, వినిపిస్తోందా?", "Hello, can you hear me?") : L("హలో అండి? నేను line లోనే ఉన్నాను.", "Hello? I'm still on the line."));
  }
  mem.silence = 0;
  mem.history.push({ who: "caller", text: interrupted ? `${text} (interrupted ${HOSPITAL.agentName})` : text });
  if (/ఊపిరి ఆడటం లేదు|can.?t breathe|not breathing|unconscious|స్పృహ (?:లేదు|తప్పి)|collapsed|heart attack|(?:ఇప్పుడు|now|right now)[^.]{0,25}(?:ఛాతీ నొప్పి|chest pain)/u.test(t) && !/నొప్పి (?:ఏమీ )?లేదు|no pain/u.test(t)) {
    return reply(L("ఇది emergency లా ఉంది అండి. వెంటనే 108 కి call చేయండి, లేదా మా emergency number 0884-2345600 కి call చేయండి. మా team కి కూడా ఇప్పుడే inform చేస్తున్నాను.",
      "This sounds like an emergency. Please call 108 right now, or our emergency number 0884-2345600. I'm informing our team too."), record("urgent_referral", "Caller described possible emergency symptoms"), null, true);
  }

  // Keep the number in code, so corrections and partial STT never become confirmed callbacks.
  const numberRequest = /(?:(?:another|different|other|new|callback) (?:phone )?number|(?:note|take|write down|call) (?:the|this|that|a) (?:phone )?number|(?:ఇంకో|వేరే|కొత్త) (?:ఫోన్ |phone )?(?:నంబర్|నెంబర్|number)|(?:number|నంబర్|నెంబర్)[^.]{0,35}(?:చెప్తా|చెబుతా|note))/iu;
  if (/\b(?:do not call|don't call|stop calling)\b|మళ్ళీ కాల్ చేయవద్దు|మళ్లీ కాల్ చేయొద్దు|ఇక కాల్ చేయకండి/iu.test(t)) {
    delete mem.callbackDigits;
    return reply(L("సరే అండి. మళ్లీ call చేయవద్దని note చేశాను. Thank you.", "Understood. I’ve noted your request not to receive further calls. Thank you."),
      record("do_not_call", "Caller asked not to receive further calls"), null, true);
  }
  if (mem.callbackDigits !== undefined || numberRequest.test(text)) {
    const current = mem.callbackDigits ?? "";
    const reset = /wrong (?:phone )?number|not (?:right|correct)|incorrect|start over|from the beginning|tell (?:it|you|the number) again|తప్పు|కాదు|కాదండి|మళ్ళీ చెప్త|మళ్లీ చెప్త|^(?:no|nope|లేదు|లేదండి)(?: అండి)?$/iu.test(t);
    const spoken = digitsIn(t);
    const digits = spoken.length === 12 && spoken.startsWith("91") ? spoken.slice(2) : spoken;
    const valid = (number: string) => /^[6-9]\d{9}$/.test(number);
    const repeat = /(?:repeat|read.{0,10}back|మళ్ళీ చద|మళ్లీ చద)/iu.test(text);
    const suffix = LAST_DIGITS.exec(t);
    let corrected: string | null = null;
    if (suffix && !lineCheck) {
      const count = Number(DIGITS_BY_WORD[suffix[1]] ?? suffix[1] ?? suffix[2] ?? "1");
      const tail = digitsIn(t.slice(suffix.index + suffix[0].length));
      const oldTail = current.slice(-count);
      if (valid(current) && (tail.length === count && !reset
        || tail.length === count * 2 && tail.startsWith(oldTail) && reset)) {
        corrected = tail.slice(-count);
      } else {
        mem.callbackDigits = "";
        return reply(L("Okay, ఒక్కసారి full number మళ్ళీ చెప్పండి అండి.", "Okay, please say the full number again."));
      }
    }

    if (!reset && !repeat && !digits && valid(current) && CALLBACK_YES.test(t) && !/\?\s*$/u.test(text)) {
      delete mem.callbackDigits;
      state.confirmedCallbackNumber = "+91" + current;
      return reply(L("సరే అండి. ఈ number కి call చేయమని మా team కి చెప్తాను. Thanks for sharing the number. Have a nice day. Bye!", "I’ll ask our team to call this number. Thanks for sharing the number. Have a nice day. Bye!"),
        record("callback", JSON.stringify({ callbackNumber: "+91" + current })), null, true);
    }

    if (reset && !lineCheck) mem.callbackDigits = "";
    else mem.callbackDigits ??= "";
    if (corrected) {
      mem.callbackDigits = current.slice(0, -corrected.length) + corrected;
    } else if (digits && !lineCheck && !repeat) {
      const pending = mem.callbackDigits;
      const isRepeatedFullPrefix = digits.length >= 7 && pending.length + digits.length > 10;
      if (digits.length >= 10 || valid(pending) || isRepeatedFullPrefix) mem.callbackDigits = digits;
      else mem.callbackDigits = pending + digits;
    }
    if (valid(mem.callbackDigits)) {
      if (!digits && !repeat && !lineCheck) return reply(L("Number correct అయితే అవును అనండి. మార్చాలంటే correct digits చెప్పండి అండి.", "Please say yes if the number is correct, or tell me which digits to change."));
      const spokenDigits = [...mem.callbackDigits].map(digit => DIGIT_WORDS[Number(digit)]);
      const readback = `${spokenDigits.slice(0, 5).join(", ")}… ${spokenDigits.slice(5).join(", ")}`;
      return corrected
        ? reply(L(`Okay, correct చేశాను. ఒక్కసారి మళ్ళీ చెప్తాను, వినండి. ${readback}. ఇప్పుడు correct ఏనా?`,
          `Okay, I’ve updated it. ${readback}. Is that right?`))
        : reply(L(`${lineCheck ? "హా, line లోనే ఉన్నాను అండి." : "Okay,"} ఒక్కసారి number చెప్తాను, confirm చేయండి. ${readback}. ఇదేనా?`,
          `${lineCheck ? "Yes, I’m here." : "Okay,"} let me read that back. ${readback}. Is that right?`));
    }
    const pending = mem.callbackDigits;
    if (pending.length >= 10 || (pending && !/^[6-9]/u.test(pending) && pending.length >= 7)) {
      mem.callbackDigits = "";
      return reply(L("పది digits ఉన్న mobile number ఒక్కసారి మళ్లీ చెప్పండి అండి.", "Please say the ten-digit mobile number again."));
    }
    if (pending.length === 9) {
      return reply(L(`${lineCheck ? "హా, line లోనే ఉన్నాను అండి. " : ""}Nine digits note అయ్యాయి. చివరి digit ఒక్కటి చెప్పండి.`,
        `${lineCheck ? "Yes, I’m here. " : ""}I have nine digits. What’s the last digit?`));
    }
    if (pending && (lineCheck || repeat)) {
      return reply(L("హా, line లోనే ఉన్నాను అండి. మిగతా digits చెప్పండి.", "Yes, I’m here. Please continue with the remaining digits."));
    }
    if (digits && pending) return reply("");
    return reply(L("హా, చెప్పండి అండి. నేను note చేసుకుంటాను.", "Sure, go ahead. I’ll note it down."));
  }

  // Outbound visit details stay private until the intended patient identifies themselves.
  if (call.direction === "outbound") {
    const thirdParty = /\b(?:son|daughter|husband|wife|relative|family member)\b|అబ్బాయి|కొడుకు|కూతురు|భర్త|భార్య|వాళ్ళ|వాళ్ల|వారి|ఇంట్లో లేరు|అందుబాటులో లేరు/iu.test(t);
    const wrongNumber = /\bwrong number\b|తప్పు నంబర్|తప్పు number/iu.test(t);
    const ownNames = [call.nameEn, call.nameTe?.replace(/ గారు$/u, ""), call.patientName].filter((name): name is string => !!name).map(clean);
    const selfText = t.replace(/^(?:ఆ ఉండండి|చెప్పండి|హలో) /u, "").replace(/(?: చెప్పండి| అండి)+$/u, "");
    const namedSpeaker = ownNames.some(name => (mem.awaitingHandoff && selfText === name) || [
      `${name}నే మాట్లాడేది`, `నేను ${name}`, `నేను ${name}ని`, `నేను ${name} గారిని`, `నా పేరు ${name}`,
      `this is ${name}`, `i am ${name}`, `i'm ${name}`, `my name is ${name}`, `${name} speaking`,
    ].includes(selfText));
    const handingOver = /(?:phone|ఫోన్).{0,40}(?:ఇస్తున్నా|ఇచ్చాను|ఇస్తాను|మాట్లాడండి)|(?:ఇస్తున్నా|ఇచ్చాను|ఇస్తాను).{0,40}(?:phone|ఫోన్)|\b(?:handing|passing) (?:her|him|them|the phone)\b|\b(?:she|he|they)(?: is| are|'s|'re) (?:now )?on the line\b/iu.test(t);
    if (wrongNumber) return reply(L("Sorry అండి, ఇబ్బంది పెట్టాను. Thank you.", "Sorry for the trouble. Thank you."),
      record("pending_staff", "Wrong number"), null, true);
    if (!mem.patientIdentified && handingOver) {
      const alreadyWaiting = mem.awaitingHandoff;
      mem.awaitingHandoff = true;
      mem.reachedThirdParty = true;
      return alreadyWaiting
        ? reply(L("హలో, మీ పేరు చెప్పగలరా అండి?", "Hello, could you tell me your name?"))
        : reply(L("సరే అండి, thanks. హలో, ఒక్కసారి మీ పేరు చెప్పగలరా?", "Thanks. Hello, may I have your name?"));
    }
    if (thirdParty || (!mem.patientIdentified && IDENTITY_NO.test(t))) {
      mem.patientIdentified = false;
      mem.reachedThirdParty = true;
      delete mem.awaitingHandoff;
      return reply(L(`${call.nameTe} ఎప్పుడు available గా ఉంటారో చెప్పగలరా?`,
        `Could you tell me when ${call.nameEn} will be available?`));
    }
    const confirmedIdentity = !/\?\s*$/u.test(text) && (namedSpeaker || (!mem.reachedThirdParty && IDENTITY_YES.test(t)));
    if (!mem.patientIdentified && confirmedIdentity) {
      mem.patientIdentified = true;
      delete mem.awaitingHandoff;
      const doctor = doctorFor(call);
      return reply(L(
        `థాంక్యూ, ${call.nameTe}. ${doctor.specialtyTe} ${doctor.nameTe} visit గురించి call చేశాను. Visit dates check చేయమంటారా?`,
        `Thank you, ${call.nameEn}. I’m calling about ${doctor.name}’s cardiology visit. Would you like me to check the visit dates?`,
      ));
    }
    if (!mem.patientIdentified) {
      if (mem.awaitingHandoff) return reply(L("ఒక్కసారి మీ పేరు చెప్పగలరా అండి?", "Could you tell me your name, please?"));
      return reply(mem.reachedThirdParty
        ? L(`సింపుల్‌గా చెప్తాను అండి. ${call.nameTe}తో నేరుగా మాట్లాడాలి. ఇప్పుడు వీలు కాకపోతే callback number చెప్పొచ్చు.`,
          `I’m calling to speak with ${call.nameEn} directly. If they’re unavailable, I can note a callback number.`)
        : L(`${call.nameTe} మీరేనా అండి?`, `Am I speaking with ${call.nameEn}?`));
    }
  }

  if (opts.modelOverride && !TEST_BOOKING_YES.test(text)) delete mem.pendingTestBooking;

  // ----- the model -----
  const cfg = getConfig();
  const diag: LlmDiag = { called: false, ok: false, model: opts.modelOverride ?? cfg.agentModel, effort: cfg.agentEffort, maxOutputTokens: 700, latencyMs: 0, retried: false, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 } };
  const started = Date.now();
  let res: ModelResult;
  try {
    res = await runModel(call, mem, now, opts, text, diag);
  } catch (error) {
    diag.latencyMs = Date.now() - started;
    if (opts.modelOverride && error instanceof Error) {
      const status = /^Gemini request failed \(HTTP (\d{3})\)\.$/u.exec(error.message);
      if (status) diag.error = { kind: "http", status: Number(status[1]), message: error.message, summary: error.message };
      if (error.message === "Gemini API key is missing.") diag.error = { kind: "not_configured", message: error.message, summary: error.message };
    }
    diag.error ??= { kind: "network", message: "The agent request did not complete.", summary: diag.called
      ? "The model request did not complete. Check the provider logs."
      : "The agent could not load booking data. Check the storage configuration." };
    res = { text: "", outcome: null, booked: null, diag };
  }
  if (!res.text) {
    mem.failures++;
    mem.history.pop();
    if (mem.failures >= 2) return reply(L("Sorry అండి, ఇప్పుడు check చేయడం కుదరలేదు. మా reception team కోసం note చేస్తాను. Thank you!", "Sorry, I couldn't check that right now. I'll leave a note for reception. Thank you!"), record("pending_staff", "Agent unavailable"), res.diag, true);
    return reply(L("Sorry అండి, ఒక్కసారి మళ్లీ చెప్తారా?", "Sorry, could you say that once more?"), null, res.diag);
  }
  mem.failures = 0;
  let line = res.text.replace(/\s+/gu, " ").trim();
  if (opts.ackPlayed) line = stripAck(line);
  // (The acknowledgement the browser played is not part of `line`; the transcript shows it in the chat.)
  if (HUMAN_CLAIM.test(line)) line = L("నేను Sai Viswas hospital virtual assistant ని అండి, మీకు help చేయడానికే ఉన్నాను. చెప్పండి.", "I'm Sai Viswas Hospital's virtual assistant, here to help you. Please go ahead.");

  let outcome: Outcome | null = null;
  if (res.booked) outcome = record("appointment_booked", JSON.stringify({ ...res.booked, direction: call.direction, phone: call.phoneMasked, language: mem.lang, sendWhatsApp: "Booking details + hospital location", callerQuestions: mem.forTeam.length ? mem.forTeam : undefined }));
  let close = false;
  if (res.outcome) {
    close = true;
    const kind: OutcomeKind = res.outcome.kind;
    outcome = outcome ?? record(kind, [res.outcome.note, mem.forTeam.length ? `For team: ${mem.forTeam.join("; ")}` : null].filter(Boolean).join(" | ") || null, res.outcome.callbackTime);
  }
  return reply(line, outcome, res.diag, close);
}

const OUTCOME_MAP: Record<string, OutcomeKind> = {
  appointment_booked: "appointment_booked", enquiry_answered: "enquiry_answered", not_interested: "not_interested", callback: "callback",
  do_not_call: "do_not_call", wrong_number: "pending_staff", needs_team: "pending_staff",
};

async function runModel(call: (typeof PATIENT_CALLS)[number], mem: AgentMemory, now: Date, opts: AgentOptions, lastCaller: string, diag: LlmDiag): Promise<ModelResult> {
  const cfg = getConfig();
  const taken = (typeof opts.taken === "function" ? await opts.taken() : opts.taken) ?? {};
  const input: unknown[] = mem.history.map((h) => ({ role: h.who === "ravi" ? "assistant" : "user", content: h.text }));
  // Live data goes in a late message (the long instructions stay identical → prompt caching keeps them fast).
  const mine = (id: string, date: string) => mem.bookings.filter((b) => b.doctorId === id && b.date === date).length;
  const free = DOCTORS_KB.map((d) => `${d.id}: ${availability(d, now, taken).filter((a) => a.free - mine(d.id, a.date) > 0).slice(0, 4).map((a) => `${a.date} ${a.day.slice(0, 3)}`).join(", ") || "none"}`).join(" | ");
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const nowText = `${DAY[ist.getUTCDay()]} ${iso(ist)} ${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")} IST`;
  input.push({ role: "developer", content: `NOW: ${nowText} (today's dates are bookable only if the doctor's timings today haven't ended)\nFREE DATES: ${free}\nAlready booked in this call: ${mem.bookings.map((b) => `${b.patient} ${b.doctor} ${b.date}`).join("; ") || "none"}\nCaller language now: ${mem.lang === "en" ? "ENGLISH — reply in English" : "Telugu/Tenglish — reply in natural Tenglish"}.${opts.ackPlayed ? `\nYou ALREADY said "${opts.ackPlayed}" a moment ago — do NOT start with an acknowledgement (no హా/ఓకే/sure/okay); go straight into the answer, and keep your FIRST sentence short (under 8 words, ending with a full stop).` : ""}` });
  let booked: AgentBooking | null = null;
  let outcome: ModelResult["outcome"] = null;
  const t0 = Date.now();
  // Words said in a round that also called a tool ("ఒక్క నిమిషం, book చేస్తున్నాను") are kept and joined to the final reply.
  let pre = "";
  let firstSent = false;
  let spokenThisRound = "";
  const onFirst = opts.onFirst ? (f: string) => { if (!firstSent) { firstSent = true; spokenThisRound = f.slice(pre ? pre.length + 1 : 0); opts.onFirst!(f); } } : undefined;
  for (let round = 0; round < 4; round++) {
    spokenThisRound = "";
    const body = {
      model: opts.modelOverride ?? cfg.agentModel, instructions: instructions(call, now) + (opts.modelOverride ? "\nThis is a sandbox test. Use book_appointment to propose the current corrected booking. If it needs confirmation, read back the doctor, date and name and ask for a separate yes. Say test booking and never claim a real appointment, WhatsApp message or callback has been arranged." : ""), input, tools: TOOLS, store: false,
      reasoning: { effort: cfg.agentEffort }, max_output_tokens: 700, parallel_tool_calls: false, include: ["reasoning.encrypted_content"],
    };
    diag.called = true;
    const json = (await (opts.request ? opts.request(body) : onFirst ? postStream(body, diag, (f) => onFirst(pre ? `${pre} ${f}` : f), !!opts.ackPlayed && !pre) : post(body, diag))) as {
      output?: Array<{ type: string; name?: string; arguments?: string; call_id?: string; content?: Array<{ type: string; text?: string }> }>;
      usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    };
    diag.usage!.inputTokens += json.usage?.input_tokens ?? 0;
    diag.usage!.outputTokens += json.usage?.output_tokens ?? 0;
    diag.usage!.cachedInputTokens += json.usage?.input_tokens_details?.cached_tokens ?? 0;
    const out = json.output ?? [];
    const calls = out.filter((o) => o.type === "function_call");
    const msg = out.filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join(" ").trim();
    if (!calls.length) { diag.ok = !!(pre || msg); diag.latencyMs = Date.now() - t0; return { text: [pre, msg].filter(Boolean).join(" "), diag, outcome, booked }; }
    input.push(...out);
    for (const fc of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(fc.arguments ?? "{}"); } catch { /* bad args → error below */ }
      const result = runTool(fc.name!, args, { mem, now, taken, lastCaller, sandbox: !!opts.modelOverride, setBooked: (b) => (booked = b), setOutcome: (o) => (outcome = o) });
      input.push({ type: "function_call_output", call_id: fc.call_id, output: JSON.stringify(result) });
    }
    if (msg && outcome) { diag.ok = true; diag.latencyMs = Date.now() - t0; return { text: [pre, msg].filter(Boolean).join(" "), diag, outcome, booked }; }
    // Text written alongside a tool call ("Shall I confirm?" + book) is dropped — unless its first sentence was
    // already being spoken (streaming), in which case only that sentence is kept so the transcript matches.
    if (msg && spokenThisRound) pre = [pre, spokenThisRound].filter(Boolean).join(" ");
  }
  diag.latencyMs = Date.now() - t0;
  return { text: pre, diag, outcome, booked };
}

function runTool(name: string, args: Record<string, unknown>, ctx: {
  mem: AgentMemory; now: Date; taken: Record<string, number>; lastCaller: string; sandbox: boolean;
  setBooked: (b: AgentBooking) => void; setOutcome: (o: ModelResult["outcome"]) => void;
}): unknown {
  const doc = DOCTORS_KB.find((d) => d.id === args.doctor_id);
  const mine = (id: string, date: string) => ctx.mem.bookings.filter((b) => b.doctorId === id && b.date === date).length;
  switch (name) {
    case "check_availability": {
      if (!doc) return { ok: false, error: `Unknown doctor_id. Valid: ${DOCTORS_KB.map((d) => d.id).join(", ")}` };
      return { ok: true, doctor: doc.name, timings: doc.timings, fee: doc.fee, dates: availability(doc, ctx.now, ctx.taken).map((a) => ({ ...a, free: a.free - mine(doc.id, a.date) })) };
    }
    case "book_appointment": {
      if (!doc) return { ok: false, error: "Unknown doctor_id" };
      const date = String(args.date ?? "");
      const patient = String(args.patient_name ?? "").trim();
      const slot = availability(doc, ctx.now, ctx.taken).find((a) => a.date === date);
      if (!slot) return { ok: false, error: `${doc.name} is not available on ${date}. Offer only dates from FREE DATES.` };
      if (slot.free - mine(doc.id, date) <= 0) return { ok: false, error: `${date} is full. Offer another date.` };
      if (!patient || patient.length < 2) return { ok: false, error: "Ask the patient's name first." };
      if (ctx.sandbox) {
        const pending = ctx.mem.pendingTestBooking;
        const confirms = TEST_BOOKING_YES.test(ctx.lastCaller.trim());
        if (!confirms || !pending || pending.doctorId !== doc.id || pending.date !== date || pending.patient !== patient) {
          ctx.mem.pendingTestBooking = { doctorId: doc.id, doctor: doc.name, date, patient, fee: doc.fee };
          return { ok: false, needs_confirmation: true, doctor: doc.name, date, patient, fee: doc.fee };
        }
        delete ctx.mem.pendingTestBooking;
      }
      if (!callerAgreed(ctx.lastCaller)) return { ok: false, error: "The caller has not clearly agreed yet. Read back name, doctor, date and fee, and ask them to confirm." };
      const b: AgentBooking = { doctorId: doc.id, doctor: doc.name, date, patient, fee: doc.fee };
      ctx.mem.bookings.push(b);
      ctx.setBooked(b);
      return ctx.sandbox ? { ok: true, test_booking: b } : { ok: true, booked: b, whatsapp: HOSPITAL_INFO.afterBooking };
    }
    case "log_for_team": {
      ctx.mem.forTeam.push(String(args.summary ?? "").slice(0, 200));
      return { ok: true, say: "Tell the caller the team will check and update them." };
    }
    case "end_call": {
      ctx.setOutcome({ kind: OUTCOME_MAP[String(args.outcome)] ?? "enquiry_answered", callbackTime: (args.callback_time as string | null) ?? null, note: (args.note as string | null) ?? (args.outcome === "wrong_number" ? "Wrong number" : null) });
      return { ok: true, say: "Say a short warm goodbye now." };
    }
  }
  return { ok: false, error: `Unknown tool ${name}` };
}

/** After an acknowledgement was already played, drop a second one at the start ("హా అండి, మా దగ్గర…" → "మా దగ్గర…"). */
export function stripAck(text: string): string {
  const out = text.replace(/^\s*(?:(?:హా|హ|ఆ|ఓకే|ok|okay|సరే|అలాగే|sure|right|got it|అర్థమైంది|yes|yeah)(?:\s+అండి)?\s*[,.!—–-]?\s+)+/iu, "");
  return out.length >= 2 ? out.charAt(0).toUpperCase() + out.slice(1) : text;
}

/** A first sentence worth speaking on its own: ends with . ? ! and is long enough to sound natural. */
export function firstSentence(text: string): string | null {
  const re = /[.?!।](?=\s|$)/gu;
  for (let m; (m = re.exec(text)); ) {
    const s = text.slice(0, m.index + 1).trim();
    if (/(?:\b(?:Dr|Mr|Mrs|Ms|Prof|No|St|vs|a\.m|p\.m)|\b[A-Z])\.$/u.test(s)) continue; // "Dr. Viswanath", "S. Lakshmi"
    if ([...s].length < 4) continue;
    if (m.index + 1 >= text.length) return null; // only complete once the next sentence has started
    return HUMAN_CLAIM.test(s) ? null : s;
  }
  return null;
}

/** Streaming request: calls onFirst with the first sentence as soon as it is complete; returns the final response. */
async function postStream(body: Record<string, unknown> | unknown, diag: LlmDiag, onFirst: (t: string) => void, ackPlayed = false): Promise<unknown> {
  const cfg = getConfig();
  if (!cfg.openaiKey) {
    const error: ProviderError = { kind: "not_configured", message: "OPENAI_API_KEY missing" };
    diag.error = { ...error, summary: describeError(error, "OpenAI") };
    throw new Error(diag.error.summary);
  }
  const out = await fetchWithPolicy(`${cfg.openaiBaseUrl}/responses`, {
    method: "POST", headers: { Authorization: `Bearer ${cfg.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...(body as object), stream: true }),
  }, cfg.agentTimeoutMs);
  diag.retried ||= out.retried;
  if (out.error || !out.res?.body) {
    const e: ProviderError = out.error ?? { kind: "bad_output", message: "no stream" };
    diag.error = { ...e, summary: describeError(e, "OpenAI") };
    throw new Error(diag.error.summary);
  }
  const reader = out.res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let sent = false;
  let final: unknown = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      let ev: { type?: string; delta?: string; response?: unknown };
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === "response.output_text.delta" && ev.delta) {
        text += ev.delta;
        if (!sent) { const f = firstSentence(ackPlayed ? stripAck(text) : text); if (f && (!ackPlayed || stripAck(text) !== text || text.length > 12)) { sent = true; onFirst(f); } }
      } else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
        final = ev.response;
      } else if (ev.type === "response.failed" || ev.type === "error") {
        throw new Error(`OpenAI stream failed: ${data.slice(0, 200)}`);
      }
    }
  }
  if (!final) throw new Error("OpenAI stream ended without a response");
  return final;
}

async function post(body: unknown, diag: LlmDiag): Promise<unknown> {
  const cfg = getConfig();
  if (!cfg.openaiKey) {
    const error: ProviderError = { kind: "not_configured", message: "OPENAI_API_KEY missing" };
    diag.error = { ...error, summary: describeError(error, "OpenAI") };
    throw new Error(diag.error.summary);
  }
  const out = await fetchWithPolicy(`${cfg.openaiBaseUrl}/responses`, {
    method: "POST", headers: { Authorization: `Bearer ${cfg.openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, cfg.agentTimeoutMs);
  diag.retried ||= out.retried;
  if (out.error || !out.res) {
    const e: ProviderError = out.error!;
    diag.error = { ...e, summary: describeError(e, "OpenAI") };
    throw new Error(diag.error.summary);
  }
  return out.res.json();
}
