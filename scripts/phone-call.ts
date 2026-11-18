// Make Twilio call your phone and connect it to Ravi (phone server must be running and reachable).
//   npm run phone:call -- +91XXXXXXXXXX            (Ravi answers like the hospital line: "inbound" mode)
//   npm run phone:call -- +91XXXXXXXXXX alert      (Ravi calls Lakshmi about the cardiologist visit)
// Needs in .env.local: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (your Twilio number), PHONE_PUBLIC_URL (the tunnel's https URL).
import { loadEnv } from "./env";
loadEnv();
const [to, mode = "inbound"] = process.argv.slice(2);
const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from, PHONE_PUBLIC_URL: base } = process.env;
const key = process.env.PHONE_SECRET || process.env.PILOT_ACCESS_CODE || "change-me";
const missing = Object.entries({ TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from, PHONE_PUBLIC_URL: base }).filter(([, v]) => !v).map(([k]) => k);
if (!to || !/^\+\d{10,15}$/.test(to)) { console.error("Usage: npm run phone:call -- +91XXXXXXXXXX [inbound|alert]"); process.exit(1); }
if (missing.length) { console.error(`Missing in .env.local: ${missing.join(", ")}`); process.exit(1); }
const url = `${base!.replace(/\/$/, "")}/twilio/voice?key=${encodeURIComponent(key)}&mode=${mode === "alert" ? "alert" : "inbound"}`;
const health = await fetch(`${base!.replace(/\/$/, "")}/health`).then((r) => r.ok).catch(() => false);
if (!health) { console.error(`Phone server not reachable at ${base}/health — is "npm run phone" running and the tunnel up?`); process.exit(1); }
const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
  method: "POST",
  headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ To: to, From: from!, Url: url, Method: "POST" }),
});
const j = (await r.json()) as { sid?: string; message?: string; code?: number };
if (!r.ok) { console.error(`Twilio refused the call: ${j.message} (code ${j.code})`); process.exit(1); }
console.log(`Calling ${to} … (call ${j.sid}). Pick up and talk to Ravi. The recording and transcript will be in data/calls/.`);
