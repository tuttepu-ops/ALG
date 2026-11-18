import { rupeesInTelugu, teluguNumber } from "../telugu/numbers";
import { storeKnowledge } from "./shop-knowledge";
import { CATALOG_ALIASES } from "../orders/orders";
import type { Interpretation, Outcome, SessionState } from "./types";
import type { StepResult } from "./engine";

export const DEMO_ID = "GB-DEMO-1043";
export const catalogue = [
  ["pootharekulu", "Bellam Pootharekulu", "పూతరేకులు", 250, 220, 12, "sweets"],
  ["kaja", "Madatha Kaja", "కాజా", 500, 220, 8, "sweets"],
  ["avakaya", "Avakaya Pickle", "ఆవకాయ", 500, 380, 6, "pickles"],
  ["gongura", "Gongura Pickle", "గోంగూర", 250, 210, 10, "pickles"],
  ["ariselu", "Bellam Ariselu", "అరిసెలు", 500, 280, 5, "sweets"],
  ["sunnundalu", "Sunnundalu", "సున్నుండలు", 500, 340, 0, "sweets"],
  ["karam-podi", "Karam Podi", "కారం పొడి", 200, 150, 7, "podis"],
] as const;

const addressLabels = {
  recipient: "recipient name", house: "flat లేదా house number", street: "street and locality",
  city: "city", state: "state", pin: "six-digit PIN code", landmark: "landmark, ఉంటే",
};
type AddressField = keyof typeof addressLabels;
const fields = Object.keys(addressLabels) as AddressField[];
const pins: Record<string, { state: string; days: string; cod: boolean }> = {
  "533001": { state: "Andhra Pradesh", days: "2–4", cod: true },
  "500081": { state: "Telangana", days: "2–4", cod: true },
  "560001": { state: "Karnataka", days: "4–7", cod: false },
};
export interface ShopDraft {
  cart: Record<string, number>;
  address: Record<AddressField, string>;
  task: "cart" | "address" | "address-check" | "final" | null;
  field: number;
  page: number;
  category: string | null;
  openingQuestions: number;
  waitingForRecipient: boolean;
  edit?: "add" | "remove" | "set";
  product?: string;
  offeredSku?: string;
}
export function initialShop(): ShopDraft {
  return {
    cart: { avakaya: 1, gongura: 1 },
    address: { recipient: "Ananya", house: "Flat 2B", street: "14 Sample Lane, Demo Colony",
      city: "Kakinada", state: "Andhra Pradesh", pin: "533001", landmark: "near Sample Park" },
    task: null, field: 0, page: 0, category: null, openingQuestions: 0, waitingForRecipient: false,
  };
}
export function totals(draft: ShopDraft) {
  const subtotal = catalogue.reduce((sum, [sku, , , , price]) => sum + (draft.cart[sku] ?? 0) * price, 0);
  const grams = catalogue.reduce((sum, [sku, , , weight]) => sum + (draft.cart[sku] ?? 0) * weight, 0);
  const pin = pins[draft.address.pin];
  const shipping = pin ? (pin.cod ? 60 : Math.round(120 * grams / 1000)) : null;
  return { subtotal, grams, shipping, total: shipping === null ? null : subtotal + shipping };
}

export function shopTurn(prev: SessionState, raw: string, interrupted: boolean, interpretation?: Interpretation): StepResult | null {
  const draft = structuredClone(prev.shop ?? initialShop());
  const state = { ...prev, shop: draft, turn: prev.turn + 1 };
  const text = raw.trim().toLowerCase().replace(/[౦-౯]/gu, (digit) => String(digit.charCodeAt(0) - 0x0c66));
  const intent = interpretation?.intent;
  const reply = (line: string, outcome: Outcome | null = null) => {
    const chunks = line.match(/.{1,520}(?:\s|$)|.{1,520}/gu) ?? [line];
    state.lastReply = chunks.map((chunk) => ({ text: chunk.trim(), cacheable: false }));
    state.unclearStreak = 0;
    return { state, segments: state.lastReply, outcome };
  };
  const close = (kind: Outcome["kind"], detail: string | null = null, callbackTime: string | null = null) => {
    state.stage = "closed";
    state.outcome = kind;
    const lines: Partial<Record<Outcome["kind"], string>> = {
      confirmed: "మీ order confirm అయింది అండి. ధన్యవాదాలు!",
      change_request: "మీ request నమోదు చేశాను అండి.",
      cancel_request: "Cancellation request నమోదు చేశాను అండి. Staff review చేస్తారు.",
      callback: "మీరు చెప్పిన సమయం staff కోసం నమోదు చేశాను అండి.",
      pending_staff: "Staff review కోసం నమోదు చేశాను అండి.",
      do_not_call: "మళ్లీ call చేయవద్దని నమోదు చేశాను అండి.",
    };
    return reply(lines[kind] ?? lines.pending_staff!, {
      sessionId: state.sessionId, orderId: state.orderId, kind, detail, callbackTime,
      customerWords: kind === "pending_staff" ? "" : raw, route: interpretation?.source ?? "workflow",
      turn: state.turn, recordedAt: new Date().toISOString(),
    });
  };
  const address = () => fields.map((field) => draft.address[field]).filter(Boolean).join(", ");
  const cart = () => catalogue.filter(([sku]) => draft.cart[sku]).map(([sku, , name, weight]) =>
    `${name} ${weight} గ్రాముల pack, ${draft.cart[sku]}`).join(". ");
  const { subtotal, shipping, total } = totals(draft);
  const final = () => {
    draft.task = null;
    if (!subtotal) return reply("Cart ఖాళీగా ఉంది అండి. ఏ item add చేయాలి?");
    if (total === null) return close("pending_staff", "Unsupported delivery PIN");
    draft.task = "final";
    return reply(`${cart()}. Delivery address ${address()}. Shipping ${shipping} రూపాయలు. మొత్తం ${total} రూపాయలు. ఈ order confirm చేయనా అండి?`);
  };
  const yes = /^(yes|yeah|yes confirm( it)?|confirm( it)?|ok(ay)?|అవును( అండి)?|ఆ( అండి)?|సరే( అండి)?|confirm చేయండి)[.! ]*$/i.test(text);
  if (prev.stage === "closed") return reply("ఈ call పూర్తయింది అండి.");
  if (/stop calling|do not call|don't call|మళ్లీ call చేయొద్దు|కాల్ చేయొద్దు|కాల్ చేయకండి|call చేయకండి/u.test(text)) return close("do_not_call");
  if (/\b(?:otp|cvv|upi pin|password|card number)\b|(?<!\d)(?:\d[ -]?){13,19}(?!\d)/i.test(text)) return reply("Payment secrets చెప్పకండి అండి. Prepaid లేదా eligible PINకి COD ఉంటుంది.");
  if (/wrong (?:person|number)|not ananya|i am not|నేను అనన్య కాదు|wrong recipient/u.test(text)) {
    state.stage = "opening";
    draft.waitingForRecipient = true;
    return reply("అనన్య గారితో మాట్లాడొచ్చా అండి?");
  }
  if (prev.stage === "callback_time") {
    if (!text || yes || intent === "q_other") return reply("ఏ రోజు, ఏ సమయం call చేయాలి అండి?");
    return close("callback", draft.offeredSku ? `Interested in ${draft.offeredSku}` : null, raw);
  }
  if (/\bbusy\b|call (?:me )?later|callback|బిజీ|తర్వాత కాల్|తర్వాత మాట్లాడ/u.test(text) || intent === "callback") {
    state.stage = "callback_time";
    return reply("సరే అండి. ఏ సమయానికి మళ్లీ call చేయాలి?");
  }
  const catalogueQuestion = /\blist\b|catalog|లిస్ట్|జాబితా|ఏవి ఉన్నాయి|ఏమేం products|available(?:-గా ఉన్న| గా ఉన్న)? (?:items|products)|product options|more options|ఇంకా ఏవి|ప్రొడక్ట్స్.{0,90}అవైలబుల్|అవైలబుల్.{0,90}ప్రొడక్ట్స్/u.test(text);
  const recommendation = /recommend|suggest|what should i (?:buy|get)|what goes with|ఏది బాగుంటు|ఏ item బాగుంటు|ఏం తీసుకోమంటారు|సజెస్ట్/u.test(text);
  if (prev.stage === "opening") {
    const permission = yes || /^(?:yeah hi|go ahead|you can speak|మాట్లాడండి|మాట్లాడొచ్చు|చెప్పండి|ఆ చెప్పండి)[.! ]*$/u.test(text);
    if (draft.waitingForRecipient && !/^(?:this is ananya|ananya speaking|నేనే అనన్య)[.! ]*$/u.test(text)) {
      return reply("అనన్య గారు available ఉంటే వారితో మాట్లాడతాను అండి.");
    }
    if (draft.waitingForRecipient) {
      draft.waitingForRecipient = false;
      return reply("ధన్యవాదాలు అండి. మీ order గురించి ఇప్పుడు మాట్లాడొచ్చా?");
    }
    const shoppingReply = (recommendation || catalogueQuestion || /(?:cart|కార్ట్).*(?:add|యాడ్)|(?:add|యాడ్).*items/u.test(text))
      && !/don.t (?:talk|call)|no time|మాట్లాడలే/u.test(text);
    if (shoppingReply || permission || intent === "permit" || (catalogueQuestion && /మాట్లాడొచ్చండి|మాట్లాడొచ్చు|మాట్లాడండి|చెప్పండి|go ahead/u.test(text) && !/మాట్లాడొచ్చా/u.test(text))) {
      if (shoppingReply || catalogueQuestion) return shopTurn({ ...prev, stage: "confirm", shop: draft }, raw, interrupted, interpretation);
      state.stage = "confirm";
      return reply(`మీ cartలో ${cart()} ఉన్నాయి. Items మొత్తం ${subtotal} రూపాయలు. Cart లేదా addressలో ఏమైనా మార్చాలా అండి?`);
    }
    if (text || intent) {
      draft.openingQuestions++;
      if (draft.openingQuestions > 2) return close("pending_staff", "Could not obtain permission to discuss order");
      return reply(draft.openingQuestions === 1
        ? "Dispatch ముందు items, delivery details సరిగా ఉన్నాయో చూసుకోవడానికి call చేశాను అండి. ఇప్పుడు మాట్లాడటానికి time ఉందా?"
        : "Order details check చేయడానికి call చేశాను అండి. ఇప్పుడు time ఉంటే ‘చెప్పండి’ అనండి. లేదంటే callback time చెప్పండి.");
    }
    return reply("ఇప్పుడు మాట్లాడొచ్చా అండి?");
  }
  if (/repeating|same thing|మళ్ళీ చెప్తున్నారు|మళ్లీ చెప్తున్నారు/u.test(text) && !/list|లిస్ట్|products/u.test(text)) {
    return reply("అర్థమైంది అండి. మీకు items list కావాలా, delivery details మార్చాలా?");
  }

  const hold = /don.t confirm|do not confirm|not confirm|confirm చేయొద్దు|confirm చేయకండి|confirm వద్దు|కన్ఫర్మ్ చేయొద్దు/u.test(text);
  if (hold && draft.task === "final") draft.task = null;
  const matches = catalogue.flatMap((product) => {
    const [sku, name, te] = product;
    const aliases = [sku, name.toLowerCase(), te, ...(CATALOG_ALIASES[sku] ?? []), ...(sku === "karam-podi" ? ["karam podi", "కారంపొడి"] : [])];
    const index = Math.min(...aliases.map((alias) => text.indexOf(alias)).filter((position) => position >= 0));
    return Number.isFinite(index) ? [{ product, index }] : [];
  }).sort((a, b) => a.index - b.index);
  const resume = draft.task === "address" ? ` ${addressLabels[fields[draft.field]]} చెప్పండి అండి.` : "";
  if (draft.task === "address" && /price|pack size|stock|ధర/u.test(text) && !matches.length) {
    return reply("ఏ product గురించి అడుగుతున్నారు అండి?");
  }
  const offerPrompt = "ఒక ప్యాక్ కలపనా అండి?";
  const offered = catalogue.find(([sku]) => sku === draft.offeredSku);
  if (offered && prev.lastReply.at(-1)?.text.endsWith(offerPrompt) && !interrupted && !hold) {
    if (/^(?:no(?: thanks)?|లేదు|వద్దు|వద్దండి)[.! ]*$/u.test(text)) {
      draft.offeredSku = undefined;
      return reply("సరే అండి. మీ cart అలాగే ఉంటుంది.");
    }
    if (/^(?:yes|yeah|ok(?:ay)?|add it|అవును(?: అండి)?|సరే(?: అండి)?|యాడ్ చేయండి)[.! ]*$/u.test(text)) {
      const [sku, , name, , , stock] = offered;
      const quantity = (draft.cart[sku] ?? 0) + 1;
      draft.offeredSku = undefined;
      if (quantity > stock) return reply(`${name} ఇంకో ప్యాక్ ప్రస్తుతం stockలో లేదు అండి.`);
      draft.cart[sku] = quantity;
      draft.task = null;
      return reply(`${name} ఒక ప్యాక్ add చేశాను అండి. Items మొత్తం ${totals(draft).subtotal} రూపాయలు. ఇంకేమైనా కావాలా?`);
    }
  }
  if (!hold && (!draft.task || draft.task === "cart") && recommendation) {
    const category = /sweet|dessert|తీపి|స్వీట్/u.test(text) ? "sweets"
      : /pickle|పచ్చడి/u.test(text) ? "pickles"
      : /rice|podi|అన్నం|పొడి/u.test(text) ? "podis" : null;
    if (!category) return reply("స్వీట్స్, పచ్చళ్ళు, పొడులు ఉన్నాయి అండి. మీకు ఏది ఇష్టం?");
    const suggested = catalogue.find(([sku, , , , , stock, group]) => group === category && stock > (draft.cart[sku] ?? 0));
    if (suggested) {
      const [sku, , name, weight, price] = suggested;
      draft.offeredSku = sku;
      const reason = category === "sweets" ? "బెల్లంతో చేసిన తీపి కావాలంటే" : "అన్నంతో కలిపి తినడానికి";
      return reply(`${reason} ${name} బాగుంటాయి అండి. ${teluguNumber(weight)} గ్రాముల ప్యాక్, ${rupeesInTelugu(price)}. ${offerPrompt}`);
    }
  }
  if (/^(?:i.m interested|interested|ఆసక్తి ఉంది|later maybe|need time|let me think)[.! ]*$/u.test(text)) {
    state.stage = "callback_time";
    return reply("సరే అండి. మీకు సౌకర్యంగా ఉంటే మళ్లీ మాట్లాడొచ్చు. ఏ రోజు, ఏ సమయం బాగుంటుంది?");
  }
  const knowledge = storeKnowledge(text, matches.map(({ product }) => product[0]));
  if (knowledge) return reply(knowledge.endsWith("Review request పెట్టాలా?") ? knowledge : knowledge + resume);
  const category = /sweets|స్వీట్స్/u.test(text) ? "sweets" : /pickles|పచ్చళ్ళు|పచ్చళ్లు/u.test(text) ? "pickles" : /podis|పొడులు/u.test(text) ? "podis" : null;
  if (catalogueQuestion || (category && !matches.length)) {
    const more = /more|ఇంకా/u.test(text);
    if (!more) draft.page = 0;
    if (category || !more) draft.category = category;
    const available = catalogue.filter((p) => p[5] > 0 && (!draft.category || p[6] === draft.category));
    const page = available.slice(draft.page, draft.page + 3);
    draft.page += page.length;
    if (/add|యాడ్/u.test(text) && draft.task !== "address") { draft.task = "cart"; draft.edit = "add"; }
    return reply((page.length ? `Available items: ${page.map((p) => p[2]).join(", ")}.` : "ఈ listలో ఇంకో item లేదు అండి.") +
      (resume || (draft.task === "cart" ? " ఏవి, ఎన్ని packs add చేయాలి అండి?" : " ఏ item గురించి తెలుసుకోవాలి అండి?")));
  }
  if (/price|cost|pack size|stock|available|ధర|ఎంత|ఉన్నాయా/u.test(text) && matches.length) {
    return reply(matches.slice(0, 3).map(({ product: [, , name, grams, price, stock] }) =>
      `${name}, ${grams} గ్రాములు, ${price} రూపాయలు. ${stock ? "Stock ఉంది." : "ఇప్పుడు stock లేదు."}`).join(" ") + resume);
  }
  if (/shipping|delivery (?:charge|time|estimate)|\bcod\b|payment|prepaid|ఎప్పుడు వస్త/u.test(text) || intent === "q_delivery") {
    const region = pins[draft.address.pin];
    return reply(region ? `Shipping ${shipping} రూపాయలు. Delivery estimate ${region.days} business days. ${region.cod ? "Prepaid లేదా COD ఉంది." : "Prepaid మాత్రమే ఉంది."}${resume}`
      : "ఈ PINకి delivery వివరాలు staff check చేయాలి అండి. Staff review కావాలా?");
  }
  if (/\btotal\b|subtotal|మొత్తం/u.test(text) || intent === "q_total") return reply(`Items మొత్తం ${subtotal} రూపాయలు.${total === null ? "" : ` Shippingతో ${total} రూపాయలు.`}${resume}`);
  if (yes && !interrupted && prev.lastReply.at(-1)?.text.endsWith("Review request పెట్టాలా?")) return close("pending_staff", "Customer requested staff review");
  if (/\breturn|refund|damaged|wrong item|complaint|human|staff review/u.test(text)) {
    if (/request|raise|staff review|complaint/u.test(text)) return close("pending_staff", "Customer requested staff review");
    return reply("Wrong లేదా damaged item అయితే staff review request నమోదు చేయగలను అండి. Review request పెట్టాలా?");
  }
  if (/cancel(?:lation)? policy|can i cancel/u.test(text)) return reply("Cancellation requestని staff review చేస్తారు అండి. Cancel request పెట్టాలా?");
  if (/cancel (?:the |my )?order|order cancel|ఆర్డర్ cancel/u.test(text) || intent === "cancel") {
    draft.task = null;
    state.stage = "cancel_readback";
    return reply("Order cancel request staffకి నమోదు చేయనా అండి?");
  }
  if (yes && !interrupted && /నమోదు చేయనా అండి\?|Cancel request పెట్టాలా\?/u.test(prev.lastReply.at(-1)?.text ?? "")) return close("cancel_request");
  if (/change (?:the |my )?address|update (?:the |my )?(?:delivery|address)|address (?:change|update)|address మార్చ|డెలివరీ అడ్రస్/u.test(text) && !hold) {
    draft.task = "address";
    draft.field = 0;
    return reply("కొత్త delivery address తీసుకుంటాను అండి. Recipient name చెప్పండి.");
  }
  const pin = text.match(/\b\d{6}\b/u)?.[0];
  if (pin && (draft.task === "address" || draft.task === "address-check" || /pin|pincode/u.test(text))) {
    if (!pins[pin]) return close("pending_staff", "Unsupported delivery PIN");
    if (draft.task === "address" && draft.field < 5) {
      draft.address.pin = pin;
      return reply(`PIN update చేశాను అండి.${resume}`);
    }
    draft.address.pin = pin;
    draft.address.state = pins[pin].state;
    draft.task = "address";
    draft.field = 6;
    return reply("Landmark ఉంటే చెప్పండి అండి. లేకపోతే ‘skip’ అనండి.");
  }
  if (draft.task === "address" && raw && !hold && !yes && !/[?？]/u.test(raw)) {
    const field = fields[draft.field];
    if (field === "pin") return reply("ఆరు అంకెల PIN code చెప్పండి అండి.");
    draft.address[field] = field === "landmark" && /skip|none|లేదు/u.test(text) ? "" : raw.trim().slice(0, 80);
    draft.field++;
    if (draft.field === fields.length) {
      draft.task = "address-check";
      return reply(`Address ${address()}. ఇది సరైనదేనా అండి?`);
    }
    return reply(`${addressLabels[fields[draft.field]]} చెప్పండి అండి.`);
  }
  if (draft.task === "address-check" && yes && !interrupted && prev.lastReply.at(-1)?.text.endsWith("ఇది సరైనదేనా అండి?")) {
    draft.task = null;
    return reply("Address update చేశాను అండి. ఇంకేమైనా మార్చాలా?");
  }

  if (/^(?:confirm(?: (?:it|the order|my order))?|order confirm చేయండి|checkout|place (?:the |my )?order|confirm చేయండి)[.! ]*$/u.test(text) && draft.task && draft.task !== "final") {
    return reply("ముందు pending details పూర్తి చేద్దాం అండి." + (resume || (draft.task === "address-check" ? " Address సరైనదేనా?" : " ఏ items, ఎన్ని packs కావాలి?")));
  }
  if (draft.task === "address-check" && yes) return reply(`Address ${address()}. ఇది సరైనదేనా అండి?`);
  if (draft.task === "address-check" && /^(?:no|కాదు|లేదు)[.! ]*$/u.test(text)) {
    draft.task = "address";
    draft.field = 0;
    return reply("సరే అండి, address మళ్లీ తీసుకుంటాను. Recipient name చెప్పండి.");
  }
  const edit = /remove|తీసేయ|తొలగించ/u.test(text) ? "remove"
    : /set quantity|update quantity|change quantity|quantity మార్చ/u.test(text) ? "set"
    : /\badd\b|యాడ్|చేర్చ/u.test(text) ? "add" : draft.task === "cart" ? draft.edit : undefined;
  if (draft.task === "cart" && yes && !matches.length) return reply("ఏ items, ఎన్ని packs కావాలి అండి?");
  if (hold && !matches.length && !/\badd\b|యాడ్|చేర్చ/u.test(text)) {
    return reply("సరే అండి. Order pendingలో ఉంటుంది." + (resume || " ఏమైనా మార్చాలంటే చెప్పండి."));
  }
  if (edit || intent === "change" || intent === "change_bare") {
    draft.task = "cart";
    draft.edit = edit ?? "add";
    const chosen = matches.length ? matches : catalogue.flatMap((product) => product[0] === draft.product ? [{ product, index: 0 }] : []);
    if (!chosen.length) return reply("Order pendingలో ఉంచుతాను అండి. ఏ items, ఎన్ని packs కావాలి?");
    const next = { ...draft.cart };
    for (const { product: [sku, , name, grams, , stock, group], index } of chosen) {
      const before = text.slice(0, index).split(/ and |,| మరియు | కూడా /u).at(-1) ?? "";
      const after = text.slice(index).split(/ and |,| మరియు | కూడా /u)[0];
      const weight = after.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|grams?)\b/u);
      if (weight && Number(weight[1]) * (weight[2] === "kg" ? 1000 : 1) !== grams) return reply(`${name} ${grams} గ్రాముల pack ఉంది అండి. ఈ pack కావాలా?`);
      if (!stock && draft.edit !== "remove") {
        const alternative = catalogue.find((p) => p[5] && p[6] === group);
        return reply(`${name} stock లేదు అండి.${alternative ? ` ${alternative[2]} ఉంది. అది కావాలా?` : ""}`);
      }
      const quantity = before.match(/(?:^|\s)(\d+)\s*(?:×|x|packs?|boxes?)?\s*$/u)?.[1]
        ?? after.match(/\b(\d+)\s*(?:packs?|boxes?)\b/u)?.[1]
        ?? (/^\d+$/u.test(text) ? text : undefined);
      const spoken = Object.entries({ one: 1, two: 2, three: 3, "ఒక": 1, "ఒక్క": 1, "రెండు": 2, "మూడు": 3 })
        .find(([word]) => before.trim().endsWith(word) || after.includes(` ${word} pack`) || after.endsWith(` ${word}`))?.[1];
      const count = quantity === undefined ? spoken : Number(quantity);
      if (count === undefined && draft.edit !== "remove") {
        draft.product = sku;
        return reply(`${name} ${grams} గ్రాముల pack అండి. ఎన్ని packs కావాలి?`);
      }
      const current = next[sku] ?? 0;
      const updated = draft.edit === "remove" ? Math.max(0, current - (count ?? current)) : draft.edit === "set" ? count! : current + count!;
      if (!Number.isSafeInteger(updated) || updated < 0 || (draft.edit !== "remove" && updated > stock)) return reply(`${name} stockలో ${stock} packs ఉన్నాయి అండి. ఎన్ని కావాలి?`);
      if (updated) next[sku] = updated;
      else delete next[sku];
    }
    draft.cart = next;
    draft.task = null;
    draft.product = undefined;
    return reply(`Cart update చేశాను అండి. Items మొత్తం ${totals(draft).subtotal} రూపాయలు. ఇంకేమైనా మార్చాలా?`);
  }

  if (/cart|order items|ఏం order/u.test(text) || intent === "q_items") return reply((cart() || "Cart ఖాళీగా ఉంది అండి.") + resume);
  if (draft.task === "final" && yes && !interrupted && prev.lastReply.at(-1)?.text.endsWith("ఈ order confirm చేయనా అండి?")) {
    return close("confirmed", JSON.stringify({ cart: draft.cart, address: draft.address, ...totals(draft) }));
  }
  if (/^(?:confirm(?: (?:it|the order|my order))?|order confirm చేయండి|checkout|place (?:the |my )?order|final total|confirm చేయండి)[.! ]*$/u.test(text) || (draft.task === "final" && yes)) return final();
  if (/support|contact|email|help/u.test(text)) return reply("Support email support@example.test అండి. ఏ విషయంలో help కావాలి?");
  if (/^(?:no|nothing else|లేదు|ఇంకేం లేదు)[.! ]*$/u.test(text) && !draft.task) return final();
  if (!interpretation && text && !yes) return null;
  const streak = prev.unclearStreak + 1;
  if (streak >= 2) return close("pending_staff", "Repeated misunderstanding");
  const result = reply("సరిగ్గా అర్థం కాలేదు అండి." + (resume || " Items, cart లేదా deliveryలో ఏది check చేయాలి?"));
  state.unclearStreak = streak;
  return result;
}
