import { checkPilot } from "@/lib/auth";
import { getStore } from "@/lib/storage/store";

export const dynamic = "force-dynamic";

// Every call as one CSV row: what happened, who, which language, what they booked or asked,
// and the transcript. Open in Excel / Google Sheets. GET /api/calls?code=<pilot code>
export async function GET(req: Request) {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  if (url.searchParams.get("code")) headers.set("x-pilot-code", url.searchParams.get("code")!);
  const denied = checkPilot(new Request(req.url, { headers }));
  if (denied) return denied;
  const store = getStore();
  const [outcomes, reports] = await Promise.all([store.listOutcomes(), store.listReports()]);
  const bySession = new Map(reports.map((r) => [r.sessionId, r]));
  const cols = ["time", "call_id", "direction", "phone", "name", "language", "outcome", "booked_date", "callback_time", "questions_for_reception", "detail", "turns", "transcript"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = outcomes.map((o) => {
    const m = (o.meta ?? {}) as Record<string, unknown>;
    const r = bySession.get(o.sessionId);
    const transcript = (r?.turns ?? []).map((t) => `${t.who === "agent" ? "Agent" : "Caller"}: ${t.text}`).join("\n");
    return [o.recordedAt, o.orderId, m.direction ?? "", m.phone ?? "", m.name ?? "", m.language ?? "", o.kind, m.date ?? "", o.callbackTime ?? "",
      Array.isArray(m.questionsForReception) ? (m.questionsForReception as string[]).join("; ") : "", o.detail ?? "", o.turn, transcript].map(esc).join(",");
  });
  return new Response([cols.join(","), ...rows].join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="calls-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
