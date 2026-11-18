import { checkPilot } from "@/lib/auth";
import { getConfig, resolveVoice } from "@/lib/config";
import { sarvamTts, ttsKey } from "@/lib/providers/sarvam";
import { getCached, putCached } from "@/lib/providers/ttsCache";
import { toSpeech } from "@/lib/telugu/speech";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const denied = checkPilot(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { text?: string; voice?: { speaker?: string; pace?: number } } | null;
  const text = toSpeech(String(body?.text ?? "").trim(), getConfig().englishAs, getConfig().numbersAs);
  if (!text || text.length > 600) return Response.json({ error: "text required (max 600 chars)" }, { status: 400 });
  const cfg = getConfig();
  const voice = resolveVoice(body?.voice);
  const key = ttsKey(text, voice, cfg.ttsSampleRate, cfg.ttsCodec);
  const headers = (source: string, billed: number, extra: Record<string, string> = {}) => ({
    "Content-Type": "audio/mpeg",
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-TTS-Source": source,
    "X-TTS-Billed-Chars": String(billed),
    "X-TTS-Model": voice.model,
    "X-TTS-Speaker": voice.speaker,
    "X-TTS-Key": key,
    "X-TTS-Sample-Rate": String(cfg.ttsSampleRate),
    ...extra,
  });

  const hit = await getCached(key);
  if (hit) return new Response(new Uint8Array(hit.audio), { headers: headers(hit.source, 0) });

  const r = await sarvamTts(text, voice);
  if (!r.ok || !r.audio) {
    return Response.json(
      { error: r.error?.summary ?? "Sarvam TTS failed", kind: r.error?.kind, status: r.error?.status, code: r.error?.code },
      { status: 502, headers: { "X-TTS-Source": "failed" } },
    );
  }
  await putCached(key, r.audio);
  return new Response(new Uint8Array(r.audio), {
    headers: headers("sarvam", r.chars, { "X-TTS-Latency-Ms": String(r.latencyMs), "X-TTS-Request-Id": r.requestId ?? "" }),
  });
}
