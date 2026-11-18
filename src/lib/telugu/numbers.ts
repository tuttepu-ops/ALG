// Telugu number words for spoken rupee amounts and times.
// Amounts are spoken by the app (never by the LLM) so totals are always exact.

const UNITS = [
  "సున్నా", "ఒకటి", "రెండు", "మూడు", "నాలుగు", "ఐదు", "ఆరు", "ఏడు", "ఎనిమిది", "తొమ్మిది",
  "పది", "పదకొండు", "పన్నెండు", "పదమూడు", "పద్నాలుగు", "పదిహేను", "పదహారు", "పదిహేడు", "పద్దెనిమిది", "పందొమ్మిది",
];
const TENS = ["", "", "ఇరవై", "ముప్పై", "నలభై", "యాభై", "అరవై", "డెబ్బై", "ఎనభై", "తొంభై"];

/** 1..99. `attributive` uses "ఒక్క" for a trailing one before a noun (e.g. ఒక్క రూపాయి). */
function below100(n: number, attributive: boolean): string {
  if (n < 20) return n === 1 && attributive ? "ఒక్క" : UNITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (u === 0) return TENS[t];
  return `${TENS[t]} ${u === 1 && attributive ? "ఒక్క" : UNITS[u]}`;
}

/** Hundreds word. `oblique` = form used when something follows (వందల / నూట). */
function hundreds(h: number, oblique: boolean): string {
  if (h === 1) return oblique ? "నూట" : "వంద";
  return `${UNITS[h]} ${oblique ? "వందల" : "వందలు"}`;
}

/**
 * Number in Telugu words. `beforeNoun` = it is followed by a noun such as రూపాయలు,
 * which puts the last group in the oblique form (ఆరు వందల రూపాయలు, రెండు వేల రూపాయలు).
 */
export function teluguNumber(n: number, beforeNoun = false): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`Unsupported number: ${n}`);
  if (n === 0) return UNITS[0];
  if (n >= 1_00_00_000) throw new Error(`Number too large: ${n}`);

  const parts: string[] = [];
  const lakhs = Math.floor(n / 1_00_000);
  const thousands = Math.floor((n % 1_00_000) / 1000);
  const hund = Math.floor((n % 1000) / 100);
  const rest = n % 100;

  const restAfterLakh = n % 1_00_000;
  if (lakhs) {
    const last = restAfterLakh === 0;
    const word = lakhs === 1 ? "ఒక" : below100(lakhs, false);
    parts.push(`${word} ${last && !beforeNoun ? (lakhs === 1 ? "లక్ష" : "లక్షలు") : (lakhs === 1 ? "లక్ష" : "లక్షల")}`);
  }
  const restAfterThousand = n % 1000;
  if (thousands) {
    const last = restAfterThousand === 0;
    if (thousands === 1) parts.push("వెయ్యి");
    else parts.push(`${below100(thousands, false)} ${last && !beforeNoun ? "వేలు" : "వేల"}`);
  }
  if (hund) {
    if (rest > 0) parts.push(hundreds(hund, true)); // నూట నలభై, ఆరు వందల నలభై
    else if (hund === 1) parts.push("వంద"); // వంద / వంద రూపాయలు
    else parts.push(hundreds(hund, beforeNoun)); // ఆరు వందలు / ఆరు వందల రూపాయలు
  }
  if (rest) parts.push(below100(rest, beforeNoun));
  return parts.join(" ");
}

/** "ఆరు వందల నలభై రూపాయలు" */
export function rupeesInTelugu(amount: number): string {
  if (amount === 1) return "ఒక్క రూపాయి";
  return `${teluguNumber(amount, true)} రూపాయలు`;
}

/** Clock hour 1..12 for times: "ఆరు గంటలకి", "ఒంటి గంటకి". */
export function hourInTelugu(h: number): string {
  if (h === 1) return "ఒంటి గంటకి";
  return `${UNITS[h] ?? String(h)} గంటలకి`;
}
