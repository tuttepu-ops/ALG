// Phone bridge: speech detection, instant acknowledgement, barge-in, hang-up, recording — with fake audio and a fake agent.
import { describe, expect, it } from "vitest";
import { CallSession, type Outgoing, type PhoneDeps } from "../phone/bridge";
import { pcmToUlaw, ulawToPcm, wavToPcm8k, pcmToWav } from "../phone/audio";

const frame = (amp: number) => pcmToUlaw(Int16Array.from({ length: 160 }, () => Math.round((Math.random() * 2 - 1) * amp)));
const tone = (ms: number) => Int16Array.from({ length: ms * 8 }, (_, i) => Math.round(Math.sin(i / 3) * 4000));

function fakeCall(replies: string[], opts: { closeOnLast?: boolean } = {}) {
  const sent: Outgoing[] = [];
  const said: string[] = [];
  const deps: PhoneDeps = {
    opening: () => "నమస్కారం అండి!",
    acks: { te: ["హా అండి."], en: ["Sure."] },
    stt: async () => said.shift() ?? "",
    tts: async (t) => tone(Math.min(2000, t.length * 30)),
    turn: async (text, _i, ack, onFirst) => {
      const reply = replies.shift() ?? "సరే అండి.";
      onFirst(reply.split(". ")[0] + ".");
      return { text: reply, closed: !!opts.closeOnLast && replies.length === 0, lang: "te", outcome: null };
    },
  };
  const call = new CallSession((m) => sent.push(m), deps);
  const speak = (words: string, ms: number) => { said.push(words); for (let i = 0; i < ms / 20; i++) call.onAudio(frame(6000)); };
  const quiet = (ms: number) => { for (let i = 0; i < ms / 20; i++) call.onAudio(frame(40)); };
  return { call, sent, speak, quiet };
}
const flush = () => new Promise((r) => setTimeout(r, 30));

describe("phone bridge", () => {
  it("μ-law and WAV round trips", () => {
    const pcm = Int16Array.from({ length: 800 }, (_, i) => Math.round(Math.sin(i / 5) * 10000));
    const back = ulawToPcm(pcmToUlaw(pcm));
    expect(Math.max(...back.map((v, i) => Math.abs(v - pcm[i])))).toBeLessThan(700);
    expect(wavToPcm8k(pcmToWav(pcm)).length).toBe(800);
  });

  it("detects the end of speech, acknowledges instantly, then answers", async () => {
    const c = fakeCall(["Dr. Viswanath గారు cardiologist అండి. Fee 100 rupees."]);
    await c.call.start();
    const afterOpening = c.sent.length;
    c.quiet(3000); // opening plays
    c.speak("fee ఎంత?", 800);
    c.quiet(800); // end of sentence
    await flush();
    expect(c.sent.length).toBeGreaterThan(afterOpening);
    expect(c.call.transcript.map((t) => t.text)).toEqual(["నమస్కారం అండి!", "fee ఎంత?", "హా అండి. Dr. Viswanath గారు cardiologist అండి. Fee 100 rupees."]);
    expect(c.call.timings[0].ackAfterMs).toBeLessThan(20);
  });

  it("ignores clicks/breaths shorter than speech", async () => {
    const c = fakeCall(["x"]);
    await c.call.start();
    c.quiet(3000);
    c.speak("noise", 100);
    c.quiet(1000);
    await flush();
    expect(c.call.transcript.length).toBe(1);
  });

  it("caller talking over Ravi cuts his audio (barge-in)", async () => {
    const c = fakeCall(["చాలా పొడవైన reply. ".repeat(10)]);
    await c.call.start();
    c.quiet(3000);
    c.speak("appointment కావాలి", 800);
    c.quiet(800);
    await flush();
    c.quiet(400); // Ravi is talking
    c.speak("ఆగండి ఆగండి", 600); // interrupts
    expect(c.sent.some((m) => m.type === "clear")).toBe(true);
  });

  it("hangs up after the goodbye and records both sides", async () => {
    const c = fakeCall(["Thank you, take care!"], { closeOnLast: true });
    await c.call.start();
    c.quiet(3000);
    c.speak("సరే thank you", 600);
    c.quiet(800);
    await flush();
    c.quiet(3000);
    await new Promise((r) => setTimeout(r, 1200));
    expect(c.sent.at(-1)?.type).toBe("hangup");
    const { left, right } = c.call.recording();
    expect(left.length).toBeGreaterThan(8000 * 5);
    expect(right.some((v) => v !== 0)).toBe(true);
  });
});
