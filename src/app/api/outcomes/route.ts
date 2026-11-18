import { checkPilot } from "@/lib/auth";
import { getStore } from "@/lib/storage/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = checkPilot(req);
  if (denied) return denied;
  const store = getStore();
  const [outcomes, reports] = await Promise.all([store.listOutcomes(), store.listReports()]);
  return Response.json({ storage: store.kind, outcomes, reports: reports.slice(0, 50) });
}
