// Sai Viswas Hospital phone agent ("Ravi"). Two uses:
//  - outbound: tell a patient a doctor is visiting and book a date;
//  - inbound: answer the hospital number, give information, book a date.
// Every fact comes from src/lib/hospital/data.ts; anything else goes to reception.
// Clear replies are handled by these rules; a reply they can't place goes to the model once
// (turn.ts), which only labels it — the rules still decide, so the model can never book.
// Style: like the reference call — short "ఓకే అండి / Perfect అండి", Telugu glue with English
// for dates, money and key words; if the caller speaks English, the agent answers in English.

import { DOCTORS, HOSPITAL, PATIENT_CALLS, doctorFor, freeDates, type PatientCall, type VisitingDoctor } from "../hospital/data";
import { teluguNumber } from "../telugu/numbers";
import type { StepResult } from "./engine";
import type { Outcome, OutcomeKind, SessionState } from "./types";

export const isHospitalCall = (id: string) => id.startsWith("HSP-");
export const findPatientCall = (id: string) => PATIENT_CALLS.find((p) => p.id === id) ?? null;

export type HospitalStep = "open" | "identify" | "offer" | "date" | "name" | "readback" | "callback_time" | "rebook";
export type Lang = "te" | "en";

export interface HospitalDraft {
  step: HospitalStep;
  doctorId: string;
  direction: "outbound" | "inbound";
  /** Chosen visit date (YYYY-MM-DD). */
  date: string | null;
  /** Patient name for the booking (known for outbound, asked for inbound). */
  name: string | null;
  onBehalf: boolean;
  /** Language of the caller's last clear reply; the agent answers in it. */
  lang: Lang;
  silence: number;
  /** Questions the agent could not answer — passed to reception with the call record. */
  notes: string[];
  medicalAsked: number;
  /** The doctor's dates and fee were already said (don't repeat them in full). */
  toldDates: boolean;
  askedNextVisit: boolean;
  robotAnswered?: boolean;
}

export function initialHospital(call: PatientCall): HospitalDraft {
  return {
    step: call.direction === "inbound" ? "open" : "identify", doctorId: call.doctorId, direction: call.direction,
    date: null, name: call.patientName, onBehalf: false, lang: "te", silence: 0, notes: [], medicalAsked: 0,
    toldDates: false, askedNextVisit: false,
  };
}

/** Bookings already recorded by other calls, per date, for one doctor. */
export function takenSlots(outcomes: Pick<Outcome, "kind" | "detail">[], doctor: VisitingDoctor): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of outcomes) {
    if (o.kind !== "appointment_booked" || !o.detail) continue;
    try {
      const d = JSON.parse(o.detail) as { doctorId?: string; date?: string };
      if (d.doctorId === doctor.id && d.date) out[d.date] = (out[d.date] ?? 0) + 1;
    } catch { /* ignore */ }
  }
  return out;
}

/** "లక్ష్మి గారు" → "లక్ష్మి గారి" (before తో / కి). */
const obl = (name: string) => name.replace(/గారు$/u, "గారి");

export function hospitalOpening(call: PatientCall): string {
  if (call.direction === "inbound") {
    return `నమస్కారం అండి! ${HOSPITAL.spokenNameTe} నుంచి ${HOSPITAL.agentNameTe} మాట్లాడుతున్నాను. చెప్పండి అండి, మీకు ఎలా help చేయగలను?`;
  }
  return `నమస్కారం అండి. నేను ${HOSPITAL.agentNameTe}, ${HOSPITAL.spokenNameTe} నుంచి మాట్లాడుతున్నాను. ${obl(call.nameTe!)}తో మాట్లాడుతున్నానా?`;
}

const STAGE: Record<HospitalStep, SessionState["stage"]> = {
  open: "opening", identify: "opening", offer: "confirm", date: "confirm", name: "change_details", readback: "change_readback", rebook: "confirm", callback_time: "callback_time",
};

/**
 * One reply = one audio take (stitched sentences restart the intonation and sound robotic).
 * "morning…" at the start of a sentence → "Morning…".
 */
export function toSegments(line: string): { text: string; cacheable: boolean }[] {
  const text = line.replace(/(^|[.?!]\s+)([a-z])/gu, (_m, p: string, c: string) => p + c.toUpperCase());
  return [{ text, cacheable: false }];
}

// ---------- understanding the caller ----------
// Speech recognition adds commas and full stops; drop them so "అవును, బుక్ చేయండి." still matches.
export const clean = (raw: string) => raw.replace(/[\u200b-\u200d\ufeff]/gu, "").trim().toLowerCase()
  .replace(/[౦-౯]/gu, (d) => String(d.charCodeAt(0) - 0x0c66))
  .replace(/[.,!?;"“”‘’()…।|]+/gu, " ")
  .replace(/(?<!\d):|:(?!\d)/gu, " ")
  .replace(/\s+/gu, " ")
  .trim();

/** Which language to answer in. Telugu script or romanized Telugu → "te"; plain English → "en"; unsure → null (keep). */
const EN_WORDS = /\b(?:the|is|are|was|what|when|where|how|which|can|could|would|will|should|i|i'm|im|my|me|you|your|please|want|need|have|has|do|does|for|and|it|this|that|there|with|about|yes|no|okay|sure|thank|thanks|hello|hi|book|appointment|doctor|fee|much|time|date|morning|evening|tomorrow|today|good|fine|of|to|a|an|in|on|at|be|am|we|our|he|she|his|her|father|mother)\b/gu;
const TE_ROMAN = /\b(?:andi|garu|gaaru|ledu|ledhu|undi|unnayi|unnaru|cheyandi|cheyyandi|cheppandi|chepandi|kavali|kaavali|entha|enta|ekkada|eppudu|vastharu|vastaru|vastanu|nenu|naa|na|mee|meeru|ki|lo|ga|avunu|avnu|sare|haa|amma|nanna|nannagaru|chala|kosam|emi|enti|ela|bagundi|matladutunna|peru|okati|rendu|chupinchali|chupinchukovali|kuda|kooda|ippudu|appudu|ante|mari|aithe|vaddu|kaadu|cheseyandi|pettandi|istaru|chestaru|ayindi|aipoindi)\b/gu;
export function detectLang(raw: string): Lang | null {
  const teScript = (raw.match(/[ఀ-౿]+/gu) ?? []).length;
  const latin = raw.toLowerCase().match(/[a-z']+/gu) ?? [];
  const en = (raw.toLowerCase().match(EN_WORDS) ?? []).length;
  const teRoman = (raw.toLowerCase().match(TE_ROMAN) ?? []).length;
  if (teScript > 0) return teScript >= Math.max(1, Math.floor(latin.length / 3)) ? "te" : en >= 3 && teScript <= 1 ? "en" : "te";
  if (teRoman > 0 && teRoman >= en / 2) return "te";
  if (en >= 2 || (en >= 1 && latin.length <= 2 && teRoman === 0)) return "en";
  return null;
}

const FILLER = /^(?:(?:ఆ|హా|హ|ఓహో|ఓహ్|ఓ|అ|ha|haa|hmm|um|oh|అండి|ఓకే ఓకే)\s+)+/u;
const stripFill = (t: string) => t.replace(FILLER, "");
/** "no problem" / "పర్లేదు" are agreement, not refusal. */
const NOT_NEG = /(?:no|ఏ|ఏమీ) problem(?: లేదు)?|పర్లేదు|ఇబ్బంది (?:ఏమీ )?లేదు|no issue|not bad/gu;
const NEG = /(?:^|\s)(?:no|nope|not|don.?t|వద్దు|వద్దండి|వద్దులే|వొద్దు|లేదు|లేదండి|కాదు|కాదండి|కుదరదు|vaddu|ledu|kaadu)(?:\s|$)/u;
const hasNeg = (t: string) => NEG.test(t.replace(NOT_NEG, " "));
const YES_START = /^(?:yes|yeah|yep|ok|okay|sure|fine|confirm|book|బుక్|అవును|అవునండి|అవునమ్మా|సరే|సరేనండి|సరేలే|ఓకే|షూర్|అలాగే|తప్పకుండా|చేయండి|చేసేయండి|కానివ్వండి|పర్లేదు|avunu|avunandi|sare|ok|perfect|please do|go ahead)(?:\s|$)/u;
const YES_ANY = /(?:book|బుక్|confirm|కన్ఫర్మ్|lock) (?:చేయండి|చేసేయండి|చెయ్యండి|చేయి|చెయ్|it|cheyandi|cheyyandi|cheseyandi|chesey)|book చేసుకోండి|please (?:book|confirm)|(?:book|confirm) (?:it|that|please)/u;
/** A clear yes: not a bare "ఆ"/"హా", no refusal words. Used before booking. */
export const clearYes = (t: string) => !hasNeg(t) && (YES_START.test(stripFill(t)) || YES_ANY.test(t));
const LOOSE = /^(?:ఆ|హా|హ|ఓహో|ha|haa|హ్మ్|hmm)(?: అండి)?$|^(?:ఆ |హా )?(?:చెప్పండి|కావాలి|interested|ఇంట్రెస్ట్ ఉంది|cheppandi)/u;
/** Any yes, including "ఆ" — fine for "shall I book?", never for the final confirmation. */
const yes = (t: string) => clearYes(t) || (!hasNeg(t) && LOOSE.test(t));
const NO_START = /^(?:no|nope|వద్దు|వద్దండి|వద్దులే|వొద్దు|లేదు|లేదండి|అవసరం లేదు|not interested|interest లేదు|ఇంట్రెస్ట్ లేదు|ఇప్పుడు వద్దు|vaddu|ledu|not now)(?:\s|$)/u;
const no = (t: string) => NO_START.test(stripFill(t));

const BOOK = /book|బుక్|appointment|అపాయింట్మెంట్|slot|స్లాట్|checkup|చెకప్|చూపించ|chupinch|see the doctor|(?<!తీసుకు)(?<!తీసుకు )రావాలి|వస్తాను|వస్తాం|కావాలి|kavali/u;
const BUSY = /\bbusy\b|call (?:me )?later|later call|call ?back|కాల్ ?బ్యాక్|(?:సాయంత్రం|రేపు|రాత్రి|evening|tomorrow|night) (?:call|కాల్|ఫోన్|phone|మాట్లాడ)|వంటలో ఉన్నా|పనిలో ఉన్నా|బిజీ|(?:తర్వాత|తరువాత) (?:call|కాల్|మాట్లాడ|చేయండి|చెయ్యండి|ఫోన్)|ఇప్పుడు కుదరదు|ఇప్పుడు మాట్లాడలేను|\bdriving\b|drive చేస్తున్నా|బయట ఉన్నా|in a meeting/u;
/** A time-of-day in a busy reply ("సాయంత్రం call back చేయండి") — enough to schedule the callback. */
const CALLBACK_WHEN = /సాయంత్రం|రాత్రి|రేపు|మధ్యాహ్నం|ఉదయం|evening|night|tomorrow|morning|afternoon|lunch|\d|గంటలకి|గంటకి|o.?clock|\bpm\b|\bam\b/u;
/** Refusing the checkup itself — checked before "book" so "book చేయొద్దు" is not a yes. */
const REFUSE = /అవసరం లేదు|అక్కర్లేదు|అక్కర లేదు|book (?:వద్దు|చేయొద్దు|చెయ్యొద్దు|చేయకండి)|బుక్ (?:వద్దు|చేయొద్దు|చెయ్యొద్దు)|(?:checkup|చెకప్|appointment) వద్దు|not interested|no need|don.?t (?:want|need)|interest లేదు|ఇంట్రెస్ట్ లేదు|already (?:చూ|saw|seen|చూపించ|consulted|visited)|already.{0,30}(?:chusanu|chusesanu|chupinchukunna|choopinchanu)|(?:book |appointment )?(?:cheyyanu|cheyanu|cheyyakandi|avasaram ledu|akkarledu)\b/u;
const THINK = /let me think|think about it|ఆలోచించి|ఇంట్లో అడిగి|అడిగి చెప్తా|discuss చేసి|i.ll (?:check|ask|discuss)/u;
/** Only "never call me again". */
const DNC = /stop calling|do not call (?:me|this|again)|don.?t call (?:me|this|again)|never call|(?:మళ్లీ|మళ్ళీ|ఇంకెప్పుడూ|ఇక|ఇంకోసారి|ఈ నంబర్ కి|ఈ number కి)\s?(?:నాకు )?(?:call|కాల్|ఫోన్) (?:చేయొద్దు|చేయకండి|చెయ్యొద్దు|చేయవద్దు)/u;
const WRONG_NUMBER = /wrong number|wrong person|రాంగ్ నంబర్|రాంగ్ నెంబర్|తప్పు (?:నెంబర్|నంబర్|number)|tappu number|(?:గారు|garu)? ?(?:కాను|kaanu)\b|(?:ఆవిడ|వాళ్ళు|ఆ పేరు|ఆయన)\S* (?:ఎవరో |ఎవరు )?(?:నాకు )?(?:తెలియదు|తెలీదు)|(?:తెలియదు|తెలీదు).{0,15}ఎవరు|(?:ఎవ్వరూ|ఎవరూ) లేరు|అలాంటి వాళ్ళు|no one (?:by|named)|don.?t know (?:any|her|him|who)/u;
const NOT_HOME = /నేను కాదు|వాళ్ళు లేరు|ఆమె లేరు|ఆవిడ లేరు|అతను లేరు|ఆయన లేరు|ఇక్కడ లేరు|ఇంట్లో లేరు|\bnot here\b|not available|not at home|is out/u;
const BEHALF = /(?:నేను )?(?:వాళ్ళ|ఆమె|అతని|ఆవిడ|మా అమ్మ|మా నాన్న)?\s*(?:అబ్బాయి|అమ్మాయి|కొడుకు|కూతురు|భర్త|భార్య|కోడలు|అల్లుడు|son|daughter|husband|wife|daughter-in-law)(?:ని|ను)?(?![a-z])|on (?:her|his) behalf|(?:i.m|this is) (?:her|his)|మాట్లాడొచ్చు నాతో/u;
const ME = /(?:^|\s)(?:నేనే|నేను మాట్లాడుతున్నా|nene|nenu matladutunna)|speaking|this is (?:she|her|him|me)|it.s me|yes (?:it is|this is)/u;
// Emergencies: hard signs always; pain "now/severe" only when they did not say it is gone.
const EMERGENCY_HARD = /ఊపిరి ఆడటం లేదు|ఊపిరి ఆడట్లేదు|can.?t breathe|not breathing|unconscious|స్పృహ (?:లేదు|తప్పి)|\bfits\b|\bstroke\b|పక్షవాతం|కళ్ళు తిరిగి పడిపోయ|collapsed|heart attack/u;
const EMERGENCY_SOFT = /(?:ఇప్పుడు|ఇప్పుడే|\bnow\b|right now|చాలా ఎక్కువ|ఎక్కువగా|\bsevere\b)[^.]{0,30}(?:నొప్పి|\bpain\b|ఊపిరి|\bbreath)|(?:నొప్పి|\bpain\b)[^.]{0,20}(?:ఇప్పుడు|ఇప్పుడే|\bnow\b|తగ్గడం లేదు|ఎక్కువగా|చాలా|severe)/u;
const PAIN_GONE = /నొప్పి (?:ఏమీ |ఏం |ఇప్పుడు )?(?:లేదు|లేదండి|తగ్గింది)|(?:ఇప్పుడు|now) (?:ఏమీ |ఏం )?(?:లేదు|no pain|fine|బాగానే)|\bno pain\b|not (?:any )?pain|pain (?:is )?(?:gone|not)|ఏమీ లేదు/u;
const emergency = (t: string) => EMERGENCY_HARD.test(t) || ((EMERGENCY_SOFT.test(t) || (/emergency/u.test(t) && /నొప్పి|\bpain\b|ఊపిరి|breath/u.test(t))) && !PAIN_GONE.test(t));
const PAIN = /ఛాతీ నొప్పి|chest pain|గుండె నొప్పి|ఆయాసం|breathless/u;
const WHY = /ఎందుకు (?:call|కాల్|ఫోన్)|ఏంటి విషయం|ఏం విషయం|విషయం ఏంటి|దేని గురించి|ఏం గురించి|why (?:are you )?call|what is this about|what.s this about/u;
const ROBOT = /robot|\bbot\b|\bai\b|machine|మనిషా|రోబో|recording|real person|human|computer/u;
const WHO = /who (?:is this|are you|is speaking)|ఎవరు మాట్లాడుతున్నారు|మీరు ఎవరు|ఎవరండి/u;
const HOLD = /^(?:ఒక్క నిమిషం|one minute|hold on|wait|ఆగండి|ఉండండి|ఒక్క సెకన్|just a (?:minute|second))/u;
const REPEAT = /repeat|మళ్లీ చెప్ప|మళ్ళీ చెప్ప|అర్థం కాలేదు|^what$|^ఏంటి$|వినపడలేదు|sorry\s*$|pardon|come again/u;
/** "సరే thank you", "ok thanks, bye" — ending the call (needs a thanks/bye word, so a plain "ok" is still a yes). */
const BYE = /^(?:(?:ok|okay|సరే|ఓకే|అలాగే|sure|fine)\s+)?(?:thank you|thanks|థాంక్యూ|థాంక్స్|bye|ఉంటాను|ఉంటానండి)(?:\s+(?:అండి|andi|bye|so much|thank you|ఉంటాను|ఉంటానండి|sir|madam))*$/u;
const NEXT_VISIT = /తర్వాతి visit|తర్వాతి సారి|వచ్చే సారి|next visit|next time|ఇంకోసారి వచ్చినప్పుడు/u;
const OTHER_DAY = /వేరే రోజు|ఇంకో రోజు|another day|other day|different day|next week|వచ్చే వారం|ఆ రోజు (?:కుదరదు|రాలేను|ఊరిలో లేను|ఉండను)|(?:రెండు|both|ఆ రెండు) (?:రోజులు|days|dates)? ?(?:కుదరదు|కష్టం|రాలేను|can.?t|not possible)/u;
const DAY_NO = /కష్టం|వద్దు|కుదరదు|కుదరట్లేదు|రాలేను|రాలేము|function|ఫంక్షన్|పెళ్లి|ఊరిలో లేను|ఊర్లో ఉండను|can.?t come|not possible|won.?t be|not free/u;
/** A question we have no data for (parking, canteen, other departments…) — reception answers it. */
const ASKS = /ఉందా|ఉన్నాయా|ఉంటుందా|ఉంటాయా|ఎలా|ఎందుకు|ఏమిటి|ఇస్తారా|చేస్తారా|\b(?:is there|do you have|can i|how|why|does|is it)\b/u;

const Q = {
  fee: /(?:know|tell|what|about|and)[^.]{0,30}\bfees?\b|(?:\bfees?\b|ఫీజు|ఫీ)[^.,]{0,15}(?:ఎంత|entha|enta)|\bfees?\b\s*(?:as well|also|too)|(?:\bfees?\b|ఫీజు|ఫీ|charge|\bcost\b|consultation|charges)\S*\s*(?:ఎంత|entha|enta|how much|ఉంటుందా|\?|what)|how much|ఎంత (?:అవుతుంది|తీసుకుంటారు|కట్టాలి)|డబ్బులు ఎంత|what.s the fee|what is the fee|fee entha/u,
  when: /\bwhen\b|what time|(?:time|టైం|టైమ్) ఏంటి|timing|which day|which date|\bdates?\b|ఎప్పుడు|ఏ రోజు|ఏ టైం|ఏ time|ఎన్ని గంటలకి|ఏ సమయం|తేదీ|eppudu|available/u,
  hours: /(?:morning|evening|afternoon|ఉదయం|సాయంత్రం|మధ్యాహ్నం|పొద్దున)\s?(?:slot|time|టైం|టైమ్|పూట)|what time|timing|ఏ time|ఏ టైం|ఎన్ని గంటలకి|ఏ సమయం|time ఏంటి|hours|morning (?:or|లేదా)|ఉదయమా/u,
  where: /\bwhere\b|address|location|ఎక్కడ|అడ్రస్|ఏ ఊరు|ekkada/u,
  doctor: /which doctor|what doctor|specialist|qualification|ఏ డాక్టర్|ఎవరు డాక్టర్|ఏం డాక్టర్|డాక్టర్ ఎవరు|who is the doctor|cardiologist ఆ|heart doctor ఆ/u,
  others: /other doctors?|any other (?:doctor|specialist)|ఇంకా ఏ డాక్టర్|వేరే డాక్టర్|ఇంకెవరు|other department|gynec|ortho|dentist|child specialist|pediatric/u,
  bring: /what (?:to|should i|do i) bring|(?:ఏమేమి|ఏం|ఏమి|ఏమైనా|ఏవైనా|ఇంకేమైనా|ఇంకా ఏమైనా|reports?)\s?.{0,20}(?:తీసుకురావాల|తీసుకు రావాల|తేవాల|తీసుకురావాలో)|తీసుకురావాలా|teesukura|old reports|పాత reports|పాత రిపోర్ట్|reports (?:ఉన్నాయి|unnayi|are there|i have)/u,
  medical: /fasting|empty stomach|ఖాళీ కడుపు|tablet|medicine|(?:^|\s)(?:మందు|మందులు|మాత్ర|మాత్రలు|టాబ్లెట్)(?=\s|$)|should i (?:take|stop)|వేసుకోవచ్చా|ఆపాలా|\btests?\b|\becg\b|ఎకో|\becho\b|\bsugar\b|\bbp\b|షుగర్|blood test/u,
  // "ECG facility ఉందా?", "parking ఉందా?" — about the hospital, not medical advice: reception answers.
  facility: /(?:facility|facilities|ఫెసిలిటీ|సదుపాయం|parking|పార్కింగ్|canteen|క్యాంటీన్|lift|wheelchair|pharmacy|medical shop|lab\b)|(?:ecg|scan|scanning|echo|x-?ray|blood test|test)\S*\s?[^?]{0,15}(?:ఉందా|ఉన్నాయా|available|is there|do you have|chestara|chestaru|చేస్తారా|ఉంటుందా)/u,
  reception: /reception|front desk|contact number|phone number|landline|ఫోన్ నంబర్|నంబర్ ఇవ్వండి/u,
  insurance: /insurance|arogyasri|ఆరోగ్యశ్రీ|cashless|discount|free checkup|ఉచితం|emi/u,
};

// ---------- dates ----------
const EN_ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const EN_ORD_ONES = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const TE_WEEK = ["ఆదివారం", "సోమవారం", "మంగళవారం", "బుధవారం", "గురువారం", "శుక్రవారం", "శనివారం"];
const EN_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const isoParts = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; };
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** Ways a caller can say a day of the month: 22, 22nd, ఇరవై రెండు, twenty two, twenty second, iravai rendu. */
function dayPatterns(d: number): RegExp {
  const words: string[] = [`${d}(?:st|nd|rd|th)?`, teluguNumber(d)];
  if (d >= 20 && d < 30) {
    words.push(`twenty[ -]?${EN_ONES[d - 20]}`, `twenty[ -]?${EN_ORD_ONES[d - 20]}`, `(?:iravai|iruvai|iravay)[ -]?(?:${["", "okati", "rendu", "moodu", "nalugu", "aidu", "aaru", "edu", "enimidi", "tommidi"][d - 20]})`);
  }
  return new RegExp(`(?:^|[^\\d\\p{L}\\p{M}])(?:${words.filter((w) => !w.endsWith("[ -]?") && !w.endsWith("(?:)")).join("|")})(?![\\d])`, "u");
}

/** Caller's words → one of the doctor's visit dates (or "other" when they name a day the doctor isn't here). */
export function parseVisitDate(text: string, d: VisitingDoctor, free: { date: string; free: number }[]): string | "other" | null {
  // "22 కాకుండా 25", "not the 22nd, the 25th": the date they want comes after.
  const instead = text.match(/(?:కాకుండా|కాదు|బదులు|instead of|\bnot\b)\s+(.+)$/u);
  if (instead) { const r = parseVisitDate(instead[1], d, free); if (r) return r; }
  const dates = d.visits.map((v) => v.date);
  for (const iso of dates) {
    const p = isoParts(iso);
    if (dayPatterns(p.d).test(text) || text.includes(TE_WEEK[p.dow]) || new RegExp(`\\b${EN_WEEK[p.dow]}\\b`, "u").test(text)) return iso;
  }
  const firstFree = free.find((f) => f.free > 0)?.date ?? null;
  if (/first|earliest|మొదటి|ముందు ది|ముందుది|ఏదైనా|any (?:date|day|one)|whichever|మీ ఇష్టం|ఏ రోజైనా|soonest|nearest/u.test(text)) return firstFree;
  if (/second|last|రెండో|రెండవ|తర్వాతది|later one|చివరి/u.test(text)) return dates[dates.length - 1];
  // A day of the month the doctor isn't here ("23", "ఇరవై మూడు", "Sunday" when not a visit day).
  if (/(?:^|\s)(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?(?:\s|$)/u.test(text) && /date|తేదీ|కి|ki|నాడు|on|th|st|nd|rd/u.test(text)) return "other";
  if (TE_WEEK.some((w) => text.includes(w)) || EN_WEEK.some((w) => new RegExp(`\\b${w}\\b`, "u").test(text))) return "other";
  return null;
}

/** "Na peru Ramesh andi", "నా పేరు రమేష్", "my name is Ramesh" → "Ramesh". */
export function parseName(raw: string, step: HospitalStep): string | null {
  // Keep commas: "Ramesh, the 22nd" — the name ends at the comma.
  const t = raw.trim().replace(/[!?]+/gu, " ").replace(/(?<!(?:^|\s)[A-Za-z])\.(?=\s|$)/gu, ",").replace(/\s+/gu, " ");
  const STOP = "(?:అండి|andi|garu|గారు|అ|and|for|the|please|on|at|to|is|november|నవంబర్|కి|ki|date|తేదీ|book|confirm|\\d)";
  const INITIAL = "(?:[A-Za-z]\\.\\s?)?";
  const re = new RegExp(`(?:(?:for|is) my (?:mother|father|mom|dad|wife|husband|son|daughter|grandmother|grandfather),?|under (?:her |his |the )?(?:name)?:?|in the name of|నా పేరు|నా name|మా నాన్న(?:గారి)? పేరు|మా అమ్మ(?:గారి)? పేరు|patient (?:name|పేరు)|పేరు|na peru|naa peru|nā peru|my name is|name is|name's|this is|i am|i'm|నేను)\\s+(${INITIAL}(?!${STOP})[^\\s,]+(?:\\s+(?!${STOP})[^\\s,]+)?)`, "giu");
  const BAD = /^(?:వాళ్ళ|మా|నా|the|a|patient|calling|from|not|వస్తాను|ఇంట్లో|busy|i.d|like|here|just|also|going|trying|looking)$/iu;
  let name: string | null = null;
  for (const m of t.matchAll(re)) {
    const n = m[1].replace(/(?:\\s+(?:అండి|andi|garu|గారు))+$/iu, "").trim();
    if (n && !BAD.test(n.split(" ")[0])) { name = n; break; }
  }
  if (!name && step === "name") {
    const words = t.replace(/,/gu, " ").split(" ").filter(Boolean).filter((w) => !/^(?:అండి|andi|garu|గారు|ఆ|హా|sir|madam|అమ్మా|ok|okay)$/iu.test(w));
    if (words.length >= 1 && words.length <= 3 && !/\d/u.test(t) && !yes(clean(t)) && !no(clean(t)) && !ASKS.test(clean(t))) name = words.join(" ");
  }
  if (!name) return null;
  name = name.replace(/(?:\s+(?:అండి|andi|garu|గారు))+$/iu, "").replace(/(?:అండి|ని|ను)$/u, "").trim();
  if (!name || /^(?:వాళ్ళ|మా|నా|the|a|patient|calling|from|not|వస్తాను|ఇంట్లో|busy)$/iu.test(name)) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export interface HospitalOptions {
  /** Bookings made by other calls (date → count). */
  taken?: Record<string, number>;
  /** true when this text is the model's label for a reply the rules could not place. */
  fromModel?: boolean;
  /** For "q_other" from the model: mark the question as one for reception. */
  note?: string | null;
  /** The caller's own words (when `raw` is the model's canonical phrase) — used for language and records. */
  original?: string;
}

export type HospitalResult = StepResult & { needsModel?: boolean };

// ---------- the turn ----------
export function hospitalTurn(prev: SessionState, raw: string, interrupted: boolean, opts: HospitalOptions = {}): HospitalResult {
  const call = findPatientCall(prev.orderId);
  if (!call) throw new Error(`Unknown patient call ${prev.orderId}`);
  const draft: HospitalDraft = { ...initialHospital(call), ...structuredClone(prev.hospital ?? {}) } as HospitalDraft;
  const state: SessionState = { ...prev, hospital: draft, turn: prev.turn + 1 };
  const doctor = DOCTORS.find((d) => d.id === draft.doctorId) ?? doctorFor(call);
  const text = clean(raw);
  const words = opts.original ?? raw;
  const lang = detectLang(words);
  if (lang) draft.lang = lang;
  const en = () => draft.lang === "en";
  /** Pick the line for the caller's language. */
  const L = (te: string, enLine: string) => (en() ? enLine : te);
  const taken = opts.taken ?? {};
  const free = freeDates(doctor, taken);
  const open = free.filter((f) => f.free > 0);
  /** Answers to side questions, said before the next step's line. */
  let prefix = "";

  // ----- names, dates, money in both languages -----
  const nameTe = () => (draft.name ? (draft.name === call.patientName && call.nameTe ? call.nameTe : `${draft.name} గారు`) : "");
  const nameEn = () => (draft.name ? (draft.name === call.patientName && call.nameEn ? call.nameEn : draft.name) : "");
  const dateTe = (iso: string) => { const p = isoParts(iso); return `${MONTHS_EN[p.m - 1].replace(/^./u, (c) => c.toUpperCase())} ${p.d}`; };
  const dateEn = (iso: string) => { const p = isoParts(iso); return `${MONTHS_EN[p.m - 1].replace(/^./u, (c) => c.toUpperCase())} ${ordinal(p.d)}`; };
  const dateL = (iso: string) => (en() ? dateEn(iso) : dateTe(iso));
  const datesTe = () => { const ds = doctor.visits.map((v) => isoParts(v.date)); return `${MONTHS_EN[ds[0].m - 1].replace(/^./u, (c) => c.toUpperCase())} ${ds.map((p) => p.d).join(", ")}`; };
  const datesEn = () => { const ds = doctor.visits.map((v) => v.date); return ds.length === 1 ? dateEn(ds[0]) : `${ds.slice(0, -1).map(dateEn).join(", ")} and ${ordinal(isoParts(ds[ds.length - 1]).d)}`; };
  const doctorTe = `${doctor.nameTe}`;
  const feeTe = `Consultation fee కేవలం ${doctor.fee} rupees మాత్రమే అండి.`;
  const feeEn = `The consultation fee is just ${doctor.fee} rupees.`;
  const timingsTe = doctor.hours ? `Timings ${doctor.hours}.` : "Exact timings booking తర్వాత మీ WhatsApp కి వస్తాయి.";
  const timingsEn = doctor.hours ? `Timings are ${doctor.hours}.` : "The exact timings will come to your WhatsApp after booking.";

  const visitInfo = () => L(
    `మన hospital కి ${doctor.specialtyTe} ${doctorTe} వస్తున్నారు, ఈ month ${datesTe()} dates లో available ఉన్నారు. ${feeTe}`,
    `Our ${doctor.specialty.toLowerCase()}, ${doctor.name}, is visiting ${HOSPITAL.name} on ${datesEn()}. ${feeEn}`,
  );
  const askDate = () => {
    if (open.length === 1) {
      return L(`${dateTe(open[0].date)} కి మాత్రమే slots ఉన్నాయి అండి, అది ok నా?`, `Only ${dateEn(open[0].date)} has slots left. Is that okay?`);
    }
    const [a, b] = doctor.visits.map((v) => v.date);
    const nameAsk = !draft.name ? L(" మీ పేరు చెప్తే ఇప్పుడే slot lock చేసి confirm చేస్తాను.", " If you tell me the patient's name, I'll lock the slot right away.") : "";
    return L(`Limited slots మాత్రమే ఉన్నాయి అండి. ${dateTe(a)} కి కావాలా, లేక ${isoParts(b).d} కి కావాలా?${nameAsk}`,
      `We have limited slots. Would you prefer ${dateEn(a)} or the ${ordinal(isoParts(b).d)}?${nameAsk}`);
  };
  const askName = () => L("Perfect అండి. Patient పేరు చెప్తారా? ఇప్పుడే slot lock చేస్తాను.", "Perfect. May I have the patient's name? I'll lock the slot right away.");
  const readback = () => L(
    `ఒక్కసారి confirm చేస్తాను: ${nameTe()}, ${dateTe(draft.date!)}, ${obl(doctorTe)}తో cardiology consultation, fee ${doctor.fee} rupees. Confirm చేయమంటారా?`,
    `Just to confirm: ${nameEn()}, ${dateEn(draft.date!)}, cardiology consultation with ${doctor.name}, fee ${doctor.fee} rupees. Shall I confirm?`,
  );
  const bookAsk = () => L("మీకు appointment book చేయమంటారా అండి?", "Shall I book an appointment for you?");
  /** The question to return to after answering a side question. */
  const resume = (): string => {
    switch (draft.step) {
      case "open": return draft.toldDates ? bookAsk() : L("ఇంకా ఏమైనా help కావాలా అండి?", "Is there anything else I can help you with?");
      case "identify": return L(`${obl(call.nameTe ?? "")}తోనే మాట్లాడుతున్నానా అండి?`, `Am I speaking with ${call.nameEn}?`);
      case "offer": case "rebook": return bookAsk();
      case "date": return draft.date ? askName() : askDate();
      case "name": return askName();
      case "readback": return L("Confirm చేయమంటారా అండి?", "Shall I confirm?");
      case "callback_time": return L("ఏ time కి call చేస్తే convenient అండి?", "What time would be convenient to call back?");
    }
  };

  const say = (line: string, step: HospitalStep = draft.step): HospitalResult => {
    draft.step = step;
    state.stage = STAGE[step];
    const full = prefix && !line.startsWith(prefix) ? [prefix, line].filter(Boolean).join(" ") : line;
    state.lastReply = toSegments(full);
    state.unclearStreak = 0;
    return { state, segments: state.lastReply, outcome: null };
  };
  /** Everything the hospital wants on record for every call. */
  const meta = (kind: OutcomeKind) => ({
    direction: draft.direction, phone: call.phoneMasked, name: draft.name, onBehalf: draft.onBehalf, language: draft.lang,
    doctorId: doctor.id, date: kind === "appointment_booked" ? draft.date : null, questionsForReception: draft.notes,
  });
  const close = (kind: OutcomeKind, line: string, detail: string | null = null, callbackTime: string | null = null): HospitalResult => {
    state.stage = "closed";
    state.outcome = kind;
    state.lastReply = toSegments(line);
    const notes = draft.notes.length && kind !== "appointment_booked" ? `Caller asked: ${draft.notes.join("; ")}` : null;
    const outcome: Outcome = {
      sessionId: state.sessionId, orderId: state.orderId, kind, detail: [detail, notes].filter(Boolean).join(" | ") || null, callbackTime,
      customerWords: words.slice(0, 200), route: opts.fromModel ? "openai" : "workflow", turn: state.turn, recordedAt: new Date().toISOString(),
      meta: meta(kind),
    };
    return { state, segments: state.lastReply, outcome };
  };

  if (prev.stage === "closed") return say(L("ఈ call already complete అయింది అండి. Thank you!", "This call is already complete. Thank you!"), draft.step);

  // Silence.
  if (!text) {
    draft.silence++;
    if (draft.silence >= 3) return close("pending_staff", L("Network సరిగ్గా లేనట్టుంది అండి. మా staff మళ్లీ call చేస్తారు. Thank you!", "I think the network isn't clear. Our staff will call you back. Thank you!"), "No response on the line");
    return say(draft.silence === 1 ? L("హలో అండి, నా voice వినిపిస్తోందా?", "Hello, can you hear me?") : `${L("హలో అండి?", "Hello?")} ${resume()}`);
  }
  draft.silence = 0;

  // Patient-name helpers.
  const firstName = (call.nameTe ?? "").replace(/\s*గారు$/u, "");
  const saysOwnName = !!firstName && (text.includes(firstName) || (!!call.patientName && text.includes(call.patientName.split(" ")[0].toLowerCase())));
  const isMe = !WRONG_NUMBER.test(text) && (ME.test(text) || (saysOwnName && !/తెలియదు|తెలీదు|లేరు|కాదు|కాను|don.?t know|not/u.test(text)));

  // ----- safety and consent first, in every step -----
  if (emergency(text)) {
    return close("urgent_referral", L(
      "ఇది emergency లా ఉంది అండి. వెంటనే 108 కి call చేయండి, లేదా దగ్గర్లో ఉన్న hospital emergency కి వెళ్ళండి. మా staff కి కూడా ఇప్పుడే inform చేస్తాను.",
      "This sounds like an emergency. Please call 108 right now, or go to the nearest hospital emergency. I'm informing our staff as well."), "Caller described possible emergency symptoms");
  }
  if (DNC.test(text)) return close("do_not_call", L("సరే అండి, ఇక మీకు call చేయము, note చేసుకున్నాను. Sorry for the disturbance అండి.", "Sure, we won't call you again — I've noted it. Sorry for the disturbance."));
  const whyLine = draft.step === "identify" ? L(`${obl(call.nameTe ?? "")} hospital appointment గురించి call చేశాను అండి. `, `I'm calling about a hospital appointment for ${call.nameEn}. `) : "";
  // Asked directly whether this is a person: answer honestly in one line, then carry on.
  // Once answered, "robot అయినా పర్లేదు" is just acceptance; if they also confirmed who they are, go on to the offer.
  const robotLine = L(`నేను ${HOSPITAL.spokenNameTe} virtual assistant ని అండి, appointments లో help చేస్తాను.`, `I'm ${HOSPITAL.name}'s virtual assistant; I help with appointments.`);
  let robotPrefix = "";
  if (ROBOT.test(text) && !draft.robotAnswered && draft.step === "identify" && (isMe || BEHALF.test(text))) { draft.robotAnswered = true; robotPrefix = robotLine; }
  else if (ROBOT.test(text) && !draft.robotAnswered && (draft.robotAnswered = true)) return say(`${L(`నేను ${HOSPITAL.spokenNameTe} virtual assistant ని అండి, appointments లో help చేస్తాను.`, `I'm ${HOSPITAL.name}'s virtual assistant; I help with appointments.`)} ${WHY.test(text) ? whyLine : ""}${resume()}`);
  if (WHO.test(text)) return say(`${L(`${HOSPITAL.spokenNameTe} నుంచి ${HOSPITAL.agentNameTe} అండి.`, `This is ${HOSPITAL.agentName} from ${HOSPITAL.name}.`)} ${whyLine}${resume()}`);
  if (WHY.test(text) && draft.step === "identify" && !yes(text) && !ME.test(text) && !BEHALF.test(text)) return say(`${whyLine}${resume()}`);

  // ----- callback time -----
  if (draft.step === "callback_time") {
    if (WRONG_NUMBER.test(text)) return close("pending_staff", L("అయ్యో sorry అండి, wrong number అనుకుంటా. Sorry for the disturbance. Thank you!", "Oh, sorry — I think I have the wrong number. Sorry for the disturbance. Thank you!"), "Wrong number — check the patient's phone number");
    if (/ఇస్తాను|ఇస్తా|ఒక్క నిమిషం|one minute|hold on|నేనే .*మాట్లాడ|^(?:ఆ |హా )?నేనే|this is (?:her|him|me)|i.ll (?:give|pass)/u.test(text)) {
      return say(`${L("సరే అండి.", "Sure.")} ${L(`${obl(call.nameTe ?? "")}తోనే మాట్లాడుతున్నానా అండి?`, `Am I speaking with ${call.nameEn}?`)}`, "identify");
    }
    if (no(text)) return close("callback", L("ఓకే అండి, మా staff తర్వాత call చేస్తారు. Thank you!", "Okay, our staff will call you later. Thank you!"));
    return close("callback", L("ఓకే అండి, ఆ time కి మళ్లీ call చేస్తాం. Thank you!", "Okay, we'll call you back then. Thank you!"), `Doctor visit: ${doctor.id}`, words.slice(0, 120));
  }
  if (BUSY.test(text) && !Q.when.test(text)) {
    if (CALLBACK_WHEN.test(text)) return close("callback", L("No problem అండి, ఆ time కి మళ్లీ call చేస్తాను. Thank you అండి!", "No problem, I'll call you back then. Thank you!"), `Doctor visit: ${doctor.id}`, words.slice(0, 120));
    return say(L("No problem అండి. ఏ time కి call చేస్తే convenient?", "No problem. What time would be convenient to call back?"), "callback_time");
  }
  if (HOLD.test(text)) return say(L("సరే అండి, wait చేస్తాను.", "Sure, I'll hold."));

  // ----- date facts and "next visit" -----
  const picked = parseVisitDate(text, doctor, free);
  const dateNo = (picked && picked !== "other" && DAY_NO.test(text) && !clearYes(text)) || OTHER_DAY.test(text);
  const nextWhen = NEXT_VISIT.test(text) && /ఎప్పుడు|when|eppudu|తెలియజేయ|చెప్పండి/u.test(text) ? L("Next visit dates ఇంకా fix అవ్వలేదు అండి. ", "The next visit dates aren't fixed yet. ") : "";
  const nextVisitLine = () => nextWhen + L(
    `${doctorTe} ఈసారి ${datesTe()} dates లో మాత్రమే వస్తున్నారు అండి. ఆ days కుదరకపోతే, next visit అప్పుడు మీకు call చేయమంటారా?`,
    `${doctor.name} is only here on ${datesEn()} this time. If those don't work, shall we call you for the next visit?`,
  );
  const closeNextVisit = () => close("callback", L("ఓకే అండి, doctor గారి next visit అప్పుడు మీకు మళ్లీ call చేస్తాం. Thank you అండి!", "Okay, we'll call you when the doctor visits next. Thank you!"), `Wants the next visit of ${doctor.id}`);
  if (NEXT_VISIT.test(text) && /call|కాల్|చెప్ప|చేయమన|ఫోన్|అప్పుడు|appudu|then|inform/u.test(text) && !(picked && picked !== "other")) return closeNextVisit();
  if (draft.askedNextVisit && yes(text) && !(picked && picked !== "other") && !/book|బుక్|slot/u.test(text)) return closeNextVisit();

  // Side questions: answer from data, then carry on with whatever else they said.
  const side: { k: string; line: string }[] = [];
  const sideAnswers = () => {
    if (Q.fee.test(text)) side.push({ k: "fee", line: L(feeTe, feeEn) });
    if (Q.doctor.test(text)) side.push({ k: "doctor", line: L(`${doctorTe} ${doctor.specialtyTe} అండి, heart specialist.`, `${doctor.name} is a ${doctor.specialty.toLowerCase()} — a heart specialist.`) });
    if (Q.when.test(text) && !(picked && picked !== "other") && !draft.toldDates) side.push({ k: "when", line: L(`${doctorTe} ఈ month ${datesTe()} dates లో available ఉంటారు అండి.`, `${doctor.name} is available on ${datesEn()}.`) });
    if (Q.hours.test(text)) side.push({ k: "hours", line: L(timingsTe, timingsEn) });
    if (Q.where.test(text)) side.push({ k: "where", line: L("Hospital address details మీ WhatsApp కి పంపిస్తాను అండి.", "I'll send the hospital address to your WhatsApp.") });
    if (Q.bring.test(text)) {
      // "old reports kooda unnayi" (they have them) → "అవునండి, పక్కాగా చూపించాలి"; "ఏం తీసుకురావాలి?" (a question) → just the answer.
      const has = /ఉన్నాయి|unnayi|i have|are there|ఉంది|undi/u.test(text) && !/తీసుకురావాల|teesukuravala|what (?:to|should)/u.test(text);
      side.push({ k: "bring", line: has
        ? L(`అవునండి, పక్కాగా చూపించాలి. ${HOSPITAL.bring.te} doctor గారికి చూపించడానికి తీసుకురండి, doctor గారు check చేసి proper గా guide చేస్తారు.`, `Yes, definitely bring them. Please bring ${HOSPITAL.bring.en} — the doctor will check them and guide you properly.`)
        : L(`${HOSPITAL.bring.te} తీసుకురండి అండి, doctor గారు check చేసి proper గా guide చేస్తారు.`, `Please bring ${HOSPITAL.bring.en}. The doctor will check them and guide you properly.`) });
    }
    if (Q.others.test(text) || Q.insurance.test(text) || Q.reception.test(text) || Q.facility.test(text)) {
      draft.notes.push(words.slice(0, 120));
      side.push({ k: "reception", line: L("ఆ details కోసం మా reception ని contact చేయండి అండి, వాళ్ళు full గా చెప్తారు.", "For those details, please contact our reception — they'll help you fully.") });
    }
    if (Q.medical.test(text) && !Q.facility.test(text.replace(/fasting|ఖాళీ కడుపు|tablets?|మాత్రలు/gu, ""))) {
      draft.medicalAsked++;
      if (draft.medicalAsked === 1) side.push({ k: "medical", line: L("అది doctor గారే check చేసి చెప్తారు అండి, నేను medical advice ఇవ్వలేను. Fasting లాంటి preparation details కోసం reception ని contact చేయొచ్చు.", "The doctor will advise on that — I can't give medical advice. For preparation details like fasting, you can contact our reception.") });
      else {
        if (draft.medicalAsked === 2) draft.notes.push(`Medical question: ${words.slice(0, 100)}`);
        side.push({ k: "medical", line: L("అర్థమైంది అండి, అది important. ఆ విషయం reception ని contact చేస్తే, doctor team తో confirm చేసి చెప్తారు.", "I understand, that's important. Please contact our reception — they'll check with the doctor's team and tell you.") });
      }
    } else if (PAIN.test(text)) {
      side.push({ k: "medical", line: L("ఇప్పుడే నొప్పి ఎక్కువగా ఉంటే వెంటనే 108 కి call చేయండి అండి. లేకపోతే doctor గారు checkup లో చూస్తారు.", "If the pain is severe right now, please call 108 immediately. Otherwise the doctor will check it at the appointment.") });
    }
    if (dateNo || picked === "other") { draft.askedNextVisit = true; side.push({ k: "day", line: nextVisitLine() }); }
    if (!side.length && !(picked && picked !== "other") && (opts.note === "__question__" || (!opts.fromModel && ASKS.test(text) && !REPEAT.test(text) && !WHY.test(text) && !ROBOT.test(text) && !yes(text)))) {
      draft.notes.push(words.slice(0, 120));
      side.push({ k: "reception", line: L("ఆ details నా దగ్గర లేవు అండి. మా reception ని contact చేస్తే full గా చెప్తారు.", "I don't have those details, but our reception can help you with that.") });
    } else if (opts.note === "__question__" && !side.some((x) => x.k === "reception")) {
      draft.notes.push(words.slice(0, 120));
      side.push({ k: "reception", line: L("ఆ details నా దగ్గర లేవు అండి. మా reception ని contact చేస్తే full గా చెప్తారు.", "I don't have those details, but our reception can help you with that.") });
    }
  };

  // ----- outbound: identity before anything about the visit -----
  if (draft.step === "identify") {
    if (WRONG_NUMBER.test(text)) return close("pending_staff", L("అయ్యో sorry అండి, wrong number అనుకుంటా. Sorry for the disturbance. Thank you!", "Oh, sorry — I think I have the wrong number. Sorry for the disturbance. Thank you!"), "Wrong number — check the patient's phone number");
    if ((isMe || yes(text)) && REFUSE.test(text)) return close("not_interested", L("ఓకే అండి, no problem. ఎప్పుడైనా అవసరమైతే hospital కి call చేయండి. Thank you అండి!", "Okay, no problem. If you ever need us, just call the hospital. Thank you!"));
    const behalf = BEHALF.test(text);
    if (!behalf && (NOT_HOME.test(text) || (hasNeg(text) && !isMe && !yes(text)))) {
      return say(L(`ఓకే అండి. ${call.nameTe} ఇంట్లో ఉంటే ఒక్కసారి phone ఇస్తారా? లేకపోతే ఏ time కి call చేయమంటారు?`, `Okay. If ${call.nameEn} is at home, could you pass the phone? Otherwise, when should I call back?`), "callback_time");
    }
    if (/^(?:hello|హలో|నమస్కారం|నమస్తే|namaste|namaskaram|hi)(?: అండి| andi)?$/u.test(text)) return say(`${L("నమస్కారం అండి.", "Hello!")} ${resume()}`);
    if (behalf || yes(text) || isMe || /చెప్పండి|cheppandi|go ahead|tell me/u.test(text)) {
      draft.onBehalf = behalf;
      draft.toldDates = true;
      sideAnswers();
      const answers = side.filter((x) => x.k !== "fee" && x.k !== "when").map((x) => x.line).join(" ");
      if (dateNo || picked === "other") return say(`${L("థాంక్యూ అండి.", "Thank you.")} ${nextVisitLine()}`, "offer");
      return say(`${robotPrefix ? `${robotPrefix} ` : ""}${L("థాంక్యూ అండి.", "Thank you.")} ${answers ? `${answers} ` : ""}${visitInfo()} ${behalf ? L(`${obl(call.nameTe!)}కి appointment book చేయమంటారా?`, `Shall I book an appointment for ${call.nameEn}?`) : bookAsk()}`, "offer");
    }
  }

  sideAnswers();
  const atReadback = draft.step === "readback";
  // At the readback the fee and date were just read out: "confirm చేయండి, fee ok" is a yes, not a question.
  prefix = side.filter((x) => !(atReadback && ["fee", "when"].includes(x.k))).map((x) => x.line).join(" ");
  if (side.some((x) => x.k === "day")) return say("", "offer");
  const newName = parseName(raw, draft.step);

  // "సరే thank you" before booking: a polite end, not a yes.
  if (BYE.test(text) && draft.step !== "readback" && draft.step !== "identify") {
    return close(draft.direction === "inbound" ? "enquiry_answered" : "not_interested", L("సరే అండి. ఇంకా ఏమైనా కావాలంటే hospital కి call చేయండి. Thank you, take care!", "Sure. Call us anytime if you need anything. Thank you, take care!"));
  }

  // ----- inbound: open question -----
  if (draft.step === "open") {
    if (BYE.test(text)) return close("enquiry_answered", L("సరే అండి. ఇంకా ఏమైనా కావాలంటే మళ్లీ call చేయండి. Thank you, take care!", "Sure. Call us anytime if you need anything else. Thank you, take care!"));
    if (REFUSE.test(text) || no(text)) return close("enquiry_answered", L("ఓకే అండి, no problem. ఎప్పుడైనా అవసరమైతే call చేయండి. Thank you అండి!", "Okay, no problem. Call us anytime. Thank you!"));
    const wantsBooking = BOOK.test(text) || (picked && picked !== "other") || clearYes(text);
    const asksDoctorInfo = side.some((x) => ["fee", "when", "doctor"].includes(x.k)) || /doctor|డాక్టర్|cardio|heart|గుండె|విశ్వనాథ్|viswanath/u.test(text);
    if (newName) draft.name = newName;
    if (wantsBooking) {
      const askedFacts = side.some((x) => ["fee", "when", "doctor"].includes(x.k));
      const facts = askedFacts ? L(`${doctorTe} ${doctor.specialtyTe} అండి, ఈ month ${datesTe()} dates లో available ఉన్నారు. ${feeTe}`, `${doctor.name} is a ${doctor.specialty.toLowerCase()}, available on ${datesEn()}. ${feeEn}`) : "";
      prefix = [facts, ...side.filter((x) => !["fee", "when", "doctor"].includes(x.k)).map((x) => x.line)].filter(Boolean).join(" ");
      const info = askedFacts || draft.toldDates ? "" : `${visitInfo()} `;
      draft.toldDates = true;
      if (picked && picked !== "other") return chooseDate(picked);
      return say(`${askedFacts ? "" : `${L("తప్పకుండా అండి!", "Of course!")} `}${info}${askDate()}`, "date");
    }
    if (asksDoctorInfo) {
      draft.toldDates = true;
      // "Doctor ఎప్పుడు వస్తారు? fee ఎంత?" — answer like the reference call: who, when, fee, then offer.
      prefix = side.filter((x) => !["fee", "when", "doctor"].includes(x.k)).map((x) => x.line).join(" ");
      return say(`${L(`${doctorTe} ${doctor.specialtyTe} అండి. ఈ month ${datesTe()} dates లో available ఉన్నారు. ${feeTe}`, `${doctor.name} is a ${doctor.specialty.toLowerCase()}. He's available on ${datesEn()}. ${feeEn}`)} ${bookAsk()}`, "offer");
    }
    if (prefix) return say(resume());
    if (yes(text)) return say(L("చెప్పండి అండి.", "Please go ahead."));
  }

  // With a question asked, a bare "ఆ"/"హా" is just a filler, not an answer.
  const answered = !prefix || clearYes(text) || no(text) || (picked && picked !== "other") || !!newName || BOOK.test(text);
  if (!answered) return say(resume());
  if (!prefix && REPEAT.test(text)) return say(prev.lastReply.map((s) => s.text).join(" "));

  // ----- main flow -----
  if (draft.step === "offer" || draft.step === "rebook") {
    if ((no(text) || REFUSE.test(text)) && !/date|డేట్|తేదీ|change|మార్చ/u.test(text)) return close("not_interested", L("ఓకే అండి, no problem. ఎప్పుడైనా అవసరమైతే hospital కి call చేయండి. Thank you అండి!", "Okay, no problem. If you ever need us, just call the hospital. Thank you!"));
    if (THINK.test(text)) return say(L("Sure అండి, ఇంట్లో discuss చేసి చెప్పండి. ఏ time కి మళ్లీ call చేయమంటారు?", "Sure, discuss it at home. When should I call you back?"), "callback_time");
    if (newName) draft.name = newName;
    if ((picked && picked !== "other") || yes(text) || BOOK.test(text) || (draft.step === "rebook" && /date|డేట్|తేదీ|change|మార్చ/u.test(text))) {
      if (!open.length) return close("pending_staff", L("Sorry అండి, ఈ visit కి slots అన్నీ full అయిపోయాయి. Next visit గురించి మా reception మీకు call చేస్తారు. Thank you!", "Sorry, all slots for this visit are full. Our reception will call you about the next visit. Thank you!"), "Visit fully booked");
      if (picked && picked !== "other") return chooseDate(picked);
      return say(`${L(draft.toldDates ? "తప్పకుండా అండి!" : "Perfect అండి!", draft.toldDates ? "Of course!" : "Perfect!")} ${askDate()}`, "date");
    }
  }

  if (draft.step === "date") {
    if (newName) draft.name = newName;
    if (REFUSE.test(text) && !(picked && picked !== "other")) return close("not_interested", L("ఓకే అండి, no problem. ఎప్పుడైనా అవసరమైతే hospital కి call చేయండి. Thank you అండి!", "Okay, no problem. If you ever need us, just call the hospital. Thank you!"));
    if (picked && picked !== "other") return chooseDate(picked);
    if (open.length === 1 && yes(text)) return chooseDate(open[0].date);
    if (newName) return say(`${L(`థాంక్యూ ${nameTe()}.`, `Thank you, ${nameEn()}.`)} ${askDate()}`, "date");
  }

  if (draft.step === "name") {
    if (newName) { draft.name = newName; return afterDetails(); }
    if (picked && picked !== "other") return chooseDate(picked);
  }

  if (draft.step === "readback") {
    if (picked && picked !== "other" && picked !== draft.date) return chooseDate(picked);
    if (newName && newName !== draft.name && !clearYes(text)) { draft.name = newName; return say(`${L("సరే అండి.", "Sure.")} ${readback()}`, "readback"); }
    if (clearYes(text) && !interrupted) return book();
    if (no(text)) return say(L("ఓకే అండి. Date change చేయమంటారా, లేక ఇప్పుడు వద్దా?", "Okay. Would you like a different date, or not now?"), "rebook");
    if (interrupted) return say(`${L("ఒక్కసారి మళ్లీ confirm చేస్తాను అండి.", "Let me confirm once more.")} ${readback()}`, "readback");
    if (!opts.fromModel && !yes(text)) return { ...unclear(), needsModel: true };
    return say(L(`${dateTe(draft.date!)} confirm చేయమంటారా? Yes, లేదా no చెప్పండి అండి.`, `Shall I confirm ${dateEn(draft.date!)}? Please say yes or no.`), "readback");
  }

  if (prefix) return say(resume());
  // Not placed by the rules: let the model label it once (turn.ts), else ask again.
  return { ...unclear(), needsModel: !opts.fromModel };

  function unclear(): HospitalResult {
    const streak = prev.unclearStreak + 1;
    if (streak >= 3) return close("pending_staff", L("Sorry అండి, network సరిగ్గా లేనట్టుంది. మా staff మీకు మళ్లీ call చేస్తారు. Thank you!", "Sorry, the line isn't clear. Our staff will call you back. Thank you!"), "Repeated misunderstanding");
    const r = say(streak === 1 ? `${L("Sorry అండి, సరిగ్గా వినపడలేదు.", "Sorry, I didn't catch that.")} ${resume()}` : `${L("ఇంకొక్కసారి చెప్తారా అండి?", "Could you say that once more?")} ${resume()}`);
    state.unclearStreak = streak;
    return r;
  }

  /** Date set: ask the name if we don't have it, else read back — or book straight away when they already said "confirm". */
  function afterDetails(): HospitalResult {
    if (!draft.date) return say(`${L(`థాంక్యూ ${nameTe()}.`, `Thank you, ${nameEn()}.`)} ${askDate()}`, "date");
    if (!draft.name) return say(askName(), "name");
    // Like the reference call: "November 22 కి okati confirm cheseyandi" + name → book now.
    if (YES_ANY.test(text) || /confirm|lock|cheseyandi|చేసేయండి|కన్ఫర్మ్/u.test(text)) return book();
    return say(`${L("Perfect అండి.", "Perfect.")} ${readback()}`, "readback");
  }

  function chooseDate(iso: string): HospitalResult {
    const f = free.find((x) => x.date === iso);
    if (!f || f.free <= 0) {
      const other = open.find((x) => x.date !== iso);
      if (!other) return close("pending_staff", L("Sorry అండి, ఈ visit కి slots అన్నీ full అయిపోయాయి. Next visit గురించి మా reception మీకు call చేస్తారు. Thank you!", "Sorry, all slots for this visit are full. Our reception will call you about the next visit. Thank you!"), "Visit fully booked");
      draft.date = null;
      return say(L(`Sorry అండి, ${dateTe(iso)} కి slots full అయిపోయాయి. ${dateTe(other.date)} కి slots ఉన్నాయి, అది ok నా?`, `Sorry, ${dateEn(iso)} is fully booked. ${dateEn(other.date)} has slots — is that okay?`), "date");
    }
    draft.date = iso;
    return afterDetails();
  }

  function book(): HospitalResult {
    // Check capacity again at the moment of booking: another call may have taken the last place.
    if (!open.some((x) => x.date === draft.date)) {
      const was = draft.date!;
      draft.date = null;
      const other = open[0];
      if (!other) return close("pending_staff", L("Sorry అండి, ఇప్పుడే slots అన్నీ full అయిపోయాయి. మా reception మీకు call చేస్తారు. Thank you!", "Sorry, the slots just filled up. Our reception will call you. Thank you!"), "Visit fully booked");
      return say(L(`Sorry అండి, ${dateTe(was)} కి slots ఇప్పుడే full అయిపోయాయి. ${dateTe(other.date)} కి ఉన్నాయి, అది ok నా?`, `Sorry, ${dateEn(was)} just filled up. ${dateEn(other.date)} has slots — is that okay?`), "date");
    }
    const detail = JSON.stringify({
      patient: draft.name, onBehalf: draft.onBehalf, doctorId: doctor.id, doctor: doctor.name, date: draft.date, fee: doctor.fee,
      direction: draft.direction, phone: call!.phoneMasked, language: draft.lang,
      sendWhatsApp: "Booking details + hospital address", callerQuestions: draft.notes.length ? draft.notes : undefined,
    });
    const answers = prefix ? `${prefix} ` : "";
    return close("appointment_booked", answers + L(
      `Perfect అండి ${nameTe()}! ${dateTe(draft.date!)} కి appointment confirm అయిపోయింది. Complete booking details, hospital address మీ WhatsApp కి ఇప్పుడే పంపిస్తున్నాను. Hospital కి వచ్చేటప్పుడు ${HOSPITAL.bring.te} మర్చిపోకుండా తీసుకురండి. Thank you so much, take care!`,
      `Perfect, ${nameEn()}! Your appointment on ${dateEn(draft.date!)} is confirmed. I'm sending the complete booking details and the hospital address to your WhatsApp right now. Please bring ${HOSPITAL.bring.en}. Thank you so much, take care!`,
    ), detail);
  }
}
