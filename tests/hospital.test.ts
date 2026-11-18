// Sai Viswas Hospital agent ("Ravi"): inbound + outbound, date booking, Telugu/English.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SampleOrderSource } from "@/lib/orders/orders";
import { runTurn } from "@/lib/turn";
import { newSession } from "@/lib/workflow/engine";
import { detectLang, parseName, parseVisitDate, takenSlots } from "@/lib/workflow/hospital";
import { DOCTORS, freeDates } from "@/lib/hospital/data";
import type { Outcome, SessionState } from "@/lib/workflow/types";

// These tests cover the fixed-rules engine (HOSPITAL_ENGINE=rules), kept as a fallback; the AI agent has its own tests.
beforeAll(() => { vi.stubEnv("HOSPITAL_ENGINE", "rules"); });

const source = new SampleOrderSource();
type Label = { intent: string; detail: string | null } | null;

async function call(id = "HSP-INBOUND", opts: { model?: (text: string) => Label; taken?: Record<string, number> } = {}) {
  const order = (await source.get(id))!;
  const start = newSession("s_t", order);
  let state: SessionState = start.state;
  const hospitalLlm = vi.fn(async (_s: string, _l: string, text: string) => ({ label: opts.model ? opts.model(text) : { intent: "unclear", detail: null }, diag: { called: true, ok: true } }));
  const say = async (text: string, interrupted = false) => {
    const r = await runTurn({ state, order, text, interrupted, taken: opts.taken }, vi.fn() as never, hospitalLlm as never);
    state = r.state;
    return { reply: r.segments.map((s) => s.text).join(" "), outcome: r.outcome, step: r.state.hospital?.step, lang: r.state.hospital?.lang, route: r.diag.route };
  };
  return { opening: start.segments.map((s) => s.text).join(" "), say, hospitalLlm };
}
const inbound = () => call("HSP-INBOUND");
const outbound = () => call("HSP-ALERT-3001");
const detail = (o: Outcome | null) => JSON.parse(o!.detail!);

describe("inbound call — the reference script", () => {
  it("follows the script end to end, without the model", async () => {
    const c = await inbound();
    expect(c.opening).toBe("నమస్కారం అండి! సాయి విశ్వాస్ hospital నుంచి రవి మాట్లాడుతున్నాను. చెప్పండి అండి, మీకు ఎలా help చేయగలను?");
    expect(c.opening).not.toMatch(/\bAI\b/u);
    const a = await c.say("Namaste, Doctor Viswanath garu hospital ki eppudu vastharu? Consultation fee entha?");
    expect(a.reply).toContain("Dr. విశ్వనాథ్ గారు cardiologist అండి");
    expect(a.reply).toContain("November 22, 25 dates లో available");
    expect(a.reply).toContain("కేవలం 100 rupees మాత్రమే");
    expect(a.lang).toBe("te");
    const b = await c.say("Oh okay, chala thakkuve undi. Ma nannagari heart checkup kosam chupinchali, old reports kooda unnayi.");
    expect(b.reply).toContain("అవునండి, పక్కాగా చూపించాలి");
    expect(b.reply).toMatch(/old reports, scanning reports, current medication details/iu);
    expect(b.reply).toContain("November 22 కి కావాలా, లేక 25 కి కావాలా");
    expect(b.reply).toContain("మీ పేరు చెప్తే ఇప్పుడే slot lock చేసి confirm చేస్తాను");
    const d = await c.say("Na peru Ramesh andi. November 22 ki okati confirm cheseyandi.");
    expect(d.outcome?.kind).toBe("appointment_booked");
    expect(d.reply).toContain("Perfect అండి Ramesh గారు! November 22 కి appointment confirm అయిపోయింది");
    expect(d.reply).toContain("WhatsApp కి ఇప్పుడే పంపిస్తున్నాను");
    expect(detail(d.outcome)).toMatchObject({ patient: "Ramesh", date: "2026-11-22", fee: 100, direction: "inbound", doctorId: "dr-viswanath" });
    expect(d.outcome?.meta).toMatchObject({ direction: "inbound", name: "Ramesh", language: "te", date: "2026-11-22" });
    expect(c.hospitalLlm).not.toHaveBeenCalled();
  });

  it("name and date in separate turns, then a readback and a clear yes", async () => {
    const c = await inbound();
    await c.say("appointment కావాలి అండి");
    const d = await c.say("25 కి పెట్టండి");
    expect(d.step).toBe("name");
    const n = await c.say("Suresh");
    expect(n.step).toBe("readback");
    expect(n.reply).toContain("Suresh గారు, November 25");
    expect((await c.say("ఆ")).outcome).toBeNull(); // a bare "ఆ" never books
    expect((await c.say("అవును, confirm చేయండి")).outcome?.kind).toBe("appointment_booked");
  });

  it("caller says thanks and leaves after only asking → enquiry answered", async () => {
    const c = await inbound();
    await c.say("fee ఎంత?");
    const r = await c.say("సరే thank you");
    expect(r.outcome?.kind).toBe("enquiry_answered");
  });
});

describe("English callers get English", () => {
  it("switches to English and books in English", async () => {
    const c = await inbound();
    const a = await c.say("Hi, I want to book an appointment with the cardiologist");
    expect(a.lang).toBe("en");
    expect(a.reply).toContain("Dr. Viswanath");
    expect(a.reply).toContain("November 22nd or the 25th");
    const b = await c.say("My name is Ramesh, the 22nd please");
    expect(b.reply).toContain("Just to confirm: Ramesh, November 22nd");
    const done = await c.say("Yes, please confirm");
    expect(done.outcome?.kind).toBe("appointment_booked");
    expect(done.reply).toContain("Your appointment on November 22nd is confirmed");
    expect(done.reply).toContain("WhatsApp");
    expect(done.outcome?.meta).toMatchObject({ language: "en" });
  });

  it("detects the language of each reply", () => {
    expect(detectLang("What is the fee for the doctor?")).toBe("en");
    expect(detectLang("fee ఎంత?")).toBe("te");
    expect(detectLang("Na peru Ramesh andi. November 22 ki confirm cheseyandi")).toBe("te");
    expect(detectLang("Doctor Viswanath garu eppudu vastharu?")).toBe("te");
    expect(detectLang("okay")).toBe("en");
    expect(detectLang("hmm")).toBeNull();
  });

  it("a Telugu caller who uses a few English words stays in Telugu", async () => {
    const c = await inbound();
    const r = await c.say("appointment book చేయండి please");
    expect(r.lang).toBe("te");
  });
});

describe("outbound new-visit alert", () => {
  it("checks identity, offers the visit, books with the known name", async () => {
    const c = await outbound();
    expect(c.opening).toBe("నమస్కారం అండి! సాయి విశ్వాస్ hospital నుంచి రవి మాట్లాడుతున్నాను. లక్ష్మి గారితోనే మాట్లాడుతున్నానా అండి?");
    const o = await c.say("ఆ నేనే చెప్పండి");
    expect(o.reply).toContain("cardiologist Dr. విశ్వనాథ్ గారు వస్తున్నారు");
    expect(o.step).toBe("offer");
    const d = await c.say("ఆ book చేయండి");
    expect(d.reply).toContain("November 22 కి కావాలా");
    expect(d.reply).not.toContain("పేరు"); // name is known
    const r = await c.say("25 కి");
    expect(r.reply).toContain("లక్ష్మి గారు, November 25");
    const done = await c.say("అవును");
    expect(done.outcome?.kind).toBe("appointment_booked");
    expect(detail(done.outcome)).toMatchObject({ patient: "Lakshmi Devi", date: "2026-11-25", direction: "outbound" });
  });

  it("relative answering books for the patient", async () => {
    const c = await outbound();
    const r = await c.say("నేను వాళ్ళ అబ్బాయిని");
    expect(r.reply).toContain("లక్ష్మి గారికి appointment book చేయమంటారా");
    await c.say("అవును");
    await c.say("22");
    const done = await c.say("అవును");
    expect(detail(done.outcome).onBehalf).toBe(true);
  });

  it("wrong number / not at home / not interested / busy", async () => {
    expect((await (await outbound()).say("wrong number, నాకు ఆవిడ ఎవరో తెలీదు")).outcome?.kind).toBe("pending_staff");
    expect((await (await outbound()).say("ఆమె ఇంట్లో లేరు")).step).toBe("callback_time");
    const n = await outbound();
    await n.say("ఆ నేనే");
    expect((await n.say("వద్దండి, already Kakinada లో చూపించుకున్నాను")).outcome?.kind).toBe("not_interested");
    const b = await outbound();
    const r = await b.say("నేనే, వంటలో ఉన్నాను, సాయంత్రం call back చేయండి");
    expect(r.outcome?.kind).toBe("callback");
  });

  it("can't come on either date → offers the next visit", async () => {
    const c = await outbound();
    await c.say("ఆ నేనే");
    const r = await c.say("ఆ రెండు రోజులు కుదరదు అండి, ఊరిలో లేను");
    expect(r.reply).toContain("next visit అప్పుడు మీకు call చేయమంటారా");
    expect((await c.say("సరే అండి")).outcome?.detail).toContain("next visit");
  });
});

describe("rules: never says AI unprompted, honest when asked, safe", () => {
  it("no AI in normal replies; honest one-liner when asked directly", async () => {
    const c = await inbound();
    const a = await c.say("doctor ఎప్పుడు వస్తారు?");
    expect(a.reply).not.toMatch(/\bAI\b|virtual/u);
    const r = await c.say("మీరు robot ఆ? మనిషా?");
    expect(r.reply).toContain("virtual assistant");
    expect(r.outcome).toBeNull();
  });

  it("emergency → 108 and an urgent record; 'no pain now' is not an emergency", async () => {
    expect((await (await inbound()).say("ఇప్పుడు ఛాతీ నొప్పి ఎక్కువగా ఉంది")).outcome?.kind).toBe("urgent_referral");
    const c = await inbound();
    expect((await c.say("ఇప్పుడు నొప్పి ఏమీ లేదు, checkup కోసం appointment కావాలి")).outcome).toBeNull();
  });

  it("no medical advice; a second medical question goes to reception, noted", async () => {
    const c = await inbound();
    expect((await c.say("BP tablets ఆపాలా?")).reply).toContain("medical advice ఇవ్వలేను");
    expect((await c.say("fasting గా రావాలా?")).reply).toContain("reception");
  });

  it("'ECG facility / parking ఉందా?' → reception (not medical advice); 'ఏమేమి తీసుకురావాలి' answered", async () => {
    const c = await inbound();
    const r = await c.say("ఆ రవి గారు, parking ఉందా అండి? ECG facility కూడా ఉందా, చెప్పండి.");
    expect(r.reply).toContain("reception");
    expect(r.reply).not.toContain("medical advice");
    const b = await inbound();
    expect((await b.say("25th కి book చేస్తారా? ఏమేమి తీసుకురావాలి, fasting గా రావాలా?")).reply).toMatch(/old reports/iu);
  });

  it("questions without data go to reception and are saved with the call", async () => {
    const c = await inbound();
    const p = await c.say("parking ఉందా?");
    expect(p.reply).toContain("reception");
    await c.say("appointment కావాలి");
    const done = await c.say("నా పేరు Ravi, 22 కి confirm చేసేయండి");
    expect(detail(done.outcome).callerQuestions.join(" ")).toContain("parking");
  });

  it("do-not-call is respected", async () => {
    expect((await (await outbound()).say("please don't call me again")).outcome?.kind).toBe("do_not_call");
  });
});

describe("dates, names, capacity", () => {
  const d = DOCTORS[0];
  const free = freeDates(d);
  it("parses dates the way people say them", () => {
    for (const t of ["22", "22nd", "november 22 ki", "ఇరవై రెండు", "twenty second", "iravai rendu", "ఆదివారం", "sunday", "first one", "ఏదైనా"]) expect(parseVisitDate(t, d, free), t).toBe("2026-11-22");
    for (const t of ["25", "25th", "ఇరవై ఐదు", "twenty fifth", "బుధవారం", "the second date", "22 కాకుండా 25"]) expect(parseVisitDate(t, d, free), t).toBe("2026-11-25");
    expect(parseVisitDate("23 తేదీ కి", d, free)).toBe("other");
    expect(parseVisitDate("ఫీ ఎంత", d, free)).toBeNull();
  });

  it("parses names", () => {
    expect(parseName("Na peru Ramesh andi. November 22 ki", "date")).toBe("Ramesh");
    expect(parseName("నా పేరు రమేష్ అండి", "date")).toBe("రమేష్");
    expect(parseName("My name is Anil Kumar", "date")).toBe("Anil Kumar");
    expect(parseName("Suresh", "name")).toBe("Suresh");
    expect(parseName("అవును", "name")).toBeNull();
    expect(parseName("The patient's name is S. Lakshmi.", "date")).toBe("S. Lakshmi");
    expect(parseName("Yes, please book it for my mother, S. Lakshmi.", "offer")).toBe("S. Lakshmi");
  });

  it("50 per date: a full date offers the other one; capacity is re-checked at booking", async () => {
    const outcomes = Array.from({ length: 50 }, () => ({ kind: "appointment_booked", detail: JSON.stringify({ doctorId: "dr-viswanath", date: "2026-11-22" }) })) as Outcome[];
    const taken = takenSlots(outcomes, d);
    expect(taken).toEqual({ "2026-11-22": 50 });
    const c = await call("HSP-INBOUND", { taken });
    await c.say("appointment కావాలి");
    const r = await c.say("22 కి, నా పేరు Ravi");
    expect(r.reply).toContain("November 22 కి slots full");
    expect(r.reply).toContain("November 25 కి slots ఉన్నాయి");
  });
});

describe("model fallback", () => {
  it("labels a reply the rules can't place; the rules still decide", async () => {
    const c = await call("HSP-INBOUND", { model: (t) => (t.includes("vachhe aadivaaram") ? { intent: "date", detail: "22" } : { intent: "name", detail: "Prasad" }) });
    await c.say("appointment కావాలి");
    const a = await c.say("vachhe aadivaaram kudirithe baguntundi");
    expect(a.route).toBe("openai");
    expect(a.step).toBe("name");
    const b = await c.say("ma babai ki, aayana Prasad");
    expect(b.reply).toContain("Prasad");
  });

  it("model failure keeps the call going on the same step", async () => {
    const c = await call("HSP-INBOUND", { model: () => null });
    await c.say("appointment కావాలి");
    const r = await c.say("xyz abc");
    expect(r.route).toBe("openai_failed");
    expect(r.step).toBe("date");
  });
});

describe("found by simulated callers (round 2)", () => {
  it("'తప్పు నెంబర్', 'నేను లక్ష్మి గారు కాను' → wrong number, not a yes", async () => {
    const c = await outbound();
    const r = await c.say("ఆ లేదండి, నేను లక్ష్మి గారు కాను, మీకు తప్పు నెంబర్‌కి call అయ్యింది.");
    expect(r.outcome?.kind).toBe("pending_staff");
  });

  it("robot question + identity together: honest line, then straight to the offer (asked once)", async () => {
    const c = await outbound();
    const r = await c.say("అవునండి నేనే లక్ష్మి, మీరు నిజంగా hospital వాళ్లా లేక robot ఆ అండి? ఎందుకు call చేస్తున్నారు చెప్పండి.");
    expect(r.reply).toContain("virtual assistant");
    expect(r.step).toBe("offer");
    const again = await c.say("robot అయినా పర్లేదండి, appointment book చేయండి");
    expect(again.reply).not.toContain("virtual assistant");
    expect(again.step).toBe("date");
  });

  it("inbound: asks when + fee and books in one breath → facts answered, then booked", async () => {
    const c = await inbound();
    const r = await c.say("మా నాన్నగారి heart checkup కి Dr. Viswanath ఎప్పుడు వస్తారో చెప్పండి, fee కూడా ఎంత అవుతుందో, Nov 22 కి ఒక appointment confirm చేయండి, నా పేరు Ramesh");
    expect(r.reply).toContain("100 rupees");
    expect(r.reply).toContain("November 22, 25");
    expect(r.outcome?.kind).toBe("appointment_booked");
  });

  it("English: fee asked along with booking; 'under her name: Lakshmi'", async () => {
    const c = await inbound();
    const r = await c.say("Hi, I'm calling for my mother. I'd like to know the consultation fee and OP timings, and please book an appointment under her name: Lakshmi.");
    expect(r.lang).toBe("en");
    expect(r.reply).toContain("100 rupees");
    expect(r.reply).not.toContain("patient's name");
    const d = await c.say("The 22nd please");
    expect(d.reply).toContain("Just to confirm: Lakshmi, November 22nd");
  });
});

describe("found by simulated callers (round 3)", () => {
  it("'morning slot ఉంటే చెప్పండి' gets the timings answer before booking", async () => {
    const c = await outbound();
    await c.say("ఆ నేనే");
    const r = await c.say("ఆ అండి, 25th కి book చేయండి… morning slot ఉంటే చెప్పండి.");
    expect(r.reply).toContain("Exact timings");
  });

  it("'next visit ఎప్పుడు?' → dates not fixed yet + offer to call", async () => {
    const c = await outbound();
    await c.say("ఆ నేనే");
    const r = await c.say("నాకు 22nd గాని 25th గాని రావడం కుదరదు, next visit ఎప్పుడు ఉంటుందో చెప్పండి");
    expect(r.reply).toContain("ఇంకా fix అవ్వలేదు");
    expect(r.reply).toContain("call చేయమంటారా");
  });

  it("robot + why: no 'contact reception' for 'ఏంటి విషయం'", async () => {
    const c = await outbound();
    const r = await c.say("ఆ, నేనే లక్ష్మి… మీరేమో robot ఆ? ఎందుకు call చేశారు, ఏంటి విషయం అండి?");
    expect(r.reply).not.toContain("reception");
    expect(r.reply).toContain("Dr. విశ్వనాథ్");
  });
});

it("'ఏం తీసుకురావాలి?' is just a question (no booking jump, no 'అవునండి'); readback grammar", async () => {
  const c = await outbound();
  await c.say("ఆ నేనే");
  const r = await c.say("ఏం తీసుకురావాలి?");
  expect(r.reply).not.toMatch(/^అవునండి/u);
  expect(r.step).toBe("offer");
  await c.say("సరే book చేయండి");
  expect((await c.say("25 కి")).reply).toContain("Dr. విశ్వనాథ్ గారితో cardiology consultation");
});

