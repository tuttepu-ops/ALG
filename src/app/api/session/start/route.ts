import { randomUUID } from "node:crypto";
import { checkPilot } from "@/lib/auth";
import { resolveVoice } from "@/lib/config";
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
  const body = (await req.json().catch(() => ({}))) as { agent?: string; orderId?: string; voice?: { speaker?: string; pace?: number } };
  const order = body.orderId ? await orderSource.get(body.orderId) : null;
  if (!order) return Response.json({ error: "Unknown order" }, { status: 404 });
  const optOut = (await getStore().listOutcomes()).some((outcome) => outcome.orderId === order.id && outcome.kind === "do_not_call");
  if (optOut) return Response.json({ error: "This customer opted out of further calls." }, { status: 409 });
  if (body.agent === "gemini" && (!process.env.GEMINI_API_KEY || !isHospitalCall(order.id))) {
    return Response.json({ error: "Gemini testing requires a hospital scenario and GEMINI_API_KEY." }, { status: 503 });
  }
  const voice = resolveVoice(body.voice);
  const { state, segments } = newSession(`s_${randomUUID()}`, order);
  if (body.agent === "gemini") state.agentProvider = "gemini";
  return Response.json({
    token: signState(state),
    sessionId: state.sessionId,
    stage: state.stage,
    order: { ...order, total: orderTotal(order) },
    voice,
    reply: { segments: planAudio(segments, voice) },
    acks: null,
  });
}
