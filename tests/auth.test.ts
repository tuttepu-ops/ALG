import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPilot } from "@/lib/auth";

const req = (code?: string) => new Request("http://localhost/api/orders", { headers: code === undefined ? {} : { "x-pilot-code": code } });

afterEach(() => vi.unstubAllEnvs());

describe("pilot access gate", () => {
  it("accepts the exact code and rejects others", () => {
    vi.stubEnv("PILOT_ACCESS_CODE", "tritiya123");
    expect(checkPilot(req("tritiya123"))).toBeNull();
    expect(checkPilot(req("wrong"))?.status).toBe(401);
    expect(checkPilot(req())?.status).toBe(401);
  });
  it("ignores spaces and quotes around the code in .env.local and in the typed code", () => {
    vi.stubEnv("PILOT_ACCESS_CODE", ' "tritiya123" ');
    expect(checkPilot(req(" tritiya123 "))).toBeNull();
  });
  it("no code set locally → gate is off in development", () => {
    vi.stubEnv("PILOT_ACCESS_CODE", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(checkPilot(req())).toBeNull();
  });
});
