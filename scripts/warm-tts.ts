// Pre-generate Sarvam audio for every fixed template line (default voice) into public/tts/.
// These files are served as static assets: the greeting and common replies then cost
// zero Sarvam characters per session. Re-run after changing templates or the default voice.
//
//   npm run tts:warm               (uses SARVAM_API_KEY from .env.local / environment)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "./env";

loadEnv();

const { getConfig } = await import("../src/lib/config");
const { sarvamTts, ttsKey, billableChars } = await import("../src/lib/providers/sarvam");
const { allCacheableLines } = await import("../src/lib/workflow/templates");
const { toSpeech } = await import("../src/lib/telugu/speech");

const cfg = getConfig();
const voice = cfg.defaultVoice;
const dir = path.join(process.cwd(), "public", "tts");
await mkdir(dir, { recursive: true });
const manifestPath = path.join(dir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8").catch(() => '{"entries":{}}')) as {
  entries: Record<string, { text: string; speaker: string; model: string; pace: number; chars: number }>;
};

const lines = allCacheableLines();
let billed = 0;
let skipped = 0;
const wanted = new Set<string>();
for (const text of lines) {
  const key = ttsKey(toSpeech(text, cfg.englishAs, cfg.numbersAs), voice, cfg.ttsSampleRate, cfg.ttsCodec);
  wanted.add(key);
  const file = path.join(dir, `${key}.mp3`);
  const exists = await readFile(file).then(() => true).catch(() => false);
  if (exists && manifest.entries[key]) { skipped++; continue; }
  const r = await sarvamTts(toSpeech(text, cfg.englishAs, cfg.numbersAs), voice);
  if (!r.ok || !r.audio) {
    console.error(`FAILED: ${text}\n  ${r.error?.summary}`);
    process.exitCode = 1;
    continue;
  }
  await writeFile(file, r.audio);
  manifest.entries[key] = { text, speaker: voice.speaker, model: voice.model, pace: voice.pace, chars: billableChars(text) };
  billed += r.chars;
  console.log(`ok ${key} ${r.chars} chars ${r.latencyMs} ms  ${text}`);
}
// Drop entries for lines that no longer exist / other voices.
for (const k of Object.keys(manifest.entries)) if (!wanted.has(k)) delete manifest.entries[k];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n${lines.length} fixed lines · ${skipped} already present · ${billed} Sarvam chars billed now (₹${((billed / 1000) * 1).toFixed(2)} at v4 Flash rates)`);
console.log(`Voice: ${voice.model} / ${voice.speaker} / pace ${voice.pace}`);
