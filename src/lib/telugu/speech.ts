// Spoken-text helpers. The screen shows the reply as written; Sarvam receives a
// "spoken" version where digits, prices, weights, times and dates are written out
// as Telugu words, and markdown/emoji are removed. Amounts are never changed.

import { rupeesInTelugu, teluguNumber } from "./numbers";

const WEEKDAYS = ["ఆదివారం", "సోమవారం", "మంగళవారం", "బుధవారం", "గురువారం", "శుక్రవారం", "శనివారం"];
const MONTHS = ["జనవరి", "ఫిబ్రవరి", "మార్చి", "ఏప్రిల్", "మే", "జూన్", "జూలై", "ఆగస్టు", "సెప్టెంబర్", "అక్టోబర్", "నవంబర్", "డిసెంబర్"];

/** "ఒకటో", "రెండో", "ఇరవై ఒకటో", "పదో", "ఇరవయ్యో" — day-of-month ordinal. */
export function teluguOrdinal(n: number): string {
  const words = teluguNumber(n).split(" ");
  const last = words.pop()!;
  const ord = last.endsWith("ై") ? `${last.slice(0, -1)}య్యో` : last.replace(/[ుి]$/u, "") + "ో";
  return [...words, ord].join(" ");
}

/** "2026-11-21" → "శనివారం, నవంబర్ ఇరవై ఒకటో తేదీ" */
export function spokenDate(iso: string, withMonth = true): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return withMonth ? `${weekday}, ${MONTHS[m - 1]} ${teluguOrdinal(d)} తేదీ` : `${weekday}, ${teluguOrdinal(d)} తేదీ`;
}

function period(h: number): string {
  if (h < 12) return "ఉదయం";
  if (h < 16) return "మధ్యాహ్నం";
  if (h < 19) return "సాయంత్రం";
  return "రాత్రి";
}

/** Clock words without "at": "పది గంటలు", "పదిన్నర", "ఒంటి గంట". */
function clockWords(h24: number, m: number): { plain: string; at: string } {
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  if (m === 30) {
    const w = h === 1 ? "ఒకటిన్నర" : `${teluguNumber(h)}న్నర`;
    return { plain: w, at: `${w}కి` };
  }
  if (m === 0) {
    if (h === 1) return { plain: "ఒంటి గంట", at: "ఒంటి గంటకి" };
    return { plain: `${teluguNumber(h)} గంటలు`, at: `${teluguNumber(h)} గంటలకి` };
  }
  const base = h === 1 ? "ఒంటి గంట" : `${teluguNumber(h)} గంటల`;
  const w = `${base} ${teluguNumber(m)} నిమిషాలు`;
  return { plain: w, at: `${w}కి` };
}

/** "10:30" → "ఉదయం పదిన్నరకి" (withAt) or "ఉదయం పదిన్నర". */
export function spokenTime(hhmm: string, withAt = true, withPeriod = true): string {
  const [h, m] = hhmm.split(":").map(Number);
  const c = clockWords(h, m);
  return `${withPeriod ? `${period(h)} ` : ""}${withAt ? c.at : c.plain}`;
}

/** "10:00"–"13:00" → "ఉదయం పది గంటల నుంచి మధ్యాహ్నం ఒంటి గంట వరకు" */
export function spokenRange(start: string, end: string): string {
  const [sh] = start.split(":").map(Number);
  const [eh] = end.split(":").map(Number);
  const s = spokenTime(start, false).replace(/గంటలు$/u, "గంటల");
  const e = spokenTime(end, false, period(sh) !== period(eh)).replace(/గంటలు$/u, "గంట");
  return `${s} నుంచి ${e} వరకు`;
}

const DIGITS = ["సున్నా", "ఒకటి", "రెండు", "మూడు", "నాలుగు", "ఐదు", "ఆరు", "ఏడు", "ఎనిమిది", "తొమ్మిది"];
const digitByDigit = (s: string) => [...s.replace(/\D/gu, "")].map((d) => DIGITS[Number(d)]).join(" ");

/**
 * Everyday English words written the way they are said in Telugu speech (like the
 * reference call: శాలరీడ్, ఇన్కమ్, కన్ఫర్మ్). Longest phrases first. Brand names are left alone.
 */
export const ENGLISH_IN_TELUGU: [RegExp, string][] = ([
  ["thank you", "థాంక్యూ"], ["ai assistant", "ఏఐ అసిస్టెంట్"], ["consultation fee", "కన్సల్టేషన్ ఫీజు"],
  ["appointment", "అపాయింట్మెంట్"], ["checkup", "చెకప్"], ["slots", "స్లాట్స్"], ["slot", "స్లాట్"],
  ["booked", "బుక్ అయింది"], ["book", "బుక్"], ["hospital", "హాస్పిటల్"], ["doctor", "డాక్టర్"],
  ["fee", "ఫీజు"], ["time", "టైమ్"], ["call", "కాల్"], ["reports", "రిపోర్ట్స్"], ["compounder", "కాంపౌండర్"],
  ["full", "ఫుల్"], ["confirm", "కన్ఫర్మ్"], ["help", "హెల్ప్"], ["okay", "ఓకే"], ["ok", "ఓకే"], ["sure", "షూర్"], ["sorry", "సారీ"],
  ["order", "ఆర్డర్"], ["cart", "కార్ట్"], ["pack", "ప్యాక్"], ["delivery", "డెలివరీ"], ["address", "అడ్రస్"],
  ["take care", "టేక్ కేర్"], ["thank you so much", "థాంక్యూ సో మచ్"], ["virtual assistant", "వర్చువల్ అసిస్టెంట్"],
  ["january", "జనవరి"], ["february", "ఫిబ్రవరి"], ["march", "మార్చ్"], ["april", "ఏప్రిల్"], ["june", "జూన్"], ["july", "జూలై"],
  ["august", "ఆగస్ట్"], ["september", "సెప్టెంబర్"], ["october", "అక్టోబర్"], ["november", "నవంబర్"], ["december", "డిసెంబర్"],
  ["cardiologist", "కార్డియాలజిస్ట్"], ["cardiology", "కార్డియాలజీ"], ["consultation", "కన్సల్టేషన్"], ["whatsapp", "వాట్సాప్"],
  ["reception", "రిసెప్షన్"], ["scanning", "స్కానింగ్"], ["medication", "మెడికేషన్"], ["current", "కరెంట్"], ["old", "ఓల్డ్"],
  ["guide", "గైడ్"], ["proper", "ప్రాపర్"], ["limited", "లిమిటెడ్"], ["lock", "లాక్"], ["dates", "డేట్స్"], ["date", "డేట్"],
  ["month", "మంత్"], ["days", "డేస్"], ["patient", "పేషెంట్"], ["contact", "కాంటాక్ట్"], ["exact", "ఎగ్జాక్ట్"], ["timings", "టైమింగ్స్"],
  ["complete", "కంప్లీట్"], ["address", "అడ్రస్"], ["full", "ఫుల్"], ["help", "హెల్ప్"], ["change", "చేంజ్"], ["front desk", "ఫ్రంట్ డెస్క్"], ["medical advice", "మెడికల్ అడ్వైస్"], ["no problem", "నో ప్రాబ్లమ్"],
  ["heart specialist", "హార్ట్ స్పెషలిస్ట్"], ["main road", "మెయిన్ రోడ్"], ["bus stand", "బస్ స్టాండ్"],
  ["for the disturbance", "ఫర్ ద డిస్టర్బెన్స్"], ["follow-up", "ఫాలో అప్"], ["o'clock", "ఓ క్లాక్"],
  ["sunday", "సండే"], ["monday", "మండే"], ["tuesday", "ట్యూస్డే"], ["wednesday", "వెడ్నెస్డే"], ["thursday", "థర్స్డే"],
  ["friday", "ఫ్రైడే"], ["saturday", "సాటర్డే"], ["morning", "మార్నింగ్"], ["afternoon", "ఆఫ్టర్నూన్"],
  ["evening", "ఈవెనింగ్"], ["night", "నైట్"], ["week", "వీక్"], ["rupees", "రుపీస్"], ["available", "అవైలబుల్"],
  ["convenient", "కన్వీనియెంట్"], ["pickup", "పికప్"], ["arrange", "అరేంజ్"], ["prescription", "ప్రిస్క్రిప్షన్"],
  ["medicines", "మెడిసిన్స్"], ["tablets", "టాబ్లెట్స్"], ["fasting", "ఫాస్టింగ్"], ["nurse", "నర్స్"], ["important", "ఇంపార్టెంట్"],
  ["network", "నెట్వర్క్"], ["booking", "బుకింగ్"], ["visit", "విజిట్"], ["next", "నెక్స్ట్"], ["inform", "ఇన్ఫార్మ్"],
  ["emergency", "ఎమర్జెన్సీ"], ["specialist", "స్పెషలిస్ట్"], ["heart", "హార్ట్"], ["sorry", "సారీ"], ["perfect", "పర్ఫెక్ట్"],
  ["wait", "వెయిట్"], ["discuss", "డిస్కస్"], ["complete", "కంప్లీట్"], ["already", "ఆల్రెడీ"], ["voice", "వాయిస్"],
  ["details", "డీటెయిల్స్"], ["full", "ఫుల్"], ["done", "డన్"], ["note", "నోట్"], ["check", "చెక్"], ["phone", "ఫోన్"],
  ["assistant", "అసిస్టెంట్"], ["ai", "ఏఐ"], ["checkup", "చెకప్"], ["yes", "యెస్"],
  ["items", "ఐటమ్స్"], ["item", "ఐటమ్"], ["stock", "స్టాక్"], ["details", "డీటెయిల్స్"], ["staff", "స్టాఫ్"],
] as [string, string][]).map(([en, te]) => [new RegExp(`\\b${en}\\b`, "giu"), te]);

export type EnglishAs = "roman" | "telugu";
/** A whole reply in English: no Telugu letters and a real sentence (3+ English words). */
export const isEnglishReply = (t: string) => !/[\u0C00-\u0C7F]/u.test(t) && (t.match(/[A-Za-z]{2,}/gu) ?? []).length >= 3;
/** How numbers are spoken: "english" like everyday Tenglish ("టెన్ థర్టీ", "ఫోర్ హండ్రెడ్ రుపీస్") or pure Telugu words. */
export type NumbersAs = "english" | "telugu";

// ---------- numbers said in English, written in Telugu script (how people actually say them) ----------
const EN_UNITS = ["జీరో", "వన్", "టూ", "త్రీ", "ఫోర్", "ఫైవ్", "సిక్స్", "సెవెన్", "ఎయిట్", "నైన్", "టెన్", "ఎలెవెన్", "ట్వెల్వ్",
  "థర్టీన్", "ఫోర్టీన్", "ఫిఫ్టీన్", "సిక్స్టీన్", "సెవెంటీన్", "ఎయిటీన్", "నైంటీన్"];
const EN_TENS = ["", "", "ట్వంటీ", "థర్టీ", "ఫార్టీ", "ఫిఫ్టీ", "సిక్స్టీ", "సెవెంటీ", "ఎయిటీ", "నైంటీ"];
/** 1090 → "వన్ థౌజండ్ నైంటీ", 400 → "ఫోర్ హండ్రెడ్", 250000 → "టూ లాక్ ఫిఫ్టీ థౌజండ్" */
export function englishNumber(n: number): string {
  if (n < 20) return EN_UNITS[n];
  if (n < 100) return `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? ` ${EN_UNITS[n % 10]}` : ""}`;
  const part = (q: number, word: string, rest: number) => `${englishNumber(q)} ${word}${rest ? ` ${englishNumber(rest)}` : ""}`;
  if (n < 1000) return part(Math.floor(n / 100), "హండ్రెడ్", n % 100);
  if (n < 100000) return part(Math.floor(n / 1000), "థౌజండ్", n % 1000);
  if (n < 10000000) return part(Math.floor(n / 100000), "లాక్", n % 100000);
  return part(Math.floor(n / 10000000), "క్రోర్", n % 10000000);
}
const EN_ORD: Record<number, string> = { 1: "ఫస్ట్", 2: "సెకండ్", 3: "థర్డ్", 5: "ఫిఫ్త్", 8: "ఎయిత్", 9: "నైంత్", 12: "ట్వెల్ఫ్త్", 20: "ట్వంటీయెత్", 30: "థర్టీయెత్" };
/** 21 → "ట్వంటీ ఫస్ట్", 4 → "ఫోర్త్" */
export function englishOrdinal(n: number): string {
  if (EN_ORD[n]) return EN_ORD[n];
  if (n > 20 && n % 10) return `${EN_TENS[Math.floor(n / 10)]} ${englishOrdinal(n % 10)}`;
  return `${englishNumber(n)}త్`;
}
/** "10:30" → "టెన్ థర్టీ", "11:00" → "ఎలెవెన్", "9:05" → "నైన్ ఓ ఫైవ్" */
function englishClock(h24: number, m: number): string {
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  if (!m) return englishNumber(h);
  return `${englishNumber(h)} ${m < 10 ? `ఓ ${englishNumber(m)}` : englishNumber(m)}`;
}
const enDigits = (s: string) => [...s.replace(/\D/gu, "")].map((d) => EN_UNITS[Number(d)]).join(" ");

function numbersInEnglish(t: string): string {
  t = t.replace(/(?:\+91[\s-]*)?\b\d{3,5}[\s-]\d{3,4}[\s-]\d{3,5}\b/gu, (m) => enDigits(m));
  t = t.replace(/\b\d{6,}\b/gu, (m) => enDigits(m));
  t = t.replace(/\b108\b/gu, "వన్ ఓ ఎయిట్"); // the ambulance number, as everyone says it
  t = t.replace(/(?:₹|\bRs\.?|\bINR)\s*([\d,]+)/gu, (_m, n) => `${englishNumber(Number(n.replace(/,/g, "")))} రుపీస్`);
  t = t.replace(/\b([\d,]+)\s*(?:రూపాయలు|రూపాయి|rupees)/gu, (_m, n) => `${englishNumber(Number(n.replace(/,/g, "")))} రుపీస్`);
  t = t.replace(/\b(\d+)\s*(?:g|gm|gms|grams?|గ్రాములు|గ్రాముల)(?![a-z])/gu, (_m, n) => `${englishNumber(Number(n))} గ్రామ్స్`);
  t = t.replace(/\b(\d+(?:\.\d+)?)\s*(?:kg|kgs|కిలో|కిలోలు)(?![a-z])/gu, (_m, n) => (n === "0.5" ? "హాఫ్ కేజీ" : `${englishNumber(Number(n))} కేజీ`));
  t = t.replace(/\b(\d{1,2})[:.](\d{2})(?:\s*(am|pm|AM|PM)\b)?/gu, (_m, h, m, ap) => `${englishClock(Number(h), Number(m))}${ap ? ` ${ap.toUpperCase() === "AM" ? "ఏ ఎమ్" : "పి ఎమ్"}` : ""}`);
  t = t.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gu, (_m, n) => englishOrdinal(Number(n)));
  t = t.replace(/\b(\d+)\s*[–-]\s*(\d+)\b/gu, (_m, a, b) => `${englishNumber(Number(a))} టు ${englishNumber(Number(b))}`);
  return t.replace(/\b\d{1,9}\b/gu, (m) => englishNumber(Number(m)));
}

/**
 * Text that is sent to the speech engine. Same meaning and amounts as the display
 * text; only the way numbers and symbols are written changes.
 */
export function toSpeech(display: string, englishAs: EnglishAs = "roman", numbersAs: NumbersAs = "telugu"): string {
  let t = display;
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ""); // emoji
  t = t.replace(/\*\*|__|`|^#+\s*|^\s*[-•*]\s+/gmu, ""); // markdown, bullets
  t = t.replace(/[౦-౯]/gu, (d) => String(d.charCodeAt(0) - 0x0c66));
  // An English reply (no Telugu letters) goes to the voice as plain English: no transliteration.
  if (isEnglishReply(t)) return t.replace(/\s+/gu, " ").trim();
  t = t.replace(/\bDr\.\s*/gu, "డాక్టర్ ");
  if (numbersAs === "english") {
    t = numbersInEnglish(t);
    if (englishAs === "telugu") for (const [re, te] of ENGLISH_IN_TELUGU) t = t.replace(re, te);
    return t.replace(/\s+/gu, " ").replace(/\s+([,.?!])/gu, "$1").trim();
  }
  // Phone numbers and 6-digit PIN codes: one digit at a time.
  t = t.replace(/(?:\+91[\s-]*)?\b\d{3,5}[\s-]\d{3,4}[\s-]\d{3,5}\b/gu, (m) => digitByDigit(m));
  t = t.replace(/\b\d{6,}\b/gu, (m) => digitByDigit(m));
  // Prices.
  t = t.replace(/(?:₹|\bRs\.?|\bINR)\s*([\d,]+)/gu, (_m, n) => rupeesInTelugu(Number(n.replace(/,/g, ""))));
  t = t.replace(/\b([\d,]+)\s*(?:రూపాయలు|రూపాయి|rupees)/gu, (_m, n) => rupeesInTelugu(Number(n.replace(/,/g, ""))));
  // Weights.
  t = t.replace(/\b(\d+)\s*(గ్రాముల|గ్రాములు)/gu, (_m, n, unit) => `${teluguNumber(Number(n), unit === "గ్రాముల")} ${unit}`);
  t = t.replace(/\b(\d+)\s*(?:g|gm|gms|grams?)\b/gu, (_m, n) => `${teluguNumber(Number(n), true)} గ్రాములు`);
  t = t.replace(/\b(\d+(?:\.\d+)?)\s*(?:kg|kgs|కిలో|కిలోలు)\b/gu, (_m, n) => (n === "0.5" ? "అర కిలో" : n === "0.25" ? "పావు కిలో" : `${teluguNumber(Number(n))} కిలోలు`));
  // Times "10:30", "6:00 pm".
  t = t.replace(/\b(\d{1,2})[:.](\d{2})\s*(am|pm|AM|PM)?\b/gu, (_m, h, m, ap) => {
    let hour = Number(h);
    if (/pm/i.test(ap ?? "") && hour < 12) hour += 12;
    if (/am/i.test(ap ?? "") && hour === 12) hour = 0;
    return spokenTime(`${hour}:${m}`, false, !!ap);
  });
  // Ranges "2–4" → "రెండు నుంచి నాలుగు".
  t = t.replace(/\b(\d+)\s*[–-]\s*(\d+)\b/gu, (_m, a, b) => `${teluguNumber(Number(a))} నుంచి ${teluguNumber(Number(b))}`);
  // Any other whole number.
  t = t.replace(/\b\d{1,7}\b/gu, (m) => teluguNumber(Number(m)));
  if (englishAs === "telugu") for (const [re, te] of ENGLISH_IN_TELUGU) t = t.replace(re, te);
  return t.replace(/\s+/gu, " ").replace(/\s+([,.?!])/gu, "$1").trim();
}
