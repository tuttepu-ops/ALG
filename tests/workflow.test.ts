import { describe, expect, it } from "vitest";
import { matchClear, isNeedsLlm } from "@/lib/workflow/matcher";
import { newSession, step } from "@/lib/workflow/engine";
import { SampleOrderSource } from "@/lib/orders/orders";
import { rupeesInTelugu, teluguNumber } from "@/lib/telugu/numbers";
import { extractTime } from "@/lib/workflow/time";
import { segmentsText, orderReadout } from "@/lib/workflow/templates";
import type { Interpretation, Outcome, SessionState } from "@/lib/workflow/types";

const orders = new SampleOrderSource();

describe("Telugu numbers", () => {
  it.each([
    [640, "ఆరు వందల నలభై రూపాయలు"],
    [590, "ఐదు వందల తొంభై రూపాయలు"],
    [1080, "వెయ్యి ఎనభై రూపాయలు"],
    [100, "వంద రూపాయలు"],
    [140, "నూట నలభై రూపాయలు"],
    [600, "ఆరు వందల రూపాయలు"],
    [2000, "రెండు వేల రూపాయలు"],
    [12500, "పన్నెండు వేల ఐదు వందల రూపాయలు"],
    [1, "ఒక్క రూపాయి"],
  ])("%i → %s", (n, words) => expect(rupeesInTelugu(n)).toBe(words));
  it("plain numbers", () => {
    expect(teluguNumber(600)).toBe("ఆరు వందలు");
    expect(teluguNumber(2000)).toBe("రెండు వేలు");
  });
});

describe("GB-1042 readout matches the brief", () => {
  it("reads real items and total", async () => {
    const o = (await orders.get("GB-1042"))!;
    expect(orderReadout(o).text).toBe("మీ order‌లో పూతరేకులు, కాజా ఉన్నాయి. మొత్తం ఆరు వందల నలభై రూపాయలు. Confirm చేయనా?");
  });
});

describe("matcher — clear replies handled in code", () => {
  const cases: Array<[string, string, string]> = [
    ["opening", "hi andi", "greet"],
    ["opening", "Hello", "greet"],
    ["opening", "హలో", "greet"],
    ["opening", "ha matladochu", "permit"],
    ["opening", "ఆ మాట్లాడండి", "permit"],
    ["opening", "చెప్పండి", "permit"],
    ["opening", "హా చెప్పండి అండి", "permit"],
    ["opening", "yes confirm it", "permit"], // permission only, never a confirmation here
    ["opening", "why?", "why"],
    ["opening", "దేని గురించి మాట్లాడుతున్నారు?", "why"],
    ["opening", "ఆ మాట్లాడు చెప్పండి దేని గురించి కాల్ చేశారు", "permit_why"],
    ["opening", "ఎవరు మాట్లాడేది?", "who"],
    ["opening", "కాల్ బ్యాక్", "callback"],
    ["opening", "busy ga unna, later call cheyandi", "callback"],
    ["opening", "ఒక్క నిమిషం", "hold"],
    ["confirm", "why?", "why"],
    ["confirm", "yes, confirm it", "confirm"],
    ["confirm", "అవును confirm చేయండి", "confirm"],
    ["confirm", "హా సరే", "confirm"],
    ["confirm", "ok andi", "confirm"],
    ["confirm", "ha cheppandi", "repeat"], // "go on" is not agreement
    ["confirm", "total entha?", "q_total"],
    ["confirm", "మళ్ళీ చెప్పండి", "repeat"],
    ["confirm", "వద్దు", "no"],
    ["confirm", "cancel cheyandi", "cancel"],
    ["confirm", "order lo change undi", "change_bare"],
    ["confirm", "కాల్ బ్యాక్", "callback"],
    ["confirm", "delivery eppudu vastundi?", "q_delivery"],
    ["change_readback", "avunu", "yes"],
    ["change_readback", "kaadu", "no"],
    ["cancel_readback", "ha cheyandi", "yes"],
    ["callback_time", "సాయంత్రం 6 గంటలకి", "time"],
    ["callback_time", "repu evening", "time"],
    ["callback_time", "telidu andi", "unclear-llm"], // unknown spelling → LLM
    ["callback_time", "తెలీదు", "no_time"],
    ["callback_time", "bye", "end"],
  ];
  it.each(cases)("[%s] %s → %s", (stage, text, want) => {
    const r = matchClear(stage as never, text);
    if (want === "unclear-llm") expect(isNeedsLlm(r)).toBe(true);
    else {
      expect(isNeedsLlm(r), JSON.stringify(r)).toBe(false);
      expect((r as Interpretation).intent).toBe(want);
    }
  });

  it.each([
    ["confirm", "kaja vaddu andi, pootharekulu inko box add cheyyandi"],
    ["confirm", "yes but address change cheyali"],
    ["confirm", "ఇంకో అర కిలో కాజా కావాలి"],
    ["change_details", "kaja teeseyandi"],
    ["opening", "nenu ippudu bus lo unna, signal sarigga ledu"],
  ])("[%s] %s → needs LLM", (stage, text) => {
    expect(isNeedsLlm(matchClear(stage as never, text))).toBe(true);
  });
});

describe("time extraction", () => {
  it.each([
    ["సాయంత్రం 6 గంటలకి", "సాయంత్రం ఆరు గంటలకి"],
    ["repu evening", "రేపు సాయంత్రం"],
    ["6pm", "సాయంత్రం ఆరు గంటలకి"],
    ["రేపు ఉదయం పది గంటలకి", "రేపు ఉదయం పది గంటలకి"],
    ["half an hour tarvata", "అరగంట తర్వాత"],
    ["after 2 hours", "రెండు గంటల తర్వాత"],
  ])("%s → %s", (raw, spoken) => expect(extractTime(raw)?.spoken).toBe(spoken));
  it("no time", () => expect(extractTime("ok andi")).toBeNull());
});

// ---- Full conversations through the engine using only the workflow ----

async function run(orderId: string, lines: Array<string | { text: string; interrupted?: boolean }>) {
  const order = (await orders.get(orderId))!;
  let { state } = newSession("s-test", order);
  const outcomes: Outcome[] = [];
  const replies: string[] = [];
  for (const l of lines) {
    const { text, interrupted } = typeof l === "string" ? { text: l, interrupted: false } : l;
    const m = matchClear(state.stage, text);
    const interp: Interpretation = isNeedsLlm(m) ? { intent: "unclear", source: "workflow" } : m;
    const r = step(state, order, interp, { text, interrupted });
    state = r.state;
    if (r.outcome) outcomes.push(r.outcome);
    replies.push(segmentsText(r.segments));
  }
  return { state: state as SessionState, outcomes, replies };
}

describe("conversation paths (workflow only, no LLM)", () => {
  it("hi andi → ha matladochu → why? → yes, confirm it", async () => {
    const r = await run("GB-1042", ["hi andi", "ha matladochu", "why?", "yes, confirm it"]);
    expect(r.replies[0]).toContain("confirm చేయడానికి call చేశాను");
    expect(r.replies[0]).not.toContain("voice assistant"); // no full greeting replay
    expect(r.replies[1]).toContain("ఆరు వందల నలభై రూపాయలు");
    expect(r.replies[2]).toContain("Confirm చేయనా?");
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0].kind).toBe("confirmed");
    expect(r.state.stage).toBe("closed");
  });

  it("permission is never repeated after it was granted", async () => {
    const r = await run("GB-1042", ["ఆ మాట్లాడండి", "why?"]);
    expect(r.replies[1]).not.toContain("మాట్లాడొచ్చా");
  });

  it("permission + question answered in one turn", async () => {
    const r = await run("GB-1042", ["ఆ మాట్లాడు చెప్పండి దేని గురించి కాల్ చేశారు"]);
    expect(r.replies[0]).toContain("confirm చేయడానికే call చేశాను");
    expect(r.replies[0]).toContain("పూతరేకులు, కాజా");
    expect(r.state.stage).toBe("confirm");
  });

  it("yes in opening only grants permission", async () => {
    const r = await run("GB-1042", ["yes, confirm it"]);
    expect(r.outcomes).toHaveLength(0);
    expect(r.state.stage).toBe("confirm");
  });

  it("కాల్ బ్యాక్ → asks time → saves time once", async () => {
    const r = await run("GB-1042", ["కాల్ బ్యాక్", "రేపు సాయంత్రం 6 గంటలకి"]);
    expect(r.replies[0]).toContain("ఏ time లో call చేస్తే");
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]).toMatchObject({ kind: "callback", callbackTime: "రేపు సాయంత్రం 6 గంటలకి" });
    expect(r.replies[1]).toContain("రేపు సాయంత్రం ఆరు గంటలకి");
  });

  it("busy and wants to end now → callback saved without time", async () => {
    const r = await run("GB-1042", ["busy, bye"]);
    expect(r.outcomes).toEqual([expect.objectContaining({ kind: "callback", callbackTime: null })]);
    expect(r.state.stage).toBe("closed");
  });

  it("cancel → read back → yes records cancel request once", async () => {
    const r = await run("GB-1043", ["ha cheppandi", "cancel cheyandi", "avunu", "ok"]);
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0].kind).toBe("cancel_request");
    expect(r.replies[3]).toContain("save అయ్యింది");
  });

  it("interruption: total question mid-readout, then confirm", async () => {
    const r = await run("GB-1044", ["ha", { text: "total entha?", interrupted: true }, "ok confirm"]);
    expect(r.replies[1]).toContain("వెయ్యి ఎనభై రూపాయలు");
    expect(r.outcomes.map((o) => o.kind)).toEqual(["confirmed"]);
  });

  it("interruption: 'yes' spoken over the readout does not confirm", async () => {
    const r = await run("GB-1042", ["ha", { text: "yes", interrupted: true }, "yes"]);
    expect(r.replies[1]).toContain("పూర్తిగా చెప్తాను");
    expect(r.outcomes.map((o) => o.kind)).toEqual(["confirmed"]);
    expect(r.outcomes[0].turn).toBe(3);
  });

  it("two unclear replies → pending for staff", async () => {
    const r = await run("GB-1042", ["ha", "blah blah random noise words here", "more random noise words here"]);
    expect(r.replies[1]).toContain("క్షమించండి");
    expect(r.outcomes.map((o) => o.kind)).toEqual(["pending_staff"]);
  });

  it("closed session never records again", async () => {
    const r = await run("GB-1042", ["ha", "yes", "yes", "cancel", "కాల్ బ్యాక్"]);
    expect(r.outcomes).toHaveLength(1);
  });
});

describe("read-back text is Telugu script for known words", () => {
  it("converts product names and common Romanized words", async () => {
    const { teluguize } = await import("@/lib/workflow/engine");
    expect(teluguize("Kaja vaddu, pootharekulu inko box add cheyyandi")).toBe("కాజా వద్దు, పూతరేకులు ఇంకో box add చేయండి");
    expect(teluguize("avakaya cancel, gongura matrame pampandi")).toBe("ఆవకాయ cancel, గోంగూర మాత్రమే పంపండి");
  });
});
