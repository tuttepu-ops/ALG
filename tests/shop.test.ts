import { describe, expect, it, vi } from "vitest";
import { newSession } from "@/lib/workflow/engine";
import { runTurn } from "@/lib/turn";
import { orderSource } from "@/lib/orders/orders";
import { DEMO_ID, totals } from "@/lib/workflow/shop";

async function demo() {
  const order = (await orderSource.get(DEMO_ID))!;
  let state = newSession("demo-test", order).state;
  const llm = vi.fn(async () => { throw new Error("Clear turns must bypass OpenAI"); });
  return {
    llm,
    async say(text: string, interrupted = false) {
      const result = await runTurn({ state, order, text, interrupted }, llm);
      state = result.state;
      return { ...result, spoken: result.segments.map((segment) => segment.text).join(" ") };
    },
  };
}

describe("Godavari Basket demo", () => {
  it("clarifies repeated questions about why it is calling, without exposing order details", async () => {
    const call = await demo();
    const first = await call.say("ఏం మాట్లాడొచ్చు?");
    const second = await call.say("ఏం మాట్లాడొచ్చు?");
    expect(second.spoken).not.toBe(first.spoken);
    expect(second.spoken).not.toContain("ఆవకాయ");
    expect(second.state.stage).toBe("opening");
  });

  it("answers the exact Telugu-English catalogue request in the opening and while editing", async () => {
    const call = await demo();
    const opening = await call.say("ఆ మాట్లాడొచ్చండి మీ దగ్గర ఉన్న ఒకసారి మీ దగ్గర ఉన్న items list ఒకసారి పంపుతారా?");
    expect(opening.spoken).toContain("కాజా");
    const edit = await call.say("లేదండి ఇంకో 2 products యాడ్ చేద్దాం అనుకుంటున్నాను. మీ దగ్గర available-గా ఉన్న items ఒకసారి చూపిస్తారా?");
    expect(edit.spoken).toContain("packs add");
    expect(edit.outcome).toBeNull();
    expect(call.llm).not.toHaveBeenCalled();
  });

  it("browses during a pending change, updates totals, and confirms only after uninterrupted readback", async () => {
    const call = await demo();
    expect((await call.say("Yeah Hi")).outcome).toBeNull();
    await call.say("ఆ ఇంకో 2 products add చేయాలనుకుంటున్నాను. confirm చేయొద్దు.");
    const browse = await call.say("మీరు చెప్పిందే మళ్ళీ చెప్తున్నారు. products list చెప్పండి");
    expect(browse.spoken).toContain("కాజా");
    expect(browse.spoken).toContain("packs add");
    const update = await call.say("Add 1 × Kaja and 1 × Pootharekulu");
    expect(totals(update.state.shop!)).toEqual({ subtotal: 1030, grams: 1500, shipping: 60, total: 1090 });
    expect(update.outcome).toBeNull();
    const readback = await call.say("checkout");
    expect(readback.spoken).toContain("1090");
    expect(readback.spoken).toContain("533001");
    expect((await call.say("yes", true)).outcome).toBeNull();
    expect((await call.say("yes")).outcome?.kind).toBe("confirmed");
    expect((await call.say("yes")).outcome).toBeNull();
    expect(call.llm).not.toHaveBeenCalled();
  });

  it("keeps collecting an address after a product question and accepts a corrected PIN", async () => {
    const call = await demo();
    await call.say("చెప్పండి");
    await call.say("update my delivery address");
    await call.say("Ananya");
    await call.say("Flat 5B");
    const price = await call.say("What is the price of Kaja?");
    expect(price.spoken).toContain("220");
    expect(price.spoken).toContain("street and locality");
    await call.say("14 Sample Lane, Demo Colony");
    await call.say("Bengaluru");
    await call.say("Karnataka");
    await call.say("500081");
    await call.say("PIN 560001");
    const readback = await call.say("skip");
    expect(readback.spoken).toContain("560001");
    const accepted = await call.say("yes");
    expect(accepted.outcome).toBeNull();
    expect(totals(accepted.state.shop!).total).toBe(680);
  });

  it("does not add an out-of-stock product", async () => {
    const call = await demo();
    await call.say("yes");
    const result = await call.say("Add 1 Sunnundalu");
    expect(result.spoken).toContain("stock లేదు");
    expect(totals(result.state.shop!).subtotal).toBe(590);
  });

  it("protects order details with a wrong recipient and records do-not-call once", async () => {
    const call = await demo();
    const wrong = await call.say("Wrong person");
    expect(wrong.spoken).not.toContain("ఆవకాయ");
    expect((await call.say("yes")).state.stage).toBe("opening");
    expect((await call.say("Stop calling")).outcome?.kind).toBe("do_not_call");
    expect((await call.say("Stop calling")).outcome).toBeNull();
  });
});

it("answers product and policy questions from demo knowledge without calling OpenAI", async () => {
  const call = await demo();
  await call.say("చెప్పండి");
  expect((await call.say("What is Avakaya made with?")).spoken).toContain("మామిడికాయ");
  expect((await call.say("Is Pootharekulu dairy-free?")).spoken).toContain("verify");
  expect((await call.say("What is the shelf life of Kaja?")).spoken).toContain("best-before");
  expect((await call.say("Can I track my order?")).spoken).toContain("live tracking");
  expect((await call.say("Do you ship outside India?")).spoken).toContain("PIN");
  expect(call.llm).not.toHaveBeenCalled();
});

it("recommends a relevant item and adds it only after the caller agrees", async () => {
  const call = await demo();
  await call.say("చెప్పండి");
  const offer = await call.say("Can you recommend a sweet?");
  expect(offer.spoken).toContain("పూతరేకులు");
  expect(totals(offer.state.shop!).subtotal).toBe(590);
  const accepted = await call.say("yes");
  expect(totals(accepted.state.shop!).subtotal).toBe(810);
  expect(accepted.outcome).toBeNull();
  expect(call.llm).not.toHaveBeenCalled();
});

it("responds to a shopping request in the opening without repeating the permission prompt", async () => {
  const call = await demo();
  const opening = await call.say("యా నేను cart-లో ఇంకో items add చేద్దాం అనుకుంటున్నాను మీ దగ్గర ఏ item బాగుంటుందండి");
  expect(opening.spoken).toContain("మీకు ఏది ఇష్టం");
  const offer = await call.say("నాకు 1 sweet కావాలి ఏది బాగుంటుంది?");
  expect(offer.spoken).toContain("పూతరేకులు");
  expect(offer.spoken).toContain("రూపాయలు");
  expect(offer.outcome).toBeNull();
  expect(call.llm).not.toHaveBeenCalled();
});
