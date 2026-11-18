// Ravi — the AI phone agent for Sai Viswas Hospital.
// The model writes every reply (so it can answer anything, rephrase, calm an upset caller), but:
//  - facts come only from the knowledge base (src/lib/hospital/knowledge.ts) in its instructions;
//  - bookings go through tools that the CODE checks (real doctor, real date, free capacity, a name,
//    and a clear yes from the caller) — the model cannot invent a slot or overbook;
//  - emergencies, "never call me again" and silence are handled by code before the model runs;
//  - it never claims to be human (checked after the model replies).

import { getConfig } from "../config";
import { DOCTORS_KB, HOSPITAL_INFO, knowledgeText, type Doctor } from "../hospital/knowledge";
import { PATIENT_CALLS } from "../hospital/data";
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
}

/** Short acknowledgements the browser plays the instant the caller stops talking (pre-generated in Ravi's voice). */
export const ACKS = { te: ["హా అండి.", "ఓకే అండి.", "అర్థమైంది అండి.", "సరే అండి."], en: ["Sure.", "Okay.", "Right.", "I see."] };

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
  return `You are Ravi (రవి), a warm, polite, sharp front-desk executive at Sai Viswas Hospital, Kakinada, speaking on the phone.
${purpose}

HOW YOU TALK (most important)
- Sound like a real, friendly person from Andhra on the phone — never like a script or an IVR. Keep it SHORT: usually under 25 words; give only the facts asked for (don't dump timings, packages and home-visit prices unless asked). One question at a time.
- Start almost every reply with a tiny acknowledgement as its own sentence, the way people do on the phone — "హా అండి." / "ఓకే అండి." / "అర్థమైంది అండి." / "Sure." / "Got it." — then the answer. Vary it; don't use the same one twice in a row.
- Language: mirror the caller. If they speak English → reply fully in natural Indian English. If they speak Telugu or mixed (Tenglish/romanized Telugu) → reply in natural Tenglish: Telugu words in Telugu script, everyday English words in English letters (appointment, doctor, fee, date, available, slot, confirm, booking, reports, timings, WhatsApp, sorry, okay, perfect). Dates/times/money in English: "November 22", "10 AM", "100 rupees". Never old/formal Telugu (తేదీ, ఏర్పాటు, చీటీ, క్షమించండి, ఉదయం→morning) — use how people actually talk.
- Natural acknowledgements: "హా అండి", "ఓకే అండి", "Perfect అండి", "తప్పకుండా అండి", "అర్థమైంది అండి". Address people with గారు.
- NEVER repeat a previous reply word for word. If you must say something again, say it differently and shorter. If the caller says you sound scripted/repetitive, apologise lightly and continue more naturally.
- Line checks: "హలో, లైన్‌లో ఉన్నారా?" → "హా వినిపిస్తుంది అండి, చెప్పండి." (then continue where you were, briefly). "Hello, can you hear me?" → "Yes, I can hear you, please go ahead."
- Upset or angry caller: stay calm and kind, apologise sincerely for the trouble, don't argue or defend, acknowledge the feeling, then offer the most helpful next step. Never be sarcastic.
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
Ravi: Dr. Viswanath గారు cardiologist అండి. ఈ month November 22, 25 dates లో available ఉన్నారు. Consultation fee కేవలం 100 rupees మాత్రమే అండి.
Caller: Ma nannagari heart checkup kosam chupinchali, old reports kooda unnayi.
Ravi: అవునండి, పక్కాగా చూపించాలి. Old reports, scanning reports, medication details ఏమున్నా తీసుకురండి, doctor గారు check చేసి proper గా guide చేస్తారు. November 22 కి కావాలా, 25 కి కావాలా? మీ పేరు చెప్తే ఇప్పుడే slot lock చేస్తాను.
Caller: Na peru Ramesh andi. November 22 ki okati confirm cheseyandi.
Ravi: (book_appointment → ok) Perfect అండి Ramesh గారు! November 22 కి appointment confirm అయిపోయింది. Booking details, hospital location మీ WhatsApp కి ఇప్పుడే పంపిస్తున్నాను. Old reports మర్చిపోకుండా తీసుకురండి. Thank you, take care!`;
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
  /** Bookings by other calls: "doctorId|date" → count. */
  taken?: Record<string, number>;
  /** For tests: replaces the OpenAI request. */
  request?: (body: unknown) => Promise<unknown>;
  /** The browser already played a short acknowledgement ("హా అండి.") — the model should not start with one. */
  ackPlayed?: string | null;
  /** Called once with the reply's first sentence while the model is still writing (to start the voice early). */
  onFirst?: (text: string) => void;
}

const HUMAN_CLAIM = /\b(?:i am|i'm)\s+(?:a\s+)?(?:real\s+)?(?:human|person)\b|నేను\s+(?:నిజమైన\s+)?మనిషి(?:నే|ని)/iu;

export async function agentTurn(prev: SessionState, raw: string, interrupted: boolean, opts: AgentOptions = {}): Promise<{ state: SessionState; segments: { text: string; cacheable: boolean }[]; outcome: Outcome | null; diag: LlmDiag | null }> {
  const call = PATIENT_CALLS.find((p) => p.id === prev.orderId);
  if (!call) throw new Error(`Unknown call ${prev.orderId}`);
  const now = opts.now ?? new Date();
  const mem: AgentMemory = structuredClone(prev.agent ?? newAgentMemory());
  const state: SessionState = { ...prev, agent: mem, turn: prev.turn + 1 };
  const text = raw.trim();
  const lang = detectLang(text);
  if (lang) mem.lang = lang;
  const en = mem.lang === "en";
  const L = (te: string, e: string) => (en ? e : te);

  const reply = (line: string, outcome: Outcome | null = null, diag: LlmDiag | null = null, close = false) => {
    mem.history.push({ who: "ravi", text: line });
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
  mem.history.push({ who: "caller", text: interrupted ? `${text} (interrupted Ravi)` : text });
  const t = clean(text);
  if (/ఊపిరి ఆడటం లేదు|can.?t breathe|not breathing|unconscious|స్పృహ (?:లేదు|తప్పి)|collapsed|heart attack|(?:ఇప్పుడు|now|right now)[^.]{0,25}(?:ఛాతీ నొప్పి|chest pain)/u.test(t) && !/నొప్పి (?:ఏమీ )?లేదు|no pain/u.test(t)) {
    return reply(L("ఇది emergency లా ఉంది అండి. వెంటనే 108 కి call చేయండి, లేదా మా emergency number 0884-2345600 కి call చేయండి. మా team కి కూడా ఇప్పుడే inform చేస్తున్నాను.",
      "This sounds like an emergency. Please call 108 right now, or our emergency number 0884-2345600. I'm informing our team too."), record("urgent_referral", "Caller described possible emergency symptoms"), null, true);
  }

  // Keep the number in code, so corrections and partial STT never become confirmed callbacks.
  const numberRequest = /(?:(?:another|different|other|new|callback) (?:phone )?number|(?:note|take|write down|call) (?:the|this|that|a) (?:phone )?number|(?:ఇంకో|వేరే|కొత్త) (?:ఫోన్ |phone )?(?:నంబర్|నెంబర్|number)|(?:number|నంబర్|నెంబర్)[^.]{0,35}(?:చెప్తా|చెబుతా|note))/iu;
  if (mem.callbackDigits !== undefined || numberRequest.test(text)) {
    const current = mem.callbackDigits ?? "";
    const reset = /wrong (?:phone )?number|start over|from the beginning|tell (?:it|you|the number) again|తప్పు|మళ్ళీ చెప్త|మళ్లీ చెప్త/iu.test(text);
    const words: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
    const parts = text.replace(/[౦-౯]/gu, (digit) => String(digit.charCodeAt(0) - 0x0c66))
      .match(/\d+|\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b/giu) ?? [];
    const spoken = parts.map((part) => words[part.toLowerCase()] ?? part).join("");
    const digits = spoken.length === 12 && spoken.startsWith("91") ? spoken.slice(2) : spoken;
    const valid = (number: string) => /^[6-9]\d{9}$/.test(number);
    const repeat = /(?:repeat|read.{0,10}back|మళ్ళీ చద|మళ్లీ చద)/iu.test(text);

    if (!reset && !repeat && !digits && valid(current) && clearYes(t)) {
      delete mem.callbackDigits;
      return reply(L("థాంక్యూ అండి. Callback request note చేశాను.", "Thank you. I’ve recorded the callback request."),
        record("callback", JSON.stringify({ callbackNumber: "+91" + current })), null, true);
    }

    if (reset) mem.callbackDigits = "";
    else mem.callbackDigits ??= "";
    if (digits) {
      mem.callbackDigits = digits.length >= 10 ? digits : (valid(mem.callbackDigits) ? digits : mem.callbackDigits + digits);
    }
    if (valid(mem.callbackDigits)) {
      const readback = [...mem.callbackDigits].join(", ");
      return reply(L(`నేను విన్న number ${readback}. Correct అండి?`, `I heard ${readback}. Is that correct?`));
    }
    if (mem.callbackDigits.length >= 10) {
      mem.callbackDigits = "";
      return reply(L("పది digits ఉన్న mobile number ఒక్కసారి మళ్లీ చెప్పండి అండి.", "Please say the ten-digit mobile number again."));
    }
    if (mem.callbackDigits.length && !repeat) {
      return reply(L("", ""));
    }
    return reply(L("పది digits ఉన్న mobile number చెప్పండి అండి. నేను వింటాను.", "Please say the ten-digit mobile number. I’m listening."));
  }

  // ----- the model -----
  let res: ModelResult;
  try {
    res = await runModel(call, mem, now, opts, text);
  } catch (e) {
    res = { text: "", outcome: null, booked: null, diag: { called: true, ok: false, model: getConfig().agentModel, effort: "", maxOutputTokens: 0, latencyMs: 0, retried: false, usage: null, error: { kind: "network", message: String(e), summary: String(e) } } };
  }
  if (!res.text) {
    mem.failures++;
    mem.history.pop();
    if (mem.failures >= 2) return reply(L("Sorry అండి, line లో కొంచెం problem ఉంది. మా team మీకు వెంటనే call చేస్తారు. Thank you!", "Sorry, there's a problem on the line. Our team will call you right back. Thank you!"), record("pending_staff", "Agent unavailable"), res.diag, true);
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

async function runModel(call: (typeof PATIENT_CALLS)[number], mem: AgentMemory, now: Date, opts: AgentOptions, lastCaller: string): Promise<ModelResult> {
  const cfg = getConfig();
  const input: unknown[] = mem.history.map((h) => ({ role: h.who === "ravi" ? "assistant" : "user", content: h.text }));
  // Live data goes in a late message (the long instructions stay identical → prompt caching keeps them fast).
  const mine = (id: string, date: string) => mem.bookings.filter((b) => b.doctorId === id && b.date === date).length;
  const free = DOCTORS_KB.map((d) => `${d.id}: ${availability(d, now, opts.taken ?? {}).filter((a) => a.free - mine(d.id, a.date) > 0).slice(0, 4).map((a) => `${a.date} ${a.day.slice(0, 3)}`).join(", ") || "none"}`).join(" | ");
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const nowText = `${DAY[ist.getUTCDay()]} ${iso(ist)} ${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")} IST`;
  input.push({ role: "developer", content: `NOW: ${nowText} (today's dates are bookable only if the doctor's timings today haven't ended)\nFREE DATES: ${free}\nAlready booked in this call: ${mem.bookings.map((b) => `${b.patient} ${b.doctor} ${b.date}`).join("; ") || "none"}\nCaller language now: ${mem.lang === "en" ? "ENGLISH — reply in English" : "Telugu/Tenglish — reply in natural Tenglish"}.${opts.ackPlayed ? `\nYou ALREADY said "${opts.ackPlayed}" a moment ago — do NOT start with an acknowledgement (no హా/ఓకే/sure/okay); go straight into the answer, and keep your FIRST sentence short (under 8 words, ending with a full stop).` : ""}` });
  let booked: AgentBooking | null = null;
  let outcome: ModelResult["outcome"] = null;
  const diag: LlmDiag = { called: true, ok: false, model: cfg.agentModel, effort: cfg.agentEffort, maxOutputTokens: 700, latencyMs: 0, retried: false, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 } };
  const t0 = Date.now();
  // Words said in a round that also called a tool ("ఒక్క నిమిషం, book చేస్తున్నాను") are kept and joined to the final reply.
  let pre = "";
  let firstSent = false;
  let spokenThisRound = "";
  const onFirst = opts.onFirst ? (f: string) => { if (!firstSent) { firstSent = true; spokenThisRound = f.slice(pre ? pre.length + 1 : 0); opts.onFirst!(f); } } : undefined;
  for (let round = 0; round < 4; round++) {
    spokenThisRound = "";
    const body = {
      model: cfg.agentModel, instructions: instructions(call, now), input, tools: TOOLS, store: false,
      reasoning: { effort: cfg.agentEffort }, max_output_tokens: 700, parallel_tool_calls: false, include: ["reasoning.encrypted_content"],
    };
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
      const result = runTool(fc.name!, args, { mem, now, taken: opts.taken ?? {}, lastCaller, setBooked: (b) => (booked = b), setOutcome: (o) => (outcome = o) });
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
  mem: AgentMemory; now: Date; taken: Record<string, number>; lastCaller: string;
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
      if (!callerAgreed(ctx.lastCaller)) return { ok: false, error: "The caller has not clearly agreed yet. Read back name, doctor, date and fee, and ask them to confirm." };
      const b: AgentBooking = { doctorId: doc.id, doctor: doc.name, date, patient, fee: doc.fee };
      ctx.mem.bookings.push(b);
      ctx.setBooked(b);
      return { ok: true, booked: b, whatsapp: HOSPITAL_INFO.afterBooking };
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
  if (!cfg.openaiKey) throw new Error("OPENAI_API_KEY missing");
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
  if (!cfg.openaiKey) throw new Error("OPENAI_API_KEY missing");
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
