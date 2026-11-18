import { loadEnv } from "./env";
loadEnv();

async function main() {
  const to = process.argv[2];
  const { VOBIZ_AUTH_ID: id, VOBIZ_AUTH_TOKEN: token, VOBIZ_FROM: from, PHONE_PUBLIC_URL: base, PHONE_SECRET: key } = process.env;
  if (!to || !/^\+91\d{10}$/.test(to)) throw new Error("Usage: npm run phone:vobiz -- +91XXXXXXXXXX");
  if (!id || !token || !from || !base || !key) throw new Error("Set VOBIZ_AUTH_ID, VOBIZ_AUTH_TOKEN, VOBIZ_FROM, PHONE_PUBLIC_URL and PHONE_SECRET.");
  if (!/^\+91\d{10}$/.test(from)) throw new Error("VOBIZ_FROM must be a +91 number.");
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Set PHONE_SECRET to the output of openssl rand -hex 32 and restart the phone server.");
  const origin = new URL(base);
  if (origin.protocol !== "https:" || origin.href !== origin.origin + "/") throw new Error("Use the plain HTTPS tunnel URL.");
  const health = new URL("/vobiz/health", origin);
  health.searchParams.set("key", key);
  const ready = await fetch(health, { signal: AbortSignal.timeout(10000) });
  if (!ready.ok || await ready.text() !== "ok") throw new Error("Vobiz health check failed. Check the port 8080 tunnel, phone server and PHONE_SECRET.");
  const answer = new URL("/vobiz/answer", origin);
  answer.searchParams.set("key", key);
  const response = await fetch(`https://api.vobiz.ai/api/v1/Account/${encodeURIComponent(id)}/Call/`, {
    method: "POST",
    headers: { "X-Auth-ID": id, "X-Auth-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, answer_url: answer.href, answer_method: "POST" }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const detail = (await response.text()).replaceAll(key, "[redacted]").replaceAll(token, "[redacted]");
    throw new Error(`Vobiz rejected the call (HTTP ${response.status}): ${detail}`);
  }
  console.log("Vobiz accepted the call request. Pick up your mobile and talk to Ravi.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Call request failed.");
  process.exitCode = 1;
});
