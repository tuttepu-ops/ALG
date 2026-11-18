// Short, warm Telugu–English reply templates. Fixed lines are `cacheable` (same
// audio reused every session); lines carrying order data are generated fresh.

import { rupeesInTelugu } from "../telugu/numbers";
import type { Order } from "../orders/orders";
import { orderTotal } from "../orders/orders";
import type { Segment, Stage } from "./types";

const s = (text: string): Segment => ({ text, cacheable: true });
const d = (text: string): Segment => ({ text, cacheable: false });

export const T = {
  opening: s("నమస్తే అండి, Godavari Basket voice assistant‌ని. మీ order గురించి ఒక్క నిమిషం మాట్లాడొచ్చా?"),
  greetAck: s("హా, నమస్తే అండి! మీ Godavari Basket order confirm చేయడానికి call చేశాను. ఇప్పుడు మాట్లాడొచ్చా?"),
  greetAgain: s("హా అండి, వినిపిస్తోంది. ఇప్పుడు మాట్లాడొచ్చా?"),
  whyOpening: s("మీరు Godavari Basket లో order చేశారు కదా అండి. Dispatch చేసే ముందు ఒకసారి confirm చేయడానికి call చేశాను. ఇప్పుడు మాట్లాడొచ్చా?"),
  whoOpening: s("నేను Godavari Basket నుంచి మాట్లాడుతున్నాను అండి, మీ order confirm చేయడానికి. ఇప్పుడు మాట్లాడొచ్చా?"),
  permitAck: s("థాంక్స్ అండి."),
  permitWhyAck: s("మీ order confirm చేయడానికే call చేశాను అండి."),
  greetPermitAck: s("నమస్తే అండి, థాంక్స్."),
  whyConfirm: s("మీ order dispatch చేసే ముందు, items, total సరిగ్గా ఉన్నాయో లేదో చూడడానికి అండి. Confirm చేయనా?"),
  whoConfirm: s("నేను Godavari Basket నుంచి మాట్లాడుతున్నాను అండి. మీ order confirm చేయనా?"),
  delivery: s("Confirm అయ్యాక delivery details మీకు message లో పంపిస్తాం అండి."),
  offTopic: s("ఆ విషయం మా team మీకు చెప్తారు అండి."),
  confirmed: s("సరే అండి, మీ order confirm చేశాను. త్వరలోనే dispatch చేస్తాం. Thank you అండి!"),
  noInConfirm: s("సరే అండి. ఏమైనా మార్చాలా, లేక order cancel చేయాలా?"),
  askChange: s("చెప్పండి అండి, ఏం మార్చాలి?"),
  changeSaved: s("సరే అండి, మీ change request మా staff కి పంపాను. వాళ్ళు త్వరలో మీకు confirm చేస్తారు. Thank you అండి!"),
  cancelReadback: s("సరే అండి. మీ order cancel చేయమని మా staff కి request పెట్టనా?"),
  cancelSaved: s("సరే అండి, cancel request మా staff కి పంపాను. Thank you అండి!"),
  readbackNo: s("సరే అండి, ఏం మార్చాలో మళ్ళీ ఒకసారి చెప్పండి."),
  backToConfirm: s("సరే అండి. అయితే order confirm చేయనా?"),
  askCallbackTime: s("పర్లేదు అండి. మీకు ఏ time లో call చేస్తే బాగుంటుంది?"),
  callbackSavedNoTime: s("సరే అండి, మా team తర్వాత మీకు call చేస్తుంది. Thank you అండి!"),
  callbackSavedGeneric: s("సరే అండి, మీరు చెప్పిన time కి మళ్ళీ call చేస్తాం. Thank you అండి!"),
  endNow: s("సరే అండి, తర్వాత మళ్ళీ call చేస్తాం. Thank you అండి!"),
  hold: s("సరే అండి, wait చేస్తాను."),
  clarifyOpening: s("క్షమించండి అండి, సరిగ్గా వినపడలేదు. ఇప్పుడు ఒక్క నిమిషం మాట్లాడొచ్చా?"),
  clarifyConfirm: s("క్షమించండి అండి. Order confirm చేయనా, లేక ఏమైనా మార్చాలా?"),
  clarifyChange: s("క్షమించండి అండి, ఏ item మార్చాలో ఒకసారి చెప్తారా?"),
  clarifyReadback: s("క్షమించండి అండి. ఇలా staff కి చెప్పనా? అవును లేదా కాదు చెప్పండి."),
  clarifyCallback: s("ఏ time కి call చేయాలి అండి? ఉదాహరణకి, సాయంత్రం ఆరు గంటలకి."),
  pendingStaff: s("పర్లేదు అండి. మా staff మీకు తర్వాత call చేసి మాట్లాడతారు. Thank you అండి!"),
  providerTrouble: s("క్షమించండి అండి, ఒక్కసారి సింపుల్ గా చెప్తారా? Confirm చేయాలా, ఏమైనా మార్చాలా, లేక తర్వాత call చేయాలా?"),
  heardYou: s("హా అండి, వినిపిస్తోంది."),
  closed: s("Thank you అండి, మీ request ఇప్పటికే save అయ్యింది."),
  interruptedReread: s("ఒక్కసారి మీ order పూర్తిగా చెప్తాను అండి."),
  q: {
    opening: s("ఇప్పుడు మాట్లాడొచ్చా?"),
    confirm: s("Confirm చేయనా?"),
    change_details: s("ఏం మార్చాలి అండి?"),
    change_readback: s("ఇలా staff కి చెప్పనా?"),
    cancel_readback: s("Cancel request పెట్టనా అండి?"),
    callback_time: s("ఏ time కి call చేయాలి అండి?"),
    closed: s("Thank you అండి!"),
  } as Record<Stage, Segment>,
};

function joinItems(order: Order): string {
  return order.items.map((i) => i.nameTe).join(", ");
}

/** "మీ order‌లో పూతరేకులు, కాజా ఉన్నాయి. మొత్తం ఆరు వందల నలభై రూపాయలు. Confirm చేయనా?" */
export function orderReadout(order: Order): Segment {
  const verb = order.items.length === 1 ? "ఉంది" : "ఉన్నాయి";
  return d(`మీ order‌లో ${joinItems(order)} ${verb}. మొత్తం ${rupeesInTelugu(orderTotal(order))}. Confirm చేయనా?`);
}

export function totalAnswer(order: Order): Segment {
  return d(`మొత్తం ${rupeesInTelugu(orderTotal(order))} అండి. Confirm చేయనా?`);
}

export function changeReadback(detail: string): Segment {
  return d(`సరే అండి, ${detail}. ఇలా మా staff కి చెప్పనా?`);
}

export function callbackSaved(spoken: string): Segment {
  return d(`సరే అండి, ${spoken} మళ్ళీ call చేస్తాం. Thank you అండి!`);
}

/** Plain-text join of segments, for transcripts. */
export function segmentsText(segs: Segment[]): string {
  return segs.map((x) => x.text).join(" ");
}

/** Every fixed line, used to pre-generate cached audio. */
export function allCacheableLines(): string[] {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(T)) {
    if (k === "q") Object.values(v as Record<string, Segment>).forEach((x) => out.add(x.text));
    else out.add((v as Segment).text);
  }
  return [...out];
}
