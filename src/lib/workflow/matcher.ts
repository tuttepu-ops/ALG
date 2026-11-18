// Stage-aware deterministic understanding of clear replies (no API call).
// Returns null when the reply is ambiguous or needs detail extraction → one LLM call.

import { ALL_PRODUCT_WORDS } from "../orders/orders";
import { hasAny, tokens, uncovered } from "./normalize";
import { extractTime } from "./time";
import type { Interpretation, Stage } from "./types";

// ---- Lexicons (Telugu script, Romanized Telugu, English; STT may emit either script) ----

const FILLER = [
  "andi", "andee", "అండి", "అండీ", "garu", "గారు", "sir", "madam", "madam", "amma", "అమ్మ", "మేడం", "సార్",
  "please", "pls", "plz", "ప్లీజ్", "it", "the", "a", "an", "is", "that", "this", "just", "so", "then", "ok so",
  "ippudu", "ఇప్పుడు", "ga", "ki", "kada", "కదా", "naa", "నా", "my", "me", "na", "order", "ఆర్డర్", "ఆర్డర్ని",
  "mee", "మీ", "and", "also", "kuda", "కూడా", "ra", "ji", "ayya", "అయ్యా", "babu", "బాబు", "now", "you", "can",
  "ఆ", "హా", "ha", "haa", "aa", "um", "uh", "hmm", "హ్మ్", "అ", "ఏ",
];

const GREET = [
  "hi", "hii", "hiii", "hello", "helo", "hallo", "hey", "hai", "namaste", "namasthe", "namaskaram", "namaskaaram",
  "హలో", "హాయ్", "హెలో", "నమస్తే", "నమస్కారం", "నమస్కారాలు", "good morning", "good evening", "good afternoon",
];

/** Words that mean "yes" in any stage. */
const YES = [
  "ha", "haa", "haan", "han", "aa", "aaa", "ఆ", "ఆఁ", "హా", "హాఁ", "హ", "అ",
  "avunu", "avnu", "avunandi", "avnandi", "అవును", "అవునండి", "అవునండీ",
  "ok", "okay", "okk", "okey", "k", "ఓకే", "ఓకె", "ఓకేనండి",
  "sare", "sari", "sarey", "సరే", "సరి", "సరేనండి", "సరేనండీ",
  "yes", "yess", "ya", "yeah", "yep", "yup", "sure", "s", "యెస్", "యస్",
  "alage", "alaage", "అలాగే", "fine", "right", "correct", "కరెక్ట్", "కరెక్టే", "correcte",
];

/** "Go ahead / you may talk" — permission only, never a confirmation. */
const PERMIT_ONLY = [
  "cheppandi", "chepandi", "cheppu", "chepu", "cheppandee", "చెప్పండి", "చెప్పు", "చెప్పండీ", "చెప్పండి అండి",
  // Explicit permission forms only — "మాట్లాడుతున్నారు" (you are talking) is NOT permission.
  "matladandi", "matladandee", "matladochu", "matladochhu", "matladocchu", "matladavachu", "matladu", "matladandi andi",
  "maatladandi", "maatladochu", "maatladu", "matladachu", "matladoch", "matladacchu",
  "మాట్లాడండి", "మాట్లాడండీ", "మాట్లాడొచ్చు", "మాట్లాడొచ్చండి", "మాట్లాడవచ్చు", "మాట్లాడు", "మాట్లాడచ్చు", "మాట్లాడొచ్చు అండి",
  "parledu", "parvaledu", "paravaledu", "parvaledhu", "పర్లేదు", "పర్వాలేదు", "పరవాలేదు",
  "go ahead", "go on", "tell me", "tell", "speak", "continue", "please continue", "kaanivvandi", "kanivvandi", "కానివ్వండి",
  "time undi", "టైం ఉంది", "టైమ్ ఉంది", "free ga unna", "free", "ఫ్రీ", "vintunna", "వింటున్నా", "వింటున్నాను",
];

/** Explicit agreement to the order (only meaningful in the confirm stage). */
const CONFIRM_WORDS = [
  "confirm*", "కన్ఫర్మ్*", "కన్ఫామ్*", "కన్ఫర్*", "correct", "కరెక్ట్", "కరెక్టే", "correcte", "anni correct", "అన్నీ correct",
  "cheyyandi", "cheyandi", "cheyyi", "chey", "చేయండి", "చేయి", "చెయ్యండి", "చెయ్యి", "చేసేయండి", "chesey*",
  "pampinchandi", "pampandi", "pampu", "పంపించండి", "పంపండి", "పంపు", "send", "send it", "dispatch", "dispatch cheyandi",
  "done", "proceed", "perfect", "బాగుంది", "baagundi", "bagundi", "right", "thats right", "అంతే", "ante", "adhe", "అదే",
];

const NEG = [
  "no", "nope", "nah", "vaddu", "vaddandi", "వద్దు", "వద్దండి", "వద్దండీ", "ledu", "ledandi", "లేదు", "లేదండి",
  "kadu", "kaadu", "kaadandi", "కాదు", "కాదండి", "wrong", "tappu", "తప్పు", "not correct", "correct kadu", "కరెక్ట్ కాదు",
];

const BUT = ["but", "kani", "kaani", "కానీ", "కాని", "except"];

const WHY = [
  "why", "enduku", "endhuku", "enduk*", "ఎందుకు", "ఎందుకండి", "ఎందుకు అండి",
  "deni gurinchi", "dheni gurinchi", "deeni gurinchi", "dheeni gurinchi", "దేని గురించి", "దేనికి", "deniki", "dheniki",
  "what about", "what is this", "what is it about", "whats this", "what for", "what is it", "about what",
  "em vishayam", "emi vishayam", "ఏం విషయం", "ఏమి విషయం", "ఏ విషయం", "vishayam enti", "విషయం ఏంటి", "విషయం ఏమిటి",
  "reason", "purpose", "em pani", "ఏం పని", "ఎందుకు call", "enduku call", "call enduku", "కాల్ ఎందుకు",
  "call chesaru", "call chesindi", "కాల్ చేశారు", "కాల్ చేసారు", "కాల్ చేశారండి", "phone chesaru", "ఫోన్ చేశారు",
];

const WHO = [
  "who", "who is this", "who is it", "who are you", "evaru", "evaru meeru", "ఎవరు", "ఎవరండి", "ఎవరు మీరు", "మీరు ఎవరు",
  "ekkadi nunchi", "ekkada nunchi", "ఎక్కడి నుంచి", "ఎక్కడ నుంచి", "ఎక్కడి నుండి", "which company",
];

const WHAT = ["what", "enti", "entandi", "ఏంటి", "ఏంటండి", "emiti", "ఏమిటి", "em", "ఏం", "huh", "హా ఏంటి"];

const REPEAT = [
  "repeat", "malli cheppandi", "malli chepandi", "malli cheppu", "మళ్ళీ చెప్పండి", "మళ్లీ చెప్పండి", "మళ్ళీ చెప్పు",
  "sorry", "pardon", "vinapadaledu", "vinapadala", "vinipinchaledu", "వినపడలేదు", "వినిపించలేదు", "వినపడట్లేదు",
  "artham kaledu", "ardham kaledu", "అర్థం కాలేదు", "అర్ధం కాలేదు", "once more", "one more time", "come again",
  "em annaru", "ఏమన్నారు", "ఏం అన్నారు", "say again", "can you repeat",
];

const HOLD = [
  "wait", "wait*", "ఒక్క నిమిషం", "okka nimisham", "oka nimisham", "ఒక నిమిషం", "one minute", "one sec", "one second",
  "hold on", "hold", "ఆగండి", "agandi", "aagandi", "aagu", "agu", "ఆగు", "ఉండండి", "undandi", "oka second",
];

const CALLBACK = [
  "busy", "బిజీ", "biji", "call back", "callback", "call later", "కాల్ బ్యాక్", "కాల్బ్యాక్", "కాల్ బాక్",
  "later", "తర్వాత", "తరువాత", "tarvata", "tarvatha", "taruvata", "taruvatha", "tarwata", "tharvatha",
  "ippudu kadu", "ippudu kaadu", "ఇప్పుడు కాదు", "ippudu ledu", "ఇప్పుడు లేదు", "ippudu kudaradu", "ఇప్పుడు కుదరదు",
  "kudaradu", "kudaradhu", "కుదరదు", "matladalenu", "matladalem", "మాట్లాడలేను", "మాట్లాడలేం", "మాట్లాడలేను అండి",
  "driving", "drive lo", "drive chestunna", "డ్రైవింగ్", "డ్రైవ్ లో", "meeting", "మీటింగ్", "meeting lo", "office lo",
  "pani lo", "పనిలో", "పనిలో ఉన్నా", "kasepu agi", "kaasepu aagi", "కాసేపు ఆగి", "కాసేపాగి", "kaasepaagi",
  "malli call", "మళ్ళీ కాల్", "మళ్లీ కాల్", "time ledu", "టైం లేదు", "టైమ్ లేదు", "no time", "not now",
  "call me later", "call cheyandi", "call cheyyandi", "కాల్ చేయండి", "కాల్ చెయ్యండి",
];

const END = [
  "bye", "bye bye", "బై", "బై బై", "cut chest*", "కట్ చేస్*", "pettestunna", "పెట్టేస్*", "phone pettey*",
  "don't call", "dont call", "call cheyakandi", "కాల్ చేయకండి", "stop calling",
];

const NO_TIME = [
  "teliyadu", "teledu", "తెలియదు", "తెలీదు", "anytime", "any time", "eppudaina", "ఎప్పుడైనా", "mee ishtam", "మీ ఇష్టం",
  "meeke telusu", "chepta", "naane chestha", "నేనే చేస్తా", "నేనే కాల్ చేస్తా", "i will call", "ill call",
];

const CANCEL = [
  "cancel*", "క్యాన్సిల్*", "కేన్సిల్*", "క్యాన్సల్*", "రద్దు", "raddu", "order vaddu", "ఆర్డర్ వద్దు", "order వద్దు",
  "dont want", "don't want", "not needed", "అవసరం లేదు", "avasaram ledu",
];

const CHANGE_GENERIC = [
  "change*", "chang*", "చేంజ్*", "ఛేంజ్*", "మార్చ*", "marchu*", "maarch*", "march*", "మార్పు", "marpu", "modify", "edit",
];

const CHANGE_SPECIFIC = [
  "add", "యాడ్", "extra", "inko", "inkoka", "ఇంకో", "ఇంకొక", "ఇంకొకటి", "remove", "teese*", "tisey*", "తీసే*", "తీసెయ్*",
  "తీసివే*", "instead", "badulu", "బదులు", "kakunda", "kaakunda", "కాకుండా", "address", "అడ్రస్", "అడ్రెస్",
  "quantity", "qty", "kg", "kgs", "kilo*", "కిలో*", "కేజీ", "box*", "బాక్స్*", "packet*", "ప్యాకెట్*", "half", "double",
  "reduce", "takkuva", "తక్కువ", "ekkuva", "ఎక్కువ", "size", "plus", "grams", "gram", "గ్రాము*", "pincode", "pin code",
  "date", "డేట్", "delivery address", "phone number", "number change",
  ...ALL_PRODUCT_WORDS.map((w) => w.toLowerCase()),
];

const Q_TOTAL = [
  "entha", "enta", "enthaa", "ఎంత", "ఎంతా", "ఎంతండి", "total", "టోటల్", "amount", "అమౌంట్", "price", "rate", "రేటు",
  "ధర", "ఖరీదు", "bill", "బిల్", "how much", "ఎన్ని రూపాయలు", "enni rupayalu",
];
const Q_ITEMS = [
  "em order", "emi order", "ఏం order", "ఏం ఆర్డర్", "ఏ order", "ఏ ఆర్డర్", "which order", "what order", "items enti",
  "ఏమేమి", "ఏమేం", "ఏం items", "em items", "order enti", "order ఏంటి", "ఆర్డర్ ఏంటి", "what did i order", "ఏం పెట్టాను",
  "em pettanu", "items", "ఐటమ్స్",
];
const Q_DELIVERY = [
  "delivery", "డెలివరీ", "eppudu vastundi", "ఎప్పుడు వస్తుంది", "eppudu vastadi", "ఎప్పుడు వస్తది", "when will",
  "eppatiki", "ఎప్పటికి", "courier", "కొరియర్", "reach", "tracking", "ఎప్పుడు పంపిస్తారు", "eppudu pampistaru",
];

const ALL_KNOWN = [
  ...FILLER, ...GREET, ...YES, ...PERMIT_ONLY, ...CONFIRM_WORDS, ...NEG, ...BUT, ...WHY, ...WHO, ...WHAT, ...REPEAT,
  ...HOLD, ...CALLBACK, ...END, ...NO_TIME, ...CANCEL, ...CHANGE_GENERIC, ...Q_TOTAL, ...Q_ITEMS, ...Q_DELIVERY,
];

export interface Signals {
  greet: boolean; yes: boolean; permitOnly: boolean; confirmWord: boolean; neg: boolean; but: boolean;
  why: boolean; who: boolean; what: boolean; repeat: boolean; hold: boolean; callback: boolean; end: boolean;
  noTime: boolean; cancel: boolean; changeGeneric: boolean; changeSpecific: boolean;
  qTotal: boolean; qItems: boolean; qDelivery: boolean; unknownWords: string[];
}

export function signals(text: string): Signals {
  const t = tokens(text);
  return {
    greet: hasAny(t, GREET),
    yes: hasAny(t, YES),
    permitOnly: hasAny(t, PERMIT_ONLY),
    confirmWord: hasAny(t, CONFIRM_WORDS),
    neg: hasAny(t, NEG),
    but: hasAny(t, BUT),
    why: hasAny(t, WHY),
    who: hasAny(t, WHO),
    what: hasAny(t, WHAT),
    repeat: hasAny(t, REPEAT),
    hold: hasAny(t, HOLD),
    callback: hasAny(t, CALLBACK),
    end: hasAny(t, END),
    noTime: hasAny(t, NO_TIME),
    cancel: hasAny(t, CANCEL),
    changeGeneric: hasAny(t, CHANGE_GENERIC),
    changeSpecific: hasAny(t, CHANGE_SPECIFIC) || /\d/.test(t.join(" ")),
    qTotal: hasAny(t, Q_TOTAL),
    qItems: hasAny(t, Q_ITEMS),
    qDelivery: hasAny(t, Q_DELIVERY),
    unknownWords: uncovered(t, [...ALL_KNOWN, ...CHANGE_SPECIFIC]),
  };
}

const W = (intent: Interpretation["intent"], extra: Partial<Interpretation> = {}): Interpretation => ({
  intent, source: "workflow", ...extra,
});
export interface NeedsLlm {
  needsLlm: string;
}
const LLM = (reason: string): NeedsLlm => ({ needsLlm: reason });
export type MatchResult = Interpretation | NeedsLlm;
export const isNeedsLlm = (r: MatchResult): r is NeedsLlm => "needsLlm" in r;

/** More than this many unrecognised words → let the LLM read it. */
const MAX_UNKNOWN = 2;

/**
 * Deterministic interpretation. Returns NeedsLlm when the reply is ambiguous,
 * conflicting, or contains details that must be extracted.
 */
export function matchClear(stage: Stage, text: string): MatchResult {
  const t = tokens(text);
  if (!t.length) return W("empty");
  const s = signals(text);
  const tooManyUnknown = s.unknownWords.length > MAX_UNKNOWN;

  if (stage === "closed") return W("q_other");

  // Busy / call back — any stage. Time may come in the same breath.
  if (s.callback || (s.end && stage !== "callback_time")) {
    if (s.changeSpecific || s.cancel) return LLM("callback mixed with change/cancel");
    const time = extractTime(text);
    if (s.end && !time) return W("end");
    if (tooManyUnknown && !time) return LLM("callback with unrecognised words (possible time)");
    return W("callback", { time });
  }

  switch (stage) {
    case "opening": {
      if (s.cancel || s.changeSpecific || s.changeGeneric) return LLM("change/cancel before order was read");
      if (tooManyUnknown) return LLM(`unrecognised words: ${s.unknownWords.slice(0, 4).join(" ")}`);
      const permit = s.yes || s.permitOnly || s.confirmWord; // "yes confirm it" here = permission only
      const asks = s.why || s.who || s.qItems || s.qDelivery;
      if (s.neg && !permit) return W("no");
      if (s.neg && permit) return LLM("yes and no together");
      if (permit && asks) return W("permit_why");
      if (permit && s.qTotal) return W("permit_why");
      if (s.hold) return W("hold");
      if (s.why) return W("why");
      if (s.who) return W("who");
      if (s.qTotal || s.qItems || s.qDelivery) return W("permit_why");
      if (s.repeat || s.what) return W("why");
      if (permit) return W("permit");
      if (s.greet) return W("greet");
      return LLM("no clear signal");
    }

    case "confirm": {
      if (s.cancel) {
        // "cancel" with product names = partial change, needs detail.
        if (s.changeSpecific) return LLM("partial cancel needs detail");
        return W("cancel");
      }
      if (s.changeSpecific) return LLM("change details to extract");
      if (s.changeGeneric) return tooManyUnknown ? LLM("change with unrecognised detail") : W("change_bare");
      if (tooManyUnknown) return LLM(`unrecognised words: ${s.unknownWords.slice(0, 4).join(" ")}`);
      if (s.but) return LLM("qualified answer (but/kani)");
      const agree = s.yes || s.confirmWord;
      if (agree && s.neg) return LLM("yes and no together");
      if (s.why) return W("why");
      if (s.who) return W("who");
      if (s.qTotal) return W("q_total");
      if (s.qItems) return W("q_items");
      if (s.qDelivery) return W("q_delivery");
      if (s.hold) return W("hold");
      if (s.repeat) return W("repeat");
      // "ha cheppandi" = "go on", not agreement to the order → re-read.
      if (s.permitOnly && !s.confirmWord) return W("repeat");
      if (agree) return W("confirm");
      if (s.neg) return W("no");
      if (s.what || s.greet) return W("repeat");
      return LLM("no clear signal");
    }

    case "change_details": {
      if (s.cancel && !s.changeSpecific) return W("cancel");
      // "nothing to change, confirm it"
      if ((s.confirmWord || (s.neg && !s.changeSpecific && !s.changeGeneric)) && !s.changeSpecific && !tooManyUnknown)
        return W("no");
      if (s.hold && !s.changeSpecific) return W("hold");
      if ((s.repeat || s.what) && !s.changeSpecific) return W("repeat");
      return LLM("change details to extract");
    }

    case "change_readback":
    case "cancel_readback": {
      if (s.changeSpecific || s.changeGeneric || tooManyUnknown) return LLM("read-back answered with new details");
      if ((s.yes || s.confirmWord || s.permitOnly) && !s.neg) return W("yes");
      if (s.neg && !(s.yes || s.confirmWord)) return W("no");
      if (s.hold) return W("hold");
      if (s.repeat || s.what || s.greet) return W("repeat");
      return LLM("no clear yes/no");
    }

    case "callback_time": {
      const time = extractTime(text);
      if (time) return W("time", { time });
      if (s.end) return W("end");
      if (s.noTime) return W("no_time");
      if (s.neg && !tooManyUnknown) return W("no_time");
      if (s.hold) return W("hold");
      if (s.repeat || s.what) return W("repeat");
      return LLM("time phrasing not recognised");
    }
  }
  return LLM("unhandled stage");
}
