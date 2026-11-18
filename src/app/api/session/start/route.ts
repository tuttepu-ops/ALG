import { randomUUID } from "node:crypto";
import { checkPilot } from "@/lib/auth";
import { getConfig, resolveVoice } from "@/lib/config";
import { ACKS } from "@/lib/agent/hospitalAgent";
import { isHospitalCall } from "@/lib/workflow/hospital";
import { orderSource, orderTotal } from "@/lib/orders/orders";
import { planAudio } from "@/lib/providers/ttsCache";
import { signState } from "@/lib/session";
import { getStore } from "@/lib/storage/store";
import { newSession } from "@/lib/workflow/engine";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = checkPilot(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { orderId?: string; voice?: { speaker?: string; pace?: number } };
  const order = body.orderId ? await orderSource.get(body.orderId) : null;
  if (!order) return Response.json({ error: "Unknown order" }, { status: 404 });
  const optOut = (await getStore().listOutcomes()).some((outcome) => outcome.orderId === order.id && outcome.kind === "do_not_call");
  if (optOut) return Response.json({ error: "This customer opted out of further calls." }, { status: 409 });
  const voice = resolveVoice(body.voice);
  const { state, segments } = newSession(`s_${randomUUID()}`, order);
  return Response.json({
    token: signState(state),
    sessionId: state.sessionId,
    stage: state.stage,
    order: { ...order, total: orderTotal(order) },
    voice,
    reply: { segments: planAudio(segments, voice) },
    // Hospital AI calls: acknowledgements to pre-load (played the instant the caller stops talking).
    acks: isHospitalCall(order.id) && getConfig().hospitalEngine === "ai"
      ? { te: planAudio(ACKS.te.map((text) => ({ text, cacheable: true })), voice), en: planAudio(ACKS.en.map((text) => ({ text, cacheable: true })), voice) }
      : null,
  });
}
