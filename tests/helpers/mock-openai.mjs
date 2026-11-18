// Test helper: fake OpenAI /v1/responses (replays real error bodies) + failing Sarvam endpoints.
// POST /__mode {"mode": "quota" | "ratelimit_once" | "ratelimit_always" | "ok"}
import http from "node:http";

let mode = "quota";
let calls = 0;
const QUOTA = { error: { message: "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.", type: "insufficient_quota", param: null, code: "credit_balance_exhausted" } };
const RATE = { error: { message: "Rate limit reached for gpt-5.4-mini on requests per min (RPM): Limit 3, Used 3, Requested 1.", type: "requests", param: null, code: "rate_limit_exceeded" } };
const ok = (text) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 447, output_tokens: 17, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/__mode") { mode = JSON.parse(body).mode; calls = 0; res.end("ok"); return; }
    if (req.url === "/text-to-speech" || req.url === "/speech-to-text") {
      // Sarvam credits exhausted (documented 402 insufficient_quota_error).
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Insufficient credits", code: "insufficient_quota_error", request_id: null } }));
      return;
    }
    if (req.url === "/__calls") { res.end(String(calls)); return; }
    calls++;
    const send = (status, obj, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };
    if (mode === "quota") return send(429, QUOTA);
    if (mode === "ratelimit_always") return send(429, RATE, { "retry-after": "1" });
    if (mode === "ratelimit_once" && calls === 1) return send(429, RATE, { "retry-after": "1" });
    return send(200, ok(JSON.stringify({ i: "change", d: "కాజా వద్దు, పూతరేకులు ఇంకో box add చేయండి" })));
  });
}).listen(4010, () => console.log("mock openai on :4010"));
