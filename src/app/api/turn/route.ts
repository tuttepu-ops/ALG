import { checkPilot } from "@/lib/auth";
import { resolveVoice } from "@/lib/config";
import { orderSource } from "@/lib/orders/orders";
import { planAudio } from "@/lib/providers/ttsCache";
import { signState, verifyState } from "@/lib/session";
import { getStore } from "@/lib/storage/store";
import { runTurn } from "@/lib/turn";
import { doctorFor } from "@/lib/hospital/data";
import { findPatientCall, takenSlots } from "@/lib/workflow/hospital";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Duplicate-submission guard: same turnId → same response, no second LLM call or outcome.
const seen = new Map<string, unknown>();
const remember = (id: string, v: unknown) => {
  seen.set(id, v);
  if (seen.size > 500) seen.delete(seen.keys().next().value as string);
};

export async function POST(req: Request) {
  const denied = checkPilot(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as {
    token?: string; text?: string; turnId?: string; interrupted?: boolean; voice?: { speaker?: string; pace?: number }; stream?: boolean; ackPlayed?: string;
  } | null;
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });
  const state = verifyState(body.token);
  if (!state) return Response.json({ error: "Invalid or expired session token" }, { status: 400 });
  const turnId = typeof body.turnId === "string" ? `${state.sessionId}:${body.turnId}` : null;
  if (turnId && seen.has(turnId)) return Response.json({ ...(seen.get(turnId) as object), duplicate: true });

  const text = String(body.text ?? "").slice(0, 3000);
  const order = await orderSource.get(state.orderId);
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });

  // Hospital: slots booked by other calls count against capacity.
  const patient = findPatientCall(order.id);
  const taken = patient ? takenSlots(await getStore().listOutcomes(), doctorFor(patient)) : undefined;
  // AI agent: capacity per doctor and date from all recorded bookings.
  const agentTaken: Record<string, number> = {};
  if (patient) for (const o of await getStore().listOutcomes()) {
    for (const b of ((o.meta?.bookings as { doctorId: string; date: string }[] | undefined) ?? [])) agentTaken[`${b.doctorId}|${b.date}`] = (agentTaken[`${b.doctorId}|${b.date}`] ?? 0) + 1;
  }
  const voice = resolveVoice(body.voice);
  const finish = async (result: Awaited<ReturnType<typeof runTurn>>, spokenFirst: string | null) => {
    let outcomeStored: boolean | null = null;
    if (result.outcome) outcomeStored = (await getStore().recordOutcome(result.outcome)).stored;
    // When the first sentence was already sent (streaming), the reply segments are only the rest.
    const full = result.segments.map((s) => s.text).join(" ");
    const rest = spokenFirst && full.startsWith(spokenFirst) ? full.slice(spokenFirst.length).trim() : spokenFirst ? full : null;
    const segments = rest === null ? result.segments : rest ? [{ text: rest, cacheable: false }] : [];
    const payload = {
      token: signState(result.state),
      stage: result.state.stage,
      turn: result.state.turn,
      unclearStreak: result.state.unclearStreak,
      pendingDetail: result.state.pendingDetail,
      sessionOutcome: result.state.outcome,
      reply: { segments: planAudio(segments, voice), fullText: full, firstSent: spokenFirst },
      outcome: result.outcome,
      outcomeStored,
      diag: result.diag,
    };
    if (turnId) remember(turnId, payload);
    return payload;
  };

  // Streaming (AI hospital agent): one NDJSON line with the first sentence as soon as it is written,
  // so the browser starts the voice while the model is still writing; then the final line.
  if (body.stream && patient) {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        let first: string | null = null;
        const write = (o: unknown) => ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
        try {
          const ack = typeof body.ackPlayed === "string" ? body.ackPlayed.slice(0, 40) : null;
          const result = await runTurn({ state, order, text, interrupted: !!body.interrupted, taken, agentTaken, ackPlayed: ack, onFirst: (f) => {
            first = f;
            write({ type: "first", segment: planAudio([{ text: f, cacheable: false }], voice)[0] });
          } });
          write({ type: "final", ...(await finish(result, first)) });
        } catch (e) {
          write({ type: "error", error: String((e as Error).message ?? e) });
        }
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const result = await runTurn({ state, order, text, interrupted: !!body.interrupted, taken, agentTaken });
  return Response.json(await finish(result, null));
}
