// Session state travels with the browser as an HMAC-signed token, so the API stays
// stateless (works on Vercel without a database) while the browser cannot alter it.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";
import type { SessionState } from "./workflow/types";

let devSecret: string | null = null;

function secret(): string {
  const cfg = getConfig();
  if (cfg.sessionSecret) return cfg.sessionSecret;
  if (cfg.pilotCode) return createHash("sha256").update(`gb-session:${cfg.pilotCode}`).digest("hex");
  devSecret ??= randomBytes(32).toString("hex"); // local dev only
  return devSecret;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signState(state: SessionState): string {
  const payload = b64(JSON.stringify(state));
  const sig = b64(createHmac("sha256", secret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyState(token: string | undefined): SessionState | null {
  if (!token || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expect = createHmac("sha256", secret()).update(payload).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionState;
    return s.v === 1 ? s : null;
  } catch {
    return null;
  }
}
