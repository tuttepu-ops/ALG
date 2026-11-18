// End-to-end verification against a running app (npm run dev / npm start).
// Drives every required path through the real HTTP API, fetches agent audio like the
// phone does (with a device-side cache), optionally sends synthetic customer speech
// through Sarvam recognition, and checks that each path records the right outcome once.
//
//   BASE_URL=http://localhost:3000 PILOT_ACCESS_CODE=... npm run verify:live
//   Add VOICE_INPUT=1 to also test recognition with synthetic Telugu speech (costs a little).

import { writeFile } from "node:fs/promises";
import { loadEnv } from "./env";
import { costInr, emptyUsage, inr, type SessionUsage } from "../src/lib/usage";

loadEnv();
const BASE = process.env.BASE_URL || "http://localhost:3000";
const CODE = process.env.PILOT_ACCESS_CODE || "";
const VOICE_INPUT = process.env.VOICE_INPUT === "1";
const H = { "Content-Type": "application/json", ...(CODE ? { "x-pilot-code": CODE } : {}) };

interface Seg { text: string; key: string; cacheable: boolean; chars: number; prebuiltUrl: string | null }
type Step = string | { text: string; interrupted?: boolean; turnId?: string; voice?: string };
interface Scenario { name: string; order: string; steps: Step[]; expect: string | null; expectCallbackTime?: boolean; dupLast?: boolean }

const SCENARIOS: Scenario[] = [
  { name: "Main: hi andi → ha matladochu → why? → yes, confirm it", order: "GB-1042", steps: ["hi andi", "ha matladochu", "why?", "yes, confirm it"], expect: "confirmed" },
  { name: "Permission: ఆ మాట్లాడండి → confirm", order: "GB-1042", steps: ["ఆ మాట్లాడండి", "సరే confirm చేయండి"], expect: "confirmed" },
  { name: "Permission + question in one turn", order: "GB-1043", steps: ["ఆ మాట్లాడు చెప్పండి దేని గురించి కాల్ చేశారు", "అవును"], expect: "confirmed" },
  { name: "కాల్ బ్యాక్ → time", order: "GB-1044", steps: ["కాల్ బ్యాక్", "రేపు సాయంత్రం 6 గంటలకి"], expect: "callback", expectCallbackTime: true },
  { name: "Busy, end now", order: "GB-1042", steps: ["busy andi, bye"], expect: "callback" },
  { name: "Change request (needs OpenAI)", order: "GB-1042", steps: ["ha cheppandi", "kaja vaddu andi, pootharekulu inko box add cheyyandi", "avunu"], expect: "change_request" },
  { name: "Cancel → read back → yes", order: "GB-1043", steps: ["ha", "cancel చేయండి", "అవును"], expect: "cancel_request" },
  { name: "Interruption: total? over the readout → confirm", order: "GB-1044", steps: ["ha", { text: "total entha?", interrupted: true }, "ok confirm"], expect: "confirmed" },
  { name: "Interruption: 'yes' over the readout must not confirm", order: "GB-1042", steps: ["ha", { text: "yes", interrupted: true }, "yes"], expect: "confirmed" },
  { name: "Unclear twice → pending staff", order: "GB-1043", steps: ["ha", "asdf qwerty zxcv lorem", "hmm blah blah unknown words"], expect: "pending_staff" },
  { name: "Duplicate submission of final yes", order: "GB-1044", steps: ["ha", "yes"], expect: "confirmed", dupLast: true },
];

// Synthetic customer speech (native script reads best on Bulbul) for the recognition test.
const VOICE_SCENARIOS: Scenario[] = [
  { name: "VOICE main path", order: "GB-1042", steps: [{ text: "", voice: "హాయ్ అండి" }, { text: "", voice: "హా మాట్లాడొచ్చు" }, { text: "", voice: "why?" }, { text: "", voice: "yes, confirm it" }], expect: "confirmed" },
  { name: "VOICE ఆ మాట్లాడు చెప్పండి దేని గురించి కాల్ చేశారు", order: "GB-1043", steps: [{ text: "", voice: "ఆ మాట్లాడు చెప్పండి, దేని గురించి కాల్ చేశారు?" }, { text: "", voice: "అవును, confirm చేయండి" }], expect: "confirmed" },
  { name: "VOICE కాల్ బ్యాక్", order: "GB-1044", steps: [{ text: "", voice: "కాల్ బ్యాక్ చేయండి" }, { text: "", voice: "సాయంత్రం ఆరు గంటలకి" }], expect: "callback", expectCallbackTime: true },
];

const deviceCache = new Set<string>();
const api = async (path: string, body?: unknown) => {
  const r = await fetch(BASE + path, body === undefined ? { headers: H } : { method: "POST", headers: H, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
};

async function playLikePhone(segs: Seg[], u: SessionUsage, audioLog: string[]) {
  for (const s of segs) {
    if (deviceCache.has(s.key)) { u.ttsCacheHits++; u.ttsCharsReused += s.chars; audioLog.push("phone-cache"); continue; }
    if (s.prebuiltUrl) {
      const r = await fetch(BASE + s.prebuiltUrl);
      if (r.ok) { await r.arrayBuffer(); deviceCache.add(s.key); u.ttsCacheHits++; u.ttsCharsReused += s.chars; audioLog.push("prebuilt"); continue; }
    }
    const r = await fetch(BASE + "/api/tts", { method: "POST", headers: H, body: JSON.stringify({ text: s.text }) });
    if (!r.ok) { u.ttsFailures++; audioLog.push(`FAILED(${r.status})`); continue; }
    await r.arrayBuffer();
    deviceCache.add(s.key);
    const src = r.headers.get("x-tts-source");
    if (src === "sarvam") { u.ttsCharsBilled += Number(r.headers.get("x-tts-billed-chars")); u.ttsSarvamRequests++; audioLog.push(`sarvam(${r.headers.get("x-tts-speaker")})`); }
    else { u.ttsCacheHits++; u.ttsCharsReused += s.chars; audioLog.push(src ?? "?"); }
  }
}

async function speechFor(text: string): Promise<{ blob: Blob; seconds: number } | null> {
  // Different voice from the agent so recognition is not hearing its own voice.
  const r = await fetch(BASE + "/api/tts", { method: "POST", headers: H, body: JSON.stringify({ text, voice: { speaker: "tarun_te_narration" } }) });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return { blob: new Blob([buf], { type: "audio/mpeg" }), seconds: Math.max(1, Math.ceil((buf.length * 8) / 128000)) };
}

interface Result {
  name: string; ok: boolean; problems: string[]; outcome: any; outcomesForSession: number;
  turns: Array<{ input: string; heard?: string; route: string; intent: string | null; llm?: string; reply: string; audio: string[] }>;
  usage: SessionUsage; cost: ReturnType<typeof costInr>;
}

async function runScenario(sc: Scenario): Promise<Result> {
  const u = emptyUsage();
  const problems: string[] = [];
  const turns: Result["turns"] = [];
  const start = await api("/api/session/start", { orderId: sc.order });
  if (start.status !== 200) throw new Error(`start failed ${start.status} ${JSON.stringify(start.json)}`);
  let token = start.json.token as string;
  const sessionId = start.json.sessionId as string;
  const a0: string[] = [];
  await playLikePhone(start.json.reply.segments, u, a0);
  turns.push({ input: "(start)", route: "workflow", intent: "opening", reply: start.json.reply.segments.map((s: Seg) => s.text).join(" "), audio: a0 });
  let outcome: any = null;
  let lastTurnBody: any = null;

  for (const st of sc.steps) {
    const step = typeof st === "string" ? { text: st } : st;
    let text = step.text;
    let heard: string | undefined;
    if (step.voice) {
      const sp = await speechFor(step.voice);
      if (!sp) { problems.push("could not synthesise customer audio"); break; }
      const fd = new FormData();
      fd.append("file", sp.blob, "utterance.mp3");
      const r = await fetch(BASE + "/api/stt", { method: "POST", headers: CODE ? { "x-pilot-code": CODE } : {}, body: fd });
      const j = (await r.json()) as any;
      u.sttRequests++; u.sttSecondsBilled += sp.seconds;
      if (!j.ok) { u.sttFailures++; problems.push(`STT failed: ${j.error?.summary}`); break; }
      text = j.transcript;
      heard = `${j.provider} ${j.model}/${j.mode}: "${j.transcript}"`;
    }
    const body = { token, text, turnId: step.turnId ?? Math.random().toString(36).slice(2), interrupted: !!step.interrupted };
    lastTurnBody = body;
    const r = await api("/api/turn", body);
    if (r.status !== 200) { problems.push(`turn HTTP ${r.status}: ${JSON.stringify(r.json)}`); break; }
    const j = r.json;
    token = j.token;
    u.turns++;
    if (j.diag.route === "workflow") u.workflowTurns++; else u.openaiTurns++;
    let llm: string | undefined;
    if (j.diag.llm?.called) {
      u.llmRequests += j.diag.llm.retried ? 2 : 1;
      if (!j.diag.llm.ok) u.llmFailures++;
      u.llmInputTokens += j.diag.llm.usage?.inputTokens ?? 0;
      u.llmCachedInputTokens += j.diag.llm.usage?.cachedInputTokens ?? 0;
      u.llmOutputTokens += j.diag.llm.usage?.outputTokens ?? 0;
      llm = j.diag.llm.ok
        ? `OpenAI OK ${j.diag.llm.usage?.inputTokens}/${j.diag.llm.usage?.outputTokens} tok ${j.diag.llm.latencyMs}ms raw=${j.diag.llm.raw}`
        : `OpenAI FAILED: ${j.diag.llm.error?.summary}`;
    }
    const audio: string[] = [];
    await playLikePhone(j.reply.segments, u, audio);
    turns.push({ input: step.voice ? `[voice] ${step.voice}` : text, heard, route: j.diag.route, intent: j.diag.intent, llm, reply: j.reply.segments.map((s: Seg) => s.text).join(" "), audio });
    if (j.outcome) outcome = j.outcome;

    // Provider failure path: use the offered manual option, as a customer/staff would.
    if (j.diag.route === "openai_failed" && j.diag.manualOptions?.length) {
      turns[turns.length - 1].llm += ` → manual options offered: ${j.diag.manualOptions.join(" | ")}`;
      if (sc.expect === "change_request") break; // change details genuinely need the model
    }
  }

  if (sc.dupLast && lastTurnBody) {
    const dup = await api("/api/turn", lastTurnBody);
    if (!dup.json?.duplicate) problems.push("duplicate submission was not detected");
  }

  const all = await api("/api/outcomes");
  const mine = (all.json.outcomes as any[]).filter((o) => o.sessionId === sessionId);
  if (sc.expect && mine.length !== 1) problems.push(`expected exactly 1 stored outcome, found ${mine.length}`);
  if (sc.expect && mine[0]?.kind !== sc.expect) problems.push(`expected outcome ${sc.expect}, got ${mine[0]?.kind ?? "none"}`);
  if (sc.expectCallbackTime && !mine[0]?.callbackTime) problems.push("callback time not saved");
  u.sessionSeconds = Math.round(turns.length * 7.5); // ≈ 7.5 s per exchange for per-minute estimates
  const cost = costInr(u, { model: "gpt-5.4-mini", ttsModel: "bulbul:v4-flash", usdInr: 88 });
  await api("/api/report", { token, usage: u, costInr: cost.totalInr, turns: turns.map((t) => ({ who: "customer", text: t.input, route: t.route })) });
  return { name: sc.name, ok: problems.length === 0, problems, outcome: mine[0] ?? outcome, outcomesForSession: mine.length, turns, usage: u, cost };
}

const results: Result[] = [];
for (const sc of [...SCENARIOS, ...(VOICE_INPUT ? VOICE_SCENARIOS : [])]) {
  try {
    results.push(await runScenario(sc));
  } catch (e) {
    results.push({ name: sc.name, ok: false, problems: [String(e)], outcome: null, outcomesForSession: 0, turns: [], usage: emptyUsage(), cost: costInr(emptyUsage(), { model: "gpt-5.4-mini", ttsModel: "bulbul:v4-flash", usdInr: 88 }) });
  }
}

for (const r of results) {
  console.log(`\n${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
  for (const t of r.turns) {
    console.log(`   ▸ ${t.input}${t.heard ? `\n       heard: ${t.heard}` : ""}`);
    console.log(`     [${t.route}${t.intent ? ` → ${t.intent}` : ""}] ${t.reply}`);
    if (t.llm) console.log(`       ${t.llm}`);
    console.log(`       audio: ${t.audio.join(", ")}`);
  }
  console.log(`   outcome: ${r.outcome ? `${r.outcome.kind}${r.outcome.detail ? ` (${r.outcome.detail})` : ""}${r.outcome.callbackTime ? ` @ ${r.outcome.callbackTime}` : ""}` : "none"} · stored ${r.outcomesForSession}×`);
  console.log(`   usage: LLM ${r.usage.llmRequests} req ${r.usage.llmInputTokens}/${r.usage.llmOutputTokens} tok · Sarvam TTS ${r.usage.ttsCharsBilled} chars billed, ${r.usage.ttsCharsReused} reused · STT ${r.usage.sttSecondsBilled}s · ${inr(r.cost.totalInr)}`);
  for (const p of r.problems) console.log(`   ✗ ${p}`);
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} scenarios passed`);
await writeFile(process.env.RESULTS_FILE || "verify-results.json", JSON.stringify(results, null, 2));
if (passed !== results.length) process.exitCode = 1;
