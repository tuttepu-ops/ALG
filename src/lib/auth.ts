// Private pilot access code for paid endpoints. Fails closed in production.

import { timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";

export function pilotRequired(): boolean {
  const cfg = getConfig();
  return !!cfg.pilotCode || cfg.isProd;
}

/** Returns an error Response, or null when the request may proceed. */
export function checkPilot(req: Request): Response | null {
  const cfg = getConfig();
  if (!cfg.pilotCode) {
    if (cfg.isProd)
      return Response.json({ error: "PILOT_ACCESS_CODE is not set on the server; paid endpoints are disabled." }, { status: 503 });
    return null; // local dev without a code
  }
  const got = Buffer.from((req.headers.get("x-pilot-code") ?? "").trim());
  const want = Buffer.from(cfg.pilotCode);
  if (got.length !== want.length || !timingSafeEqual(got, want))
    return Response.json({ error: "Pilot access code required." }, { status: 401 });
  return null;
}
