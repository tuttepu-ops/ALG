import { algStorageReady, putAlgCall } from "@/lib/storage/alg";
import { checkPilot } from "@/lib/auth";
import { getStore, type SessionReport } from "@/lib/storage/store";
import { verifyState } from "@/lib/session";

export const dynamic = "force-dynamic";

// The browser posts the session's measured usage when a session ends.
export async function POST(req: Request) {
  const denied = checkPilot(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as (Omit<SessionReport, "savedAt" | "sessionId" | "orderId" | "outcome"> & { token?: string }) | null;
  const state = verifyState(body?.token);
  if (!body || !state) return Response.json({ error: "Invalid session" }, { status: 400 });
  const report: SessionReport = {
    sessionId: state.sessionId,
    orderId: state.orderId,
    outcome: state.outcome,
    usage: body.usage,
    costInr: Number(body.costInr) || 0,
    turns: Array.isArray(body.turns) ? body.turns.slice(0, 80) : [],
    savedAt: new Date().toISOString(),
  };
  if (algStorageReady()) await putAlgCall({
    id: report.sessionId, channel: "browser", status: "Completed",
    started_at: report.savedAt, seconds: Number(report.usage?.sessionSeconds) || 0,
    cost_inr: report.costInr, outcome: report.outcome, transcript: report.turns.map(({ who, text }) => ({ who, text })),
  });
  await getStore().saveReport(report);
  return Response.json({ ok: true });
}
