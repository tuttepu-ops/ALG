import { afterEach, describe, expect, it, vi } from "vitest";
import { Mic } from "../src/client/mic";

class MockRecorder {
  mimeType = "audio/webm";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob(["fixture"]) });
    this.onstop?.();
  }
}

async function microphone(level: () => number) {
  const context = {
    createMediaStreamSource: () => ({ connect: () => {} }),
    createAnalyser: () => ({}),
    resume: async () => {},
  };
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({}) } });
  vi.stubGlobal("window", { AudioContext: function () { return context; } });
  vi.stubGlobal("MediaRecorder", MockRecorder);
  const mic = new Mic();
  vi.spyOn(mic, "level").mockImplementation(level);
  await mic.init();
  return mic;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("microphone turn boundaries", () => {
  it("keeps recording through a one-second thinking pause", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const mic = await microphone(() => (performance.now() < 800 || performance.now() >= 1800 && performance.now() < 2400) ? 0.03 : 0.002);
    const capture = mic.capture({ auto: true });
    await vi.advanceTimersByTimeAsync(1700);
    expect(mic.active).toBe(true);
    await vi.advanceTimersByTimeAsync(2300);
    expect((await capture).reason).toBe("silence");
  });

  it("marks a long utterance as a continuation and lets the caller finish manually", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const mic = await microphone(() => 0.04);
    const first = mic.capture({ auto: true });
    await vi.advanceTimersByTimeAsync(30100);
    expect(await first).toMatchObject({ hadSpeech: true, reason: "max" });
    const second = mic.capture({ auto: true });
    await vi.advanceTimersByTimeAsync(550);
    mic.finish();
    expect(await second).toMatchObject({ hadSpeech: true, reason: "manual" });
  });
});
