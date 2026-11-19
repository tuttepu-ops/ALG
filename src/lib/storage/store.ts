import { algStorageReady, supabaseRequest } from "./alg";
// Outcome + session-report storage behind one interface, so Supabase (or Zoho write-back)
// can replace it later. recordOutcome is idempotent per session: first write wins.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Outcome } from "../workflow/types";
import type { SessionUsage } from "../usage";

export interface SessionReport {
  sessionId: string;
  orderId: string;
  outcome: Outcome["kind"] | null;
  usage: SessionUsage;
  costInr: number;
  turns: Array<{ who: "agent" | "customer"; text: string; route?: string; audio?: string; stt?: string }>;
  savedAt: string;
}

export interface Store {
  kind: "file" | "memory" | "upstash" | "supabase";
  /** Returns stored=false when this session already has an outcome (duplicate submit). */
  recordOutcome(o: Outcome): Promise<{ stored: boolean; existing?: Outcome }>;
  listOutcomes(): Promise<Outcome[]>;
  saveReport(r: SessionReport): Promise<void>;
  listReports(): Promise<SessionReport[]>;
}

export class MemoryStore implements Store {
  kind: Store["kind"] = "memory";
  protected outcomes = new Map<string, Outcome>();
  protected reports = new Map<string, SessionReport>();
  async recordOutcome(o: Outcome) {
    const existing = this.outcomes.get(o.sessionId);
    if (existing) return { stored: false, existing };
    this.outcomes.set(o.sessionId, o);
    await this.persist();
    return { stored: true };
  }
  async listOutcomes() {
    await this.load();
    return [...this.outcomes.values()].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }
  async saveReport(r: SessionReport) {
    this.reports.set(r.sessionId, r);
    await this.persist();
  }
  async listReports() {
    await this.load();
    return [...this.reports.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  protected async persist() {}
  protected async load() {}
}

/** Local JSON file (for running on your Mac). Serialised writes; survives restarts. */
export class FileStore extends MemoryStore {
  kind: Store["kind"] = "file";
  private loaded = false;
  private chain: Promise<void> = Promise.resolve();
  constructor(private file = path.join(process.cwd(), "data", "outcomes.json")) {
    super();
  }
  protected async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const j = JSON.parse(await readFile(this.file, "utf8")) as { outcomes: Outcome[]; reports: SessionReport[] };
      j.outcomes?.forEach((o) => this.outcomes.set(o.sessionId, o));
      j.reports?.forEach((r) => this.reports.set(r.sessionId, r));
    } catch {
      /* first run */
    }
  }
  async recordOutcome(o: Outcome) {
    await this.load();
    return super.recordOutcome(o);
  }
  async saveReport(r: SessionReport) {
    await this.load();
    return super.saveReport(r);
  }
  protected persist() {
    this.chain = this.chain.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const data = { outcomes: [...this.outcomes.values()], reports: [...this.reports.values()] };
      await writeFile(this.file, JSON.stringify(data, null, 2));
    });
    return this.chain;
  }
}

/** Upstash Redis over REST — persistent storage on Vercel with no server to run. */
export class UpstashStore implements Store {
  kind: Store["kind"] = "upstash";
  constructor(private url: string, private token: string) {}
  private async cmd<T>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    return ((await res.json()) as { result: T }).result;
  }
  async recordOutcome(o: Outcome) {
    const set = await this.cmd<number>("HSETNX", "gb:outcomes", o.sessionId, JSON.stringify(o));
    if (set === 1) return { stored: true };
    const existing = JSON.parse((await this.cmd<string>("HGET", "gb:outcomes", o.sessionId)) ?? "null");
    return { stored: false, existing };
  }
  async listOutcomes() {
    const vals = await this.cmd<string[]>("HVALS", "gb:outcomes");
    return vals.map((v) => JSON.parse(v) as Outcome).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }
  async saveReport(r: SessionReport) {
    await this.cmd("HSET", "gb:reports", r.sessionId, JSON.stringify(r));
  }
  async listReports() {
    const vals = await this.cmd<string[]>("HVALS", "gb:reports");
    return vals.map((v) => JSON.parse(v) as SessionReport).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
}

class SupabaseStore implements Store {
  kind = "supabase" as const;

  async recordOutcome(outcome: Outcome) {
    const response = await supabaseRequest("/rest/v1/alg_agent_records?on_conflict=id,kind", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ id: outcome.sessionId, kind: "outcome", payload: outcome }),
    });
    const rows = await response.json() as unknown[];
    if (rows.length) return { stored: true };
    const existing = await supabaseRequest(`/rest/v1/alg_agent_records?select=payload&kind=eq.outcome&id=eq.${encodeURIComponent(outcome.sessionId)}`);
    const [row] = await existing.json() as { payload: Outcome }[];
    return { stored: false, existing: row?.payload };
  }

  async saveReport(report: SessionReport) {
    await supabaseRequest("/rest/v1/alg_agent_records?on_conflict=id,kind", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: report.sessionId, kind: "report", payload: report }),
    });
  }

  private async list<T>(kind: "outcome" | "report") {
    const all: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const response = await supabaseRequest(`/rest/v1/alg_agent_records?select=payload&kind=eq.${kind}&order=id&limit=500&offset=${offset}`);
      const rows = await response.json() as { payload: T }[];
      all.push(...rows.map((row) => row.payload));
      if (rows.length < 500) return all;
    }
  }
  async listOutcomes() {
    return (await this.list<Outcome>("outcome")).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }
  async listReports() {
    return (await this.list<SessionReport>("report")).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
}

let singleton: Store | null = null;
export function getStore(): Store {
  if (singleton) return singleton;
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token, VERCEL } = process.env;
  if (algStorageReady()) singleton = new SupabaseStore();
  else if (url && token) singleton = new UpstashStore(url, token);
  else if (VERCEL) singleton = new MemoryStore(); // Vercel FS is not persistent; dashboard shows a warning
  else singleton = new FileStore(process.env.OUTCOMES_FILE || undefined);
  return singleton;
}

export function setStoreForTests(s: Store | null) {
  singleton = s;
}


/** Read live booking capacity only for turns that reach the hospital model. */
export async function loadAgentBookingCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const outcome of await getStore().listOutcomes()) {
    for (const booking of (outcome.meta?.bookings as { doctorId: string; date: string }[] | undefined) ?? []) {
      const slot = `${booking.doctorId}|${booking.date}`;
      counts[slot] = (counts[slot] ?? 0) + 1;
    }
  }
  return counts;
}
