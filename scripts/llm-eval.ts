// Checks how the configured OpenAI model labels our exact Telugu–English examples
// (including ones the workflow normally handles without the model) and reports tokens.
//
//   npm run llm:eval        (needs OPENAI_API_KEY)

import { loadEnv } from "./env";
loadEnv();
const { interpretWithLlm } = await import("../src/lib/providers/openai");
const { costInr, emptyUsage, inr } = await import("../src/lib/usage");
type Stage = import("../src/lib/workflow/types").Stage;

const CASES: Array<[Stage, string, string[], string | null]> = [
  // [stage, utterance, acceptable intents, pending]
  ["opening", "hi andi", ["greet"], null],
  ["opening", "ha matladochu", ["permit"], null],
  ["opening", "ఆ మాట్లాడండి", ["permit"], null],
  ["opening", "why?", ["why"], null],
  ["opening", "దేని గురించి మాట్లాడుతున్నారు?", ["why"], null],
  ["opening", "ఆ మాట్లాడు చెప్పండి దేని గురించి కాల్ చేశారు", ["permit_why"], null],
  ["opening", "కాల్ బ్యాక్", ["callback"], null],
  ["opening", "nenu ippudu bus lo unna, signal sarigga ledu", ["callback", "hold", "unclear"], null],
  ["confirm", "why?", ["why"], null],
  ["confirm", "yes, confirm it", ["confirm"], null],
  ["confirm", "ha cheppandi", ["permit", "repeat", "unclear", "greet"], null], // must NOT be confirm (workflow handles it anyway)
  ["confirm", "kaja vaddu andi, pootharekulu inko box add cheyyandi", ["change"], null],
  ["confirm", "yes but address change cheyali, Kakinada ki pampandi", ["change"], null],
  ["confirm", "ఇంకో అర కిలో కాజా కావాలి", ["change"], null],
  ["confirm", "avakaya cancel cheyandi, gongura matram pampandi", ["change"], null],
  ["confirm", "mottham order vaddu andi", ["cancel"], null],
  ["confirm", "amma ki adigi chepta", ["callback", "hold", "unclear"], null],
  ["confirm", "seri seri ok pampinchu", ["confirm"], null],
  ["change_details", "kaja teeseyandi", ["change"], null],
  ["change_readback", "kaadu, rendu box kavali", ["change"], "పూతరేకులు ఇంకో box add చేయాలి"],
  ["callback_time", "lunch tarvata cheyandi", ["time", "callback"], null],
  ["callback_time", "night ki chey", ["time", "callback"], null],
];

const u = emptyUsage();
let pass = 0;
for (const [stage, text, ok, pending] of CASES) {
  const r = await interpretWithLlm(stage, text, pending);
  u.llmRequests += r.diag.called ? (r.diag.retried ? 2 : 1) : 0;
  u.llmInputTokens += r.diag.usage?.inputTokens ?? 0;
  u.llmOutputTokens += r.diag.usage?.outputTokens ?? 0;
  const intent = r.interp?.intent ?? `ERROR(${r.diag.error?.summary})`;
  const good = ok.includes(intent);
  if (good) pass++;
  const detail = r.interp?.detail ?? r.interp?.time?.raw ?? "";
  console.log(`${good ? "ok  " : "MISS"} [${stage}] ${text}\n      → ${intent}${detail ? ` · "${detail}"` : ""} · ${r.diag.usage?.inputTokens ?? "-"}/${r.diag.usage?.outputTokens ?? "-"} tok · ${r.diag.latencyMs} ms`);
}
const c = costInr(u, { model: process.env.OPENAI_MODEL || "gpt-5.4-mini", ttsModel: "bulbul:v4-flash", usdInr: 88 });
console.log(`\n${pass}/${CASES.length} labelled as expected · ${u.llmRequests} requests · avg ${Math.round(u.llmInputTokens / CASES.length)} in / ${(u.llmOutputTokens / CASES.length).toFixed(1)} out tokens · ${inr(c.llmInr / CASES.length)} per request`);
