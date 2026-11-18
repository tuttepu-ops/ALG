// Deterministic callback-time extraction for common Telugu / Romanized / English phrasing.
// Returns null when no time is present, so unclear phrasings can go to the LLM.

import { hourInTelugu, teluguNumber } from "../telugu/numbers";
import type { CallbackTime } from "./types";
import { tokens } from "./normalize";

const DAY: Array<[string[], string]> = [
  [["రేపు", "repu", "reppu", "tomorrow", "tmrw", "tommorow", "tomorow"], "రేపు"],
  [["ఎల్లుండి", "ellundi", "elundi"], "ఎల్లుండి"],
  [["ఈరోజు", "ఇవాళ", "ఈ రోజు", "ivala", "ivaala", "eeroju", "ee roju", "today"], "ఈరోజు"],
];
const PERIOD: Array<[string[], string, "am" | "pm" | null]> = [
  [["ఉదయం", "పొద్దున", "పొద్దున్నే", "udayam", "podduna", "podduna", "morning"], "ఉదయం", "am"],
  [["మధ్యాహ్నం", "మధ్యాన్నం", "madhyahnam", "madhyanam", "madhyaanam", "afternoon", "noon", "lunch"], "మధ్యాహ్నం", "pm"],
  [["సాయంత్రం", "సాయంకాలం", "sayantram", "saayantram", "sayantaram", "sayankalam", "evening", "eve"], "సాయంత్రం", "pm"],
  [["రాత్రి", "రాత్రికి", "ratri", "raatri", "rathri", "night", "tonight"], "రాత్రి", "pm"],
];
const WEEKDAY: Array<[string[], string]> = [
  [["సోమవారం", "monday", "somavaram"], "సోమవారం"],
  [["మంగళవారం", "tuesday", "mangalavaram"], "మంగళవారం"],
  [["బుధవారం", "wednesday", "budhavaram"], "బుధవారం"],
  [["గురువారం", "thursday", "guruvaram"], "గురువారం"],
  [["శుక్రవారం", "friday", "sukravaram", "shukravaram"], "శుక్రవారం"],
  [["శనివారం", "saturday", "shanivaram", "sanivaram"], "శనివారం"],
  [["ఆదివారం", "sunday", "aadivaram", "adivaram"], "ఆదివారం"],
];

// Spoken hour words (1..12) in Telugu script and Romanized.
const HOUR_WORDS: Record<string, number> = {
  "ఒకటి": 1, "ఒంటి": 1, okati: 1, onti: 1, one: 1,
  "రెండు": 2, rendu: 2, two: 2,
  "మూడు": 3, moodu: 3, mudu: 3, three: 3,
  "నాలుగు": 4, nalugu: 4, naalugu: 4, four: 4,
  "ఐదు": 5, "అయిదు": 5, aidu: 5, ayidu: 5, five: 5,
  "ఆరు": 6, aaru: 6, aru: 6, six: 6,
  "ఏడు": 7, edu: 7, yedu: 7, eedu: 7, seven: 7,
  "ఎనిమిది": 8, enimidi: 8, eight: 8,
  "తొమ్మిది": 9, tommidi: 9, thommidi: 9, nine: 9,
  "పది": 10, padi: 10, ten: 10,
  "పదకొండు": 11, padakondu: 11, eleven: 11,
  "పన్నెండు": 12, pannendu: 12, twelve: 12,
};
const HOUR_SUFFIX = /^(గంటల|గంటకి|గంటకు|గంటలకు|గంటలకి|గంటలు|ganta|gantaki|gantalaki|gantalaku|gantalu|gantala|o'?clock|oclock|baje)/;

function findPhrase(toks: string[], list: string[]): boolean {
  const joined = ` ${toks.join(" ")} `;
  return list.some((p) => joined.includes(` ${p} `));
}

export function extractTime(text: string): CallbackTime | null {
  const toks = tokens(text);
  if (!toks.length) return null;
  const joined = ` ${toks.join(" ")} `;

  let day: string | null = null;
  for (const [list, te] of DAY) if (findPhrase(toks, list)) { day = te; break; }
  let weekday: string | null = null;
  for (const [list, te] of WEEKDAY) if (findPhrase(toks, list)) { weekday = te; break; }
  let period: string | null = null;
  let periodHint: "am" | "pm" | null = null;
  for (const [list, te, hint] of PERIOD) if (findPhrase(toks, list)) { period = te; periodHint = hint; break; }

  const relHours = joined.match(/\s(?:after\s)?(\d{1,2}|one|two|half an?)\s?(hours?|hrs?|గంటల)\s?(?:tarvata|తర్వాత|later)?\s/);
  const relMinutes = joined.match(/\s(\d{1,3})\s?(mins?|minutes?|నిమిషాల(?:్లో)?|నిమిషాలు|nimishalu|nimishallo)\s/);
  // Hour: digits (6, 6pm, 6:30, 18:00) or number word followed by a "gantalaki" style suffix.
  let hour: number | null = null;
  let minute: number | null = null;
  const m = relHours || relMinutes ? null : joined.match(/\s(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm|a\.m|p\.m)?(?=\s)/i);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) {
      hour = h;
      minute = m[2] ? Number(m[2]) : null;
      if (m[3]) periodHint = m[3].toLowerCase().startsWith("p") ? "pm" : "am";
    }
  }
  if (hour === null) {
    for (let i = 0; i < toks.length; i++) {
      const n = HOUR_WORDS[toks[i]];
      if (n && (HOUR_SUFFIX.test(toks[i + 1] ?? "") || period)) { hour = n; break; }
      // "6 గంటలకి" where the number word itself carries the suffix, e.g. "ఆరింటికి"
    }
  }
  const halfHour = /\s(అరగంట|ara ganta|aragantalo|half an hour)\s/.test(joined);
  const oneHour = /\s(ఒక గంట|గంట తర్వాత|ganta tarvata|oka ganta|one hour|an hour)\s/.test(joined);

  if (!day && !weekday && !period && hour === null && !relHours && !relMinutes && !halfHour && !oneHour) return null;

  // Build a clean Telugu phrase the agent can say back.
  const parts: string[] = [];
  if (day) parts.push(day);
  if (weekday) parts.push(weekday);
  if (hour !== null) {
    let h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    if (!period) {
      if (hour >= 17 || (periodHint === "pm" && hour >= 5 && hour < 8)) period = "సాయంత్రం";
      else if (hour >= 20 || (periodHint === "pm" && hour >= 8)) period = "రాత్రి";
      else if (periodHint === "pm" || (hour >= 12 && hour < 17)) period = "మధ్యాహ్నం";
      else if (periodHint === "am" || (hour >= 6 && hour < 12)) period = "ఉదయం";
    }
    if (period) parts.push(period);
    parts.push(minute === 30 ? `${teluguNumber(h12)}న్నరకి` : hourInTelugu(h12));
  } else if (period) {
    parts.push(day || weekday ? period : `${period}`);
  }
  if (halfHour) parts.push("అరగంట తర్వాత");
  else if (oneHour && hour === null) parts.push("ఒక గంట తర్వాత");
  else if (relHours && hour === null) {
    const n = /^\d+$/.test(relHours[1]) ? Number(relHours[1]) : relHours[1] === "two" ? 2 : 1;
    parts.push(relHours[1].startsWith("half") ? "అరగంట తర్వాత" : `${n === 1 ? "ఒక" : teluguNumber(n)} గంటల తర్వాత`);
  } else if (relMinutes && hour === null) {
    parts.push(`${teluguNumber(Number(relMinutes[1]))} నిమిషాల తర్వాత`);
  }

  let spoken = parts.join(" ").trim();
  // Add the dative "కి" to a bare day/period ("రేపు సాయంత్రం" → spoken as is; reads naturally).
  if (!spoken) return { raw: text.trim(), spoken: null };
  return { raw: text.trim(), spoken };
}
