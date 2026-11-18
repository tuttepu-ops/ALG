import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interpretWithLlm, buildRequestBody, INSTRUCTIONS } from "@/lib/providers/openai";
import { runTurn } from "@/lib/turn";
import { newSession } from "@/lib/workflow/engine";
import { SampleOrderSource } from "@/lib/orders/orders";
import { MemoryStore } from "@/lib/storage/store";
import { encode } from "gpt-tokenizer/model/gpt-4o";

const okBody = (i: string, d: string | null = null) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ i, d }) }] }],
  usage: { input_tokens: 318, output_tokens: 11, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
});
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const quota429 = () =>
  json(429, { error: { message: "You have no credits remaining.", type: "insufficient_quota", code: "credit_balance_exhausted" } });
const rate429 = (retryAfter = "1") =>
  json(429, { error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } }, { "retry-after": retryAfter });

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAI request is small", () => {
  it("sends only stage, pending detail and the utterance", () => {
    const b = buildRequestBody("change_readback", "inko box kuda", "కాజా తీసేయాలి");
    expect(b.input).toBe("stage: change_readback\npending: కాజా తీసేయాలి\nreply: inko box kuda");
    expect(JSON.stringify(b)).not.toMatch(/GB-1042|640|ఆరు వందల/); // no order id/total anywhere
    expect(b.input).not.toMatch(/పూతరేకులు|Lakshmi|order/); // per-call input: no order data or transcript
    expect(b.reasoning).toEqual({ effort: "none" });
    expect(b.max_output_tokens).toBe(60);
    expect(b.store).toBe(false);
  });
  it("instruction stays compact", () => {
    const tokens = encode(INSTRUCTIONS).length;
    expect(tokens).toBeLessThan(380);
  });
});

describe("429 handling", () => {
  it("insufficient quota: no retry, quota error", async () => {
    const f = vi.fn().mockResolvedValue(quota429());
    const r = await interpretWithLlm("confirm", "kaja vaddu", null, f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.interp).toBeNull();
    expect(r.diag.error?.kind).toBe("quota");
    expect(r.diag.error?.summary).toMatch(/billing\/quota/);
    expect(r.diag.retried).toBe(false);
  });

  it("temporary rate limit: one retry after Retry-After, then success", async () => {
    const f = vi.fn().mockResolvedValueOnce(rate429("1")).mockResolvedValueOnce(json(200, okBody("change", "కాజా తీసేయాలి")));
    const t0 = Date.now();
    const r = await interpretWithLlm("confirm", "kaja vaddu", null, f);
    expect(f).toHaveBeenCalledTimes(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(990);
    expect(r.diag.retried).toBe(true);
    expect(r.diag.ok).toBe(true);
    expect(r.interp?.intent).toBe("change");
  });

  it("rate limit twice: gives up after one retry", async () => {
    const f = vi.fn().mockResolvedValue(rate429("0"));
    const r = await interpretWithLlm("confirm", "kaja vaddu", null, f);
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.diag.error?.kind).toBe("rate_limit");
  });

  it("long Retry-After: no retry inside a live turn", async () => {
    const f = vi.fn().mockResolvedValue(rate429("20"));
    const r = await interpretWithLlm("confirm", "kaja vaddu", null, f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.diag.error?.kind).toBe("rate_limit");
    expect(r.diag.error?.retryAfterMs).toBe(20000);
  });

  it("missing key is reported, never treated as success", async () => {
    delete process.env.OPENAI_API_KEY;
    const f = vi.fn();
    const r = await interpretWithLlm("confirm", "x", null, f);
    expect(f).not.toHaveBeenCalled();
    expect(r.diag.ok).toBe(false);
    expect(r.diag.error?.kind).toBe("not_configured");
  });

  it("truncated output (max_output_tokens) is a failure", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }));
    const r = await interpretWithLlm("confirm", "x", null, f);
    expect(r.diag.error?.kind).toBe("bad_output");
  });
});

describe("turn routing", () => {
  const orders = new SampleOrderSource();

  it("clear replies never call the LLM", async () => {
    const order = (await orders.get("GB-1042"))!;
    let { state } = newSession("s1", order);
    const llm = vi.fn();
    for (const text of ["hi andi", "ha matladochu", "why?", "yes, confirm it"]) {
      const r = await runTurn({ state, order, text }, llm);
      expect(r.diag.route).toBe("workflow");
      state = r.state;
    }
    expect(llm).not.toHaveBeenCalled();
    expect(state.outcome).toBe("confirmed");
  });

  it("provider failure keeps stage and pending detail, offers manual options, records nothing", async () => {
    const order = (await orders.get("GB-1042"))!;
    let { state } = newSession("s2", order);
    state = (await runTurn({ state, order, text: "ha" })).state;
    expect(state.stage).toBe("confirm");
    const failing = vi.fn().mockResolvedValue({ interp: null, diag: { called: true, ok: false, error: { kind: "quota", summary: "quota" } } });
    const r = await runTurn({ state, order, text: "kaja vaddu andi, pootharekulu inko box add cheyyandi" }, failing);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(r.diag.route).toBe("openai_failed");
    expect(r.state.stage).toBe("confirm");
    expect(r.state.unclearStreak).toBe(0);
    expect(r.outcome).toBeNull();
    expect(r.diag.manualOptions).toContain("yes, confirm it");
    // Manual option is understood without the LLM and completes the call.
    const r2 = await runTurn({ state: r.state, order, text: "yes, confirm it" }, failing);
    expect(r2.diag.route).toBe("workflow");
    expect(r2.outcome?.kind).toBe("confirmed");
  });

  it("change request: one LLM call extracts detail, read back, yes records once", async () => {
    const order = (await orders.get("GB-1042"))!;
    let { state } = newSession("s3", order);
    state = (await runTurn({ state, order, text: "ha cheppandi" })).state;
    const llm = vi.fn().mockResolvedValue({
      interp: { intent: "change", detail: "కాజా తీసేయాలి, పూతరేకులు ఇంకో box", source: "openai" },
      diag: { called: true, ok: true, usage: { inputTokens: 320, outputTokens: 18 } },
    });
    const r = await runTurn({ state, order, text: "kaja vaddu andi, pootharekulu inko box add cheyyandi" }, llm);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(r.state.stage).toBe("change_readback");
    expect(r.segments[0].text).toContain("కాజా తీసేయాలి, పూతరేకులు ఇంకో box");
    expect(r.segments[0].cacheable).toBe(false);
    const r2 = await runTurn({ state: r.state, order, text: "avunu" }, llm);
    expect(llm).toHaveBeenCalledTimes(1); // the "yes" was handled in code
    expect(r2.outcome).toMatchObject({ kind: "change_request", detail: "కాజా తీసేయాలి, పూతరేకులు ఇంకో box" });
  });
});

describe("outcome store", () => {
  it("records each session's outcome only once", async () => {
    const s = new MemoryStore();
    const o = { sessionId: "x", orderId: "GB-1042", kind: "confirmed" as const, detail: null, callbackTime: null, customerWords: "yes", route: "workflow" as const, turn: 4, recordedAt: new Date().toISOString() };
    expect((await s.recordOutcome(o)).stored).toBe(true);
    expect((await s.recordOutcome({ ...o, kind: "callback" })).stored).toBe(false);
    expect(await s.listOutcomes()).toHaveLength(1);
  });
});
