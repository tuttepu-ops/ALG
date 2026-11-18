import { afterEach, expect, it, vi } from "vitest";
import { resolveVoice } from "@/lib/config";
import { sarvamTts } from "@/lib/providers/sarvam";

afterEach(() => vi.unstubAllEnvs());

it("uses the workspace clone ID and returns decoded MP3 audio", async () => {
  const id = "svc-00000000-0000-0000-0000-000000000001";
  vi.stubEnv("SARVAM_CLONE_VOICE_ID", id);
  vi.stubEnv("SARVAM_API_KEY", "test-key");
  vi.stubEnv("SARVAM_BASE_URL", "https://api.sarvam.ai");
  const urls: string[] = [];
  const request: typeof fetch = async (url, init) => {
    urls.push(String(url));
    if (String(url).endsWith("/stream")) return new Response("unavailable", { status: 404 });
    expect(url).toBe("https://api.sarvam.ai/voices/clone");
    expect(new Headers(init?.headers).get("api-subscription-key")).toBe("test-key");
    const form = init?.body as FormData;
    expect(form.get("voice_id")).toBe(id);
    expect(form.get("language_code")).toBe("te-IN");
    expect(form.get("output_audio_codec")).toBe("mp3");
    return Response.json({ audio_b64: "SUQz" });
  };
  expect(await sarvamTts("నమస్కారం", resolveVoice(undefined), request)).toMatchObject({
    ok: true, mime: "audio/mpeg", audio: Buffer.from("ID3"),
  });
  expect(urls).toEqual(["https://api.sarvam.ai/voices/clone/stream", "https://api.sarvam.ai/voices/clone"]);
  expect(resolveVoice({ speaker: "kavitha_te_conversation" }).model).toBe("bulbul:v4-flash");
});

it("cloned voice: uses the streaming endpoint and returns its MP3 bytes as one take", async () => {
  vi.stubEnv("SARVAM_CLONE_VOICE_ID", "svc-00000000-0000-0000-0000-000000000002");
  vi.stubEnv("SARVAM_API_KEY", "test-key");
  const request: typeof fetch = async (url, init) => {
    expect(url).toBe("https://api.sarvam.ai/voices/clone/stream");
    expect((init?.body as FormData).get("pace")).toBe("1");
    return new Response(new Uint8Array([0x49, 0x44, 0x33]), { headers: { "content-type": "audio/mpeg" } });
  };
  expect(await sarvamTts("నమస్కారం", resolveVoice(undefined), request)).toMatchObject({ ok: true, audio: Buffer.from("ID3") });
});
