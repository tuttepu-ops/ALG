import { randomUUID } from "node:crypto";
import { checkPilot } from "@/lib/auth";
import { phoneUrl } from "@/lib/alg-phone";
import { putAlgCall, updateAlgCall } from "@/lib/storage/alg";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = checkPilot(req);
  if (denied) return denied;
  const to = ((await req.json().catch(() => null)) as { to?: unknown } | null)?.to;
  const { ALG_PUBLIC_URL: origin, ALG_TEST_NUMBERS: allowed, VOBIZ_AUTH_ID: account, VOBIZ_AUTH_TOKEN: token, VOBIZ_FROM: from } = process.env;
  if (typeof to !== "string" || !/^\+91\d{10}$/.test(to) || !allowed?.split(",").map((n) => n.trim()).includes(to)) {
    return Response.json({ error: "Enter an approved +91 test number." }, { status: 400 });
  }
  if (!origin || !account || !token || !from || !process.env.OPENAI_API_KEY || !process.env.SARVAM_API_KEY) {
    return Response.json({ error: "Live phone testing has not been configured." }, { status: 503 });
  }
  const id = `${Date.now()}-${randomUUID()}`;
  try {
    const answer = phoneUrl(origin, "/api/alg/answer", id);
    const hangup = phoneUrl(origin, "/api/alg/hangup", id);
    await putAlgCall({ id, channel: "phone", status: "Dialing", destination: `+91 ••••••${to.slice(-4)}` });
    const result = await fetch(`https://api.vobiz.ai/api/v1/Account/${encodeURIComponent(account)}/Call/`, {
      method: "POST",
      headers: { "X-Auth-ID": account, "X-Auth-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, answer_url: answer.href, answer_method: "POST", hangup_url: hangup.href, hangup_method: "POST" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) {
      await updateAlgCall(id, { status: "Failed" });
      return Response.json({ error: `Vobiz rejected the call (HTTP ${result.status}).` }, { status: 502 });
    }
    return Response.json({ id, status: "Dialing" });
  } catch {
    await updateAlgCall(id, { status: "Check provider" }).catch(() => {});
    return Response.json({ error: "Could not confirm the call. Check Vobiz logs before retrying." }, { status: 502 });
  }
}
