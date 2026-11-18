import { checkPilot } from "@/lib/auth";
import { sarvamStt } from "@/lib/providers/sarvam";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Receives one complete utterance (never partials) and returns Sarvam's transcript.
export async function POST(req: Request) {
  const denied = checkPilot(req);
  if (denied) return denied;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return Response.json({ error: "audio file required" }, { status: 400 });
  if (file.size > 4_000_000) return Response.json({ error: "audio too large" }, { status: 413 });
  const name = (file as File).name || (file.type.includes("mp4") ? "utterance.m4a" : "utterance.webm");
  const r = await sarvamStt(file, name);
  return Response.json(
    {
      ok: r.ok,
      transcript: r.transcript,
      languageCode: r.languageCode,
      provider: "Sarvam",
      model: r.model,
      mode: r.mode,
      latencyMs: r.latencyMs,
      retried: r.retried,
      requestId: r.requestId,
      error: r.error ? { summary: r.error.summary, kind: r.error.kind, status: r.error.status, code: r.error.code } : null,
    },
    { status: r.ok ? 200 : 502 },
  );
}
