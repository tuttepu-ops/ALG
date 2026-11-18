// Minimal .env.local / .env loader for scripts (Next.js loads these itself for the app).
import { readFileSync } from "node:fs";

export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    let txt = "";
    try {
      txt = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trimStart().startsWith("#")) continue;
      const v = m[2].replace(/^["']|["']$/g, "");
      if (!(m[1] in process.env) && v) process.env[m[1]] = v;
    }
  }
}
