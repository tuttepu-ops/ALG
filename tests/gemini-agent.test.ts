import { afterEach, expect, it, vi } from "vitest";
import { agentTurn } from "@/lib/agent/hospitalAgent";
import { SampleOrderSource } from "@/lib/orders/orders";
import { GEMINI_MODEL, geminiAgentRequest } from "@/lib/providers/gemini";
import { newSession } from "@/lib/workflow/engine";

afterEach(() => vi.unstubAllEnvs());

it("preserves Gemini tool signatures and requires confirmation after correcting a date", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const order = (await new SampleOrderSource().get("HSP-INBOUND"))!;
  let state = newSession("test-gemini", order).state;
  const now = new Date("2026-11-18T09:00:00Z");
  const run = async (text: string, date: string) => {
    const toolPart = { functionCall: { name: "book_appointment", args: { doctor_id: "dr-viswanath", date, patient_name: "Ramesh" } }, thoughtSignature: "example-signature" };
    const providerResult = (parts: object[]) => Response.json({ candidates: [{ content: { role: "model", parts } }] });
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(providerResult([toolPart]))
      .mockResolvedValueOnce(providerResult([{ text: `Ramesh గారు, ${date} test appointment.` }]));
    const reply = await agentTurn(state, text, false, { now, modelOverride: GEMINI_MODEL, request: geminiAgentRequest(fetcher) });
    state = reply.state;
    expect(fetcher.mock.calls[0][0]).toContain("gemini-3.1-flash-lite:generateContent");
    const continuation = JSON.parse(String(fetcher.mock.calls[1][1]?.body)).contents;
    expect(continuation.at(-2).parts).toEqual([toolPart]);
    return { reply, result: continuation.at(-1).parts[0].functionResponse.response.result };
  };
  const proposed = await run("November 22 ki Ramesh", "2026-11-22");
  expect(proposed.result.needs_confirmation).toBe(true);
  expect(proposed.reply.outcome).toBeNull();
  const corrected = await run("Actually, 25th కావాలి", "2026-11-25");
  expect(corrected.result.needs_confirmation).toBe(true);
  expect(corrected.reply.outcome).toBeNull();
  const confirmed = await run("అవును", "2026-11-25");
  expect(confirmed.result.test_booking.date).toBe("2026-11-25");
  expect(confirmed.reply.outcome?.kind).toBe("appointment_booked");
});
