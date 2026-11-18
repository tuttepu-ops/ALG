// AI hospital agent ("Ravi"): the model is mocked; these test what the CODE guarantees around it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SampleOrderSource } from "@/lib/orders/orders";
import { newSession } from "@/lib/workflow/engine";
import { agentTurn, availability, callerAgreed, firstSentence, stripAck } from "@/lib/agent/hospitalAgent";
import { DOCTORS_KB } from "@/lib/hospital/knowledge";

const NOW = new Date("2026-11-18T09:00:00Z"); // Wednesday
beforeEach(() => { vi.stubEnv("OPENAI_API_KEY", "test"); vi.stubEnv("HOSPITAL_ENGINE", "ai"); });
afterEach(() => vi.unstubAllEnvs());

type Item = Record<string, unknown>;
const say = (text: string): Item => ({ type: "message", content: [{ type: "output_text", text }] });
const tool = (name: string, args: unknown, id = "c1"): Item => ({ type: "function_call", name, arguments: JSON.stringify(args), call_id: id });

/** A scripted model: each call returns the next list of output items; records what the code sent back. */
function model(...rounds: Item[][]) {
  const sent: unknown[] = [];
  const request = vi.fn(async (body: unknown) => { sent.push(body); return { output: rounds.shift() ?? [say("…")], usage: { input_tokens: 10, output_tokens: 5 } }; });
  const toolResults = () => sent.flatMap((b) => ((b as { input: Item[] }).input).filter((i) => i.type === "function_call_output").map((i) => JSON.parse(String(i.output))));
  return { request, toolResults, sent };
}

async function start(id = "HSP-INBOUND") {
  const order = (await new SampleOrderSource().get(id))!;
  return newSession("s_agent", order).state;
}

describe("AI agent guardrails", () => {
  it("books only after a clear yes from the caller", async () => {
    let state = await start();
    const m1 = model([tool("book_appointment", { doctor_id: "dr-viswanath", date: "2026-11-22", patient_name: "Ramesh" })], [say("ఒక్కసారి confirm చేస్తాను: Ramesh గారు, November 22. Confirm చేయమంటారా?")]);
    const r1 = await agentTurn(state, "November 22 ki Ramesh", false, { now: NOW, request: m1.request });
    expect(m1.toolResults()[0]).toMatchObject({ ok: false });
    expect(r1.outcome).toBeNull();
    state = r1.state;
    const m2 = model([tool("book_appointment", { doctor_id: "dr-viswanath", date: "2026-11-22", patient_name: "Ramesh" })], [say("Perfect అండి Ramesh గారు! Appointment confirm అయిపోయింది.")]);
    const r2 = await agentTurn(state, "అవును confirm చేయండి", false, { now: NOW, request: m2.request });
    expect(m2.toolResults()[0]).toMatchObject({ ok: true });
    expect(r2.outcome?.kind).toBe("appointment_booked");
    expect(JSON.parse(r2.outcome!.detail!)).toMatchObject({ doctorId: "dr-viswanath", date: "2026-11-22", patient: "Ramesh", fee: 100 });
    expect(r2.state.stage).not.toBe("closed"); // caller can still ask something
  });

  it("refuses invented dates, unknown doctors and full days", async () => {
    const state = await start();
    const m = model([
      tool("book_appointment", { doctor_id: "dr-viswanath", date: "2026-11-23", patient_name: "A" }, "a"),
    ], [tool("book_appointment", { doctor_id: "dr-nobody", date: "2026-11-22", patient_name: "Ravi" }, "b")],
    [tool("book_appointment", { doctor_id: "dr-viswanath", date: "2026-11-22", patient_name: "Ravi" }, "c")], [say("Sorry అండి.")]);
    await agentTurn(state, "yes confirm", false, { now: NOW, request: m.request, taken: { "dr-viswanath|2026-11-22": 50 } });
    const [a, b, c] = m.toolResults();
    expect(a.error).toContain("not available");
    expect(b.error).toContain("Unknown doctor");
    expect(c.error).toContain("full");
  });

  it("emergency and silence are handled by code, without the model", async () => {
    const state = await start();
    const m = model();
    const r = await agentTurn(state, "ఇప్పుడు ఛాతీ నొప్పి చాలా ఎక్కువగా ఉంది", false, { now: NOW, request: m.request });
    expect(r.outcome?.kind).toBe("urgent_referral");
    expect(r.segments[0].text).toContain("108");
    expect(m.request).not.toHaveBeenCalled();
    const s = await agentTurn(state, "", false, { now: NOW, request: m.request });
    expect(s.segments[0].text).toContain("వినిపిస్తోందా");
  });

  it("never claims to be human", async () => {
    const r = await agentTurn(await start(), "are you a real person?", false, { now: NOW, request: model([say("Yes, I am a real person, tell me.")]).request });
    expect(r.segments[0].text).toContain("virtual assistant");
  });

  it("end_call closes the call with the outcome; log_for_team is kept for the team", async () => {
    const m = model([tool("log_for_team", { summary: "Billing complaint from last visit" }, "x")], [tool("end_call", { outcome: "needs_team", callback_time: null, note: "complaint" }, "y"), say("అర్థమైంది అండి, team తో check చేసి మీకు update చేస్తాను. Thank you!")]);
    const r = await agentTurn(await start(), "last time bill ఎక్కువ వేశారు, చాలా కోపం గా ఉంది", false, { now: NOW, request: m.request });
    expect(r.state.stage).toBe("closed");
    expect(r.outcome?.kind).toBe("pending_staff");
    expect(r.outcome?.detail).toContain("Billing complaint");
  });

  it("model failure: polite retry once, then hand to the team", async () => {
    const bad = vi.fn(async () => { throw new Error("down"); });
    const r1 = await agentTurn(await start(), "hello", false, { now: NOW, request: bad });
    expect(r1.outcome).toBeNull();
    const r2 = await agentTurn(r1.state, "hello?", false, { now: NOW, request: bad });
    expect(r2.outcome?.kind).toBe("pending_staff");
  });

  it("live free dates and the language go to the model each turn", async () => {
    const m = model([say("Sure, the 22nd works.")]);
    await agentTurn(await start(), "I want to book the cardiologist", false, { now: NOW, request: m.request });
    const dev = ((m.sent[0] as { input: Item[] }).input).find((i) => i.role === "developer")!.content as string;
    expect(dev).toContain("dr-viswanath: 2026-11-22 Sun, 2026-11-25 Wed");
    expect(dev).toContain("ENGLISH");
  });
});

describe("helpers", () => {
  it("availability: visiting dates and the next OP days, minus bookings", () => {
    const v = availability(DOCTORS_KB.find((d) => d.id === "dr-viswanath")!, NOW, { "dr-viswanath|2026-11-22": 10 });
    expect(v).toEqual([{ date: "2026-11-22", day: "Sunday", free: 40 }, { date: "2026-11-25", day: "Wednesday", free: 50 }]);
    const ortho = availability(DOCTORS_KB.find((d) => d.id === "dr-prakash")!, NOW, {}); // Mon/Wed/Fri; today is Wednesday
    expect(ortho.slice(0, 3).map((a) => a.day)).toEqual(["Wednesday", "Friday", "Monday"]);
  });
  it("caller agreement", () => {
    for (const t of ["అవును confirm చేయండి", "Yes please", "Na peru Ramesh andi. November 22 ki okati confirm cheseyandi", "సరే పెట్టండి"]) expect(callerAgreed(t), t).toBe(true);
    for (const t of ["ఆ", "hmm", "fee ఎంత?", "వద్దు", "I'd like to know about the package and the booking process?"]) expect(callerAgreed(t), t).toBe(false);
    expect(callerAgreed("please book a cardiologist appointment on the 25th for Sarojini")).toBe(true);
  });
  it("first sentence for early speech; acknowledgements not doubled", () => {
    expect(firstSentence("మా దగ్గర Mr. Naveen గారు ఉన్నారు. Fee 250")).toBe("మా దగ్గర Mr. Naveen గారు ఉన్నారు.");
    expect(firstSentence("Dr. Viswanath గారు cardiologist")).toBeNull();
    expect(stripAck("హా అండి, మా దగ్గర physiotherapist ఉన్నారు.")).toBe("మా దగ్గర physiotherapist ఉన్నారు.");
    expect(stripAck("హా వినిపిస్తుంది అండి, చెప్పండి.")).toBe("వినిపిస్తుంది అండి, చెప్పండి.");
    expect(stripAck("Perfect అండి Ramesh గారు!")).toBe("Perfect అండి Ramesh గారు!");
  });
});

it("waits during partial callback digits and replaces them when the caller restarts", async () => {
  let state = await start("HSP-ALERT-3001");
  const m = model();
  const speak = async (text: string) => {
    const result = await agentTurn(state, text, false, { now: NOW, request: m.request });
    state = result.state;
    return result;
  };
  await speak("నేను ఇంకో number చెప్తాను");
  expect((await speak("789")).segments[0].text).toBe("");
  expect((await speak("640143")).outcome).toBeNull();
  await speak("Wrong number, let me tell you the number again");
  expect(state.agent?.callbackDigits).toBe("");
  await speak("7989");
  const full = await speak("Wrong number, that number was 9876543210");
  expect(full.segments[0].text).toContain("9, 8, 7, 6, 5, 4, 3, 2, 1, 0");
  expect(full.outcome).toBeNull();
  expect((await speak("Can you repeat it again?")).segments[0].text).toContain("9, 8, 7, 6, 5");
  const confirmed = await speak("Yes, that's correct");
  expect(confirmed.outcome?.kind).toBe("callback");
  expect(JSON.parse(confirmed.outcome!.detail!)).toEqual({ callbackNumber: "+919876543210" });
  expect(m.request).not.toHaveBeenCalled();
});
