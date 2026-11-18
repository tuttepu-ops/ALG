// Phone server for real calls (Twilio Media Streams). Run on your Mac:
//   npm run phone                       (listens on http://localhost:8080)
//   cloudflared tunnel --url http://localhost:8080      → gives https://<name>.trycloudflare.com
//   npm run phone:call -- +91XXXXXXXXXX [inbound|alert] → Twilio calls your phone; Ravi talks.
// Every call is saved in data/calls/: stereo recording (left caller, right Ravi) + transcript + timings.

import { loadEnv } from "../scripts/env";
loadEnv();
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { CallSession, type PhoneDeps } from "./bridge";
import { pcmToWav, stereoWav, wavToPcm8k } from "./audio";

const { SampleOrderSource } = await import("../src/lib/orders/orders");
const { runTurn } = await import("../src/lib/turn");
const { newSession } = await import("../src/lib/workflow/engine");
const { getConfig, resolveVoice } = await import("../src/lib/config");
const { sarvamStt, sarvamTts } = await import("../src/lib/providers/sarvam");
const { toSpeech } = await import("../src/lib/telugu/speech");
const { ACKS } = await import("../src/lib/agent/hospitalAgent");
const { getStore } = await import("../src/lib/storage/store");

const PORT = Number(process.env.PHONE_PORT || 8080);
const SECRET = process.env.PHONE_SECRET || getConfig().pilotCode || "change-me";
const cfg = getConfig();
const vobizKey = /^[a-f0-9]{64}$/.test(process.env.PHONE_SECRET ?? "") ? process.env.PHONE_SECRET : undefined;

/** Real providers: Sarvam recognition + Sarvam voice (8 kHz WAV), OpenAI agent. */
/** PHONE_FAKE_AUDIO=1 (tests only): stand-in recognition/voice — the caller's words come from `fakeWords`, the voice is a tone. */
const FAKE = process.env.PHONE_FAKE_AUDIO === "1";
export const fakeWords: string[] = [];

export async function makeDeps(orderId: string, log: (s: string) => void): Promise<PhoneDeps & { state: () => unknown }> {
  const order = (await new SampleOrderSource().get(orderId))!;
  const s = newSession(`call_${Date.now()}`, order);
  let state = s.state;
  const voice = resolveVoice(undefined);
  return {
    state: () => state,
    opening: () => s.segments.map((x) => x.text).join(" "),
    acks: ACKS,
    log,
    unheard() {
      const h = state.agent?.history;
      const last = h ? [...h].reverse().find((x) => x.who === "ravi") : undefined;
      if (last && !last.text.endsWith(")")) last.text += " (the caller spoke before hearing this — they did NOT hear it)";
    },
    async stt(pcm) {
      if (FAKE) { await new Promise((r) => setTimeout(r, 600)); return fakeWords.shift() ?? ""; } // ~Sarvam latency
      const r = await sarvamStt(new Blob([new Uint8Array(pcmToWav(pcm))], { type: "audio/wav" }), "utterance.wav");
      if (!r.ok) throw new Error(r.error?.summary ?? "stt failed");
      return r.transcript;
    },
    async tts(text) {
      if (FAKE) { await new Promise((r) => setTimeout(r, 700)); return Int16Array.from({ length: Math.min(text.length * 480, 8000 * 12) }, (_, i) => Math.round(Math.sin(i / 4) * 3000)); }
      const r = await sarvamTts(toSpeech(text, cfg.englishAs, cfg.numbersAs), voice, fetch, { codec: "wav", sampleRate: 8000 });
      if (!r.ok || !r.audio) throw new Error(r.error?.summary ?? "tts failed");
      return wavToPcm8k(r.audio);
    },
    async turn(text, interrupted, ackPlayed, onFirst) {
      const taken: Record<string, number> = {};
      for (const o of await getStore().listOutcomes()) for (const b of ((o.meta?.bookings as { doctorId: string; date: string }[] | undefined) ?? [])) taken[`${b.doctorId}|${b.date}`] = (taken[`${b.doctorId}|${b.date}`] ?? 0) + 1;
      const r = await runTurn({ state, order, text, interrupted, agentTaken: taken, onFirst, ackPlayed });
      state = r.state;
      if (r.outcome) await getStore().recordOutcome(r.outcome);
      return { text: r.segments.map((x) => x.text).join(" "), closed: r.state.stage === "closed", lang: r.state.agent?.lang ?? "te", outcome: r.outcome };
    },
  };
}

export function saveCall(id: string, call: CallSession, meta: Record<string, unknown>) {
  const dir = path.join(process.cwd(), "data", "calls");
  mkdirSync(dir, { recursive: true });
  const { left, right } = call.recording();
  writeFileSync(path.join(dir, `${id}.wav`), stereoWav(left, right));
  writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ ...meta, outcome: call.outcome, transcript: call.transcript, timings: call.timings }, null, 2));
  return path.join(dir, id);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  // Twilio asks what to do with the call: connect it to our audio stream.
  if (url.pathname === "/twilio/voice") {
    if (url.searchParams.get("key") !== SECRET) { res.writeHead(403).end(); return; }
    const mode = url.searchParams.get("mode") === "alert" ? "HSP-ALERT-3001" : "HSP-INBOUND";
    const wss = `wss://${req.headers["x-forwarded-host"] ?? req.headers.host}/twilio/stream`;
    res.writeHead(200, { "Content-Type": "text/xml" }).end(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${wss}"><Parameter name="orderId" value="${mode}"/><Parameter name="key" value="${SECRET}"/></Stream></Connect><Hangup/></Response>`,
    );
    return;
  }
  if (url.pathname === "/vobiz/health" || url.pathname === "/vobiz/answer") {
    if (!vobizKey || url.searchParams.get("key") !== vobizKey) { res.writeHead(403).end(); return; }
    if (url.pathname.endsWith("/health")) { res.writeHead(200).end("ok"); return; }
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    if (typeof host !== "string" || !/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(host)) {
      res.writeHead(400).end(); return;
    }
    res.writeHead(200, { "Content-Type": "application/xml" }).end(
      `<Response><Stream bidirectional="true" keepCallAlive="true" streamTimeout="180" contentType="audio/x-mulaw;rate=8000">wss://${host}/vobiz/stream?key=${vobizKey}</Stream><Hangup/></Response>`,
    );
    return;
  }
  if (url.pathname === "/health") { res.writeHead(200).end("ok"); return; }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({
  server,
  verifyClient({ req }: { req: IncomingMessage }) {
    const url = new URL(req.url ?? "/", "http://localhost");
    return url.pathname === "/twilio/stream" ||
      (url.pathname === "/vobiz/stream" && !!vobizKey && url.searchParams.get("key") === vobizKey);
  },
});
export function attachPhoneSocket(
  ws: Pick<WebSocket, "on" | "send" | "close" | "readyState">,
  vobiz: boolean,
  onSaved?: (call: CallSession, seconds: number) => void,
) {
  let starting = false;
  let call: CallSession | null = null;
  let streamSid = "";
  let callId = "";
  const pendingAudio: Uint8Array[] = [];
  let playbackTimer: ReturnType<typeof setTimeout> | undefined;
  const clearPlayback = () => {
    clearTimeout(playbackTimer);
    playbackTimer = undefined;
    pendingAudio.length = 0;
  };
  const pump = () => {
    const chunk = pendingAudio.shift();
    if (!chunk || ws.readyState !== 1) { playbackTimer = undefined; return; }
    ws.send(JSON.stringify({
      event: "playAudio", streamId: streamSid,
      media: { contentType: "audio/x-mulaw", sampleRate: 8000, payload: Buffer.from(chunk).toString("base64") },
    }));
    playbackTimer = setTimeout(pump, chunk.length / 8);
  };
  const t0 = Date.now();
  const log = (s: string) => {
    if (onSaved && /^(CALLER|RAVI)/.test(s)) return;
    console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
  };
  ws.on("error", (e) => log(`ws error ${e.message}`));
  ws.on("message", async (raw) => { try { await onMessage(raw); } catch (e) { log(`error: ${(e as Error).stack ?? e}`); } });
  const onMessage = async (raw: { toString(): string }) => {
    const m = JSON.parse(raw.toString()) as { event: string; start?: { streamSid: string; callSid: string; streamId?: string; callId?: string; mediaFormat?: { encoding: string; sampleRate: number }; customParameters?: Record<string, string> }; media?: { payload: string; track?: string } };
    if (m.event === "start" && m.start) {
      if (starting) return;
      starting = true;
      if (!vobiz && m.start.customParameters?.key !== SECRET) { log("rejected: wrong key"); ws.close(); return; }
      if (vobiz && (m.start.mediaFormat?.encoding !== "audio/x-mulaw" || m.start.mediaFormat.sampleRate !== 8000)) {
        log(`unsupported Vobiz audio format: ${JSON.stringify(m.start.mediaFormat)}`);
        ws.close();
        return;
      }
      streamSid = (vobiz ? m.start.streamId : m.start.streamSid) ?? "";
      if (!streamSid) { log("missing stream ID"); ws.close(); return; }
      const providerId = vobiz ? m.start.callId : m.start.callSid;
      const safeId = providerId && /^[a-z0-9_-]+$/i.test(providerId) ? providerId : randomUUID();
      callId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeId}`;
      const orderId = vobiz ? "HSP-ALERT-3001" : (m.start.customParameters?.orderId ?? "HSP-INBOUND");
      log(`call started (${vobiz ? "vobiz" : "twilio"}, ${orderId})`);
      const deps = await makeDeps(orderId, log);
      if (ws.readyState !== 1) return;
      call = new CallSession((o) => {
        if (ws.readyState !== 1) return;
        if (o.type === "audio") {
          if (vobiz) {
            for (let i = 0; i < o.ulaw.length; i += 320) pendingAudio.push(o.ulaw.subarray(i, i + 320));
            if (!playbackTimer) pump();
          } else {
            ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: Buffer.from(o.ulaw).toString("base64") } }));
          }
        } else if (o.type === "clear") {
          clearPlayback();
          ws.send(JSON.stringify(vobiz ? { event: "clearAudio", streamId: streamSid } : { event: "clear", streamSid }));
        } else if (o.type === "hangup") {
          log("hanging up");
          setTimeout(() => ws.close(), 300);
        }
      }, vobiz ? { ...deps, acks: { te: [], en: [] } } : deps);
      await call.start();
    } else if (m.event === "media" && m.media && call && (!m.media.track || m.media.track === "inbound")) {
      call.onAudio(new Uint8Array(Buffer.from(m.media.payload, "base64")));
    } else if (m.event === "fake_words" && FAKE) fakeWords.push((m as unknown as { text: string }).text);
    else if (m.event === "stop") { log("caller hung up"); ws.close(); }
  };
  ws.on("close", () => {
    clearPlayback();
    if (!call) return;
    call.closed = true;
    if (onSaved) { onSaved(call, (Date.now() - t0) / 1000); return; }
    const where = saveCall(callId, call, { provider: vobiz ? "vobiz" : "twilio", startedAt: new Date(t0).toISOString(), seconds: (Date.now() - t0) / 1000 });
    log(`call ended — saved ${where}.wav / .json`);
  });
}
wss.on("connection", (ws, req) => attachPhoneSocket(ws, req.url?.startsWith("/vobiz/stream?") ?? false));

if (process.argv[1]?.endsWith("server.ts")) {
  server.listen(PORT, () => console.log(`Phone server on http://localhost:${PORT}`));
}
export { server };
