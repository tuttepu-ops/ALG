import { phoneCallId } from "@/lib/alg-phone";
import { updateAlgCall } from "@/lib/storage/alg";

export async function POST(req: Request) {
  const id = phoneCallId(new URL(req.url));
  if (!id) return new Response(null, { status: 403 });
  const raw = await req.text();
  let status = new URLSearchParams(raw).get("CallStatus") ?? "";
  if (req.headers.get("content-type")?.includes("application/json")) {
    try { status = String(JSON.parse(raw).CallStatus ?? JSON.parse(raw).call_status ?? ""); } catch {}
  }
  const finish = status.toLowerCase().replaceAll("_", "-");
  const labels: Record<string, string> = { "no-answer": "No answer", busy: "Busy", failed: "Failed", canceled: "Cancelled", completed: "Completed" };
  await updateAlgCall(id, { status: labels[finish] ?? "Ended" });
  return new Response(null, { status: 204 });
}
