import { createHmac, timingSafeEqual } from "node:crypto";

export function phoneTicket(id: string) {
  const secret = process.env.PHONE_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) throw new Error("Set PHONE_SECRET to 64 random hex characters.");
  return createHmac("sha256", secret).update(id).digest("hex");
}

export function phoneCallId(url: URL) {
  const id = url.searchParams.get("id");
  if (!id || !/^\d{13}-[a-f0-9-]{36}$/.test(id)) return null;
  const age = Date.now() - Number(id.slice(0, 13));
  if (age < -30000 || age > 600000) return null;
  try {
    const token = Buffer.from(url.searchParams.get("key") ?? "");
    const expected = Buffer.from(phoneTicket(id));
    return token.length === expected.length && timingSafeEqual(token, expected) ? id : null;
  } catch { return null; }
}

export function phoneUrl(origin: string, path: string, id: string) {
  const url = new URL(path, origin);
  if (url.protocol !== "https:") throw new Error("ALG_PUBLIC_URL must use HTTPS.");
  url.searchParams.set("id", id);
  url.searchParams.set("key", phoneTicket(id));
  return url;
}
