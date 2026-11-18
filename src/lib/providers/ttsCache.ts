// Reuse Sarvam audio. Three layers, cheapest first:
//  1. Pre-generated static files (public/tts/<key>.mp3) for fixed template lines —
//     served by the CDN, zero function calls, zero Sarvam characters.
//  2. Server memory LRU, 3. server disk (.cache/tts locally, /tmp on Vercel).
// The browser also keeps its own cache, so a repeated line in a session is free.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfig, type VoiceSettings } from "../config";
import type { Segment } from "../workflow/types";
import { billableChars, ttsKey } from "./sarvam";
import { toSpeech } from "../telugu/speech";
import manifest from "../../../public/tts/manifest.json";

type Manifest = { entries: Record<string, { text: string; speaker: string; model: string; pace: number; chars: number }> };
const PREBUILT = (manifest as Manifest).entries;

export function isPrebuilt(key: string): boolean {
  return key in PREBUILT;
}

const MAX_MEM = 300;
const mem = new Map<string, Buffer>();

function cacheDir() {
  return process.env.TTS_CACHE_DIR || (getConfig().isVercel ? path.join(os.tmpdir(), "gb-tts") : path.join(process.cwd(), ".cache", "tts"));
}

export async function getCached(key: string): Promise<{ audio: Buffer; source: "server-memory" | "server-disk" } | null> {
  const m = mem.get(key);
  if (m) {
    mem.delete(key);
    mem.set(key, m); // LRU bump
    return { audio: m, source: "server-memory" };
  }
  try {
    const audio = await readFile(path.join(cacheDir(), `${key}.mp3`));
    remember(key, audio);
    return { audio, source: "server-disk" };
  } catch {
    return null;
  }
}

function remember(key: string, audio: Buffer) {
  mem.set(key, audio);
  while (mem.size > MAX_MEM) mem.delete(mem.keys().next().value as string);
}

export async function putCached(key: string, audio: Buffer) {
  remember(key, audio);
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(path.join(cacheDir(), `${key}.mp3`), audio);
  } catch {
    /* read-only FS: memory cache still works */
  }
}

export interface AudioPlanSegment {
  text: string;
  /** What is actually sent to Sarvam (numbers, prices and times written as words). */
  spoken: string;
  key: string;
  cacheable: boolean;
  chars: number;
  /** Static URL when pre-generated for this exact text + voice. */
  prebuiltUrl: string | null;
}

/** Attach cache keys so the browser can reuse audio without calling Sarvam again. */
export function planAudio(segments: Segment[], voice: VoiceSettings): AudioPlanSegment[] {
  const cfg = getConfig();
  return segments.map((s) => {
    const spoken = toSpeech(s.text, cfg.englishAs, cfg.numbersAs);
    const key = ttsKey(spoken, voice, cfg.ttsSampleRate, cfg.ttsCodec);
    return {
      text: s.text,
      spoken,
      key,
      cacheable: s.cacheable,
      chars: billableChars(spoken),
      prebuiltUrl: isPrebuilt(key) ? `/tts/${key}.mp3` : null,
    };
  });
}
