// A fake phone call over the real phone server, speaking Twilio's protocol: 20 ms μ-law frames in real time.
// Measures what the caller would feel: time from the end of their sentence to Ravi's first sound.
//   PHONE_FAKE_AUDIO=1 npm run phone:sim       (stand-in voice/recognition; real AI agent)
import { loadEnv } from "./env";
loadEnv();
process.env.PHONE_FAKE_AUDIO ??= "1";
import WebSocket from "ws";
const { server } = await import("../phone/server");
const { pcmToUlaw } = await import("../phone/audio");

const lines = (process.argv[2] ? JSON.parse(process.argv[2]) : [
  "హలో హలో లైన్‌లో ఉన్నారా?",
  "నాకు physiotherapist కావాలి, మీ దగ్గర ఉన్నారా?",
  "రేపు పెట్టండి, నా పేరు లక్ష్మి",
  "అవును confirm చేయండి",
  "సరే thank you",
]) as string[];
const mode = process.argv[3] ?? "inbound";

await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const key = process.env.PHONE_SECRET || process.env.PILOT_ACCESS_CODE || "change-me";
const ws = new WebSocket(`ws://127.0.0.1:${port}/twilio/stream`);
await new Promise((r) => ws.on("open", r));
let lastAudio = 0;
/** Like a phone: audio plays in real time, so Ravi is "talking" until all received audio has played. */
let playUntil = 0;
let firstAfterEnd: number | null = null;
let endAt = 0;
const gaps: number[] = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.event === "clear") playUntil = Date.now();
  if (m.event === "media") {
    lastAudio = Date.now();
    playUntil = Math.max(playUntil, Date.now()) + (Buffer.from(m.media.payload, "base64").length / 8000) * 1000;
    if (endAt && firstAfterEnd === null) { firstAfterEnd = Date.now() - endAt; gaps.push(firstAfterEnd); }
  }
});
ws.on("error", (e) => console.log("ws error", e));
ws.on("close", () => { console.log("\n(call ended)"); setTimeout(finish, 800); });
const send = (o: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));
send({ event: "start", start: { streamSid: "MZsim", callSid: "CAsim", customParameters: { orderId: mode === "alert" ? "HSP-ALERT-3001" : "HSP-INBOUND", key } } });
const frame = (amp: number) => Buffer.from(pcmToUlaw(Int16Array.from({ length: 160 }, () => Math.round((Math.random() * 2 - 1) * amp)))).toString("base64");
const stream = async (ms: number, amp: number) => {
  for (let t = 0; t < ms; t += 100) {
    for (let k = 0; k < 5; k++) send({ event: "media", media: { payload: frame(amp), track: "inbound" } });
    await new Promise((r) => setTimeout(r, 100));
  }
};
/** Wait (while sending line noise, like a real call) until Ravi has been quiet for a while. */
const waitForRavi = async (since = 0) => {
  const start = Date.now();
  // The instant "హా అండి." arrives first; wait for the real answer too (quiet for 3 s after the last audio).
  do { await stream(300, 40); } while (Date.now() - start < 40000 && (lastAudio <= since || Date.now() < playUntil + 900 || Date.now() - lastAudio < 3000));
};

await waitForRavi();
for (const words of lines) {
  if (ws.readyState !== ws.OPEN) break;
  send({ event: "fake_words", text: words });
  await stream(Math.max(800, words.length * 45), 6000); // the caller speaks
  endAt = Date.now() + 700; // speech ends; the detector needs 700 ms of quiet
  firstAfterEnd = null;
  await waitForRavi(Date.now());
}
send({ event: "stop" });
setTimeout(finish, 2000);
let done = false;
function finish() {
  if (done) return;
  done = true;
  console.log(`\nRavi's first sound after the caller stopped: ${gaps.map((g) => `${g} ms`).join(", ")} (includes the 700 ms the detector waits to be sure they finished)`);
  server.close();
  process.exit(0);
}
