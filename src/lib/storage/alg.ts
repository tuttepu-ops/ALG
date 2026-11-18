export interface AlgCall {
  id: string;
  started_at?: string;
  channel?: "phone" | "browser";
  status?: string;
  destination?: string;
  seconds?: number;
  response_ms?: number | null;
  cost_inr?: number | null;
  recording?: string;
  outcome?: unknown;
  transcript?: { who: string; text: string }[];
}

export function algStorageReady() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function supabaseRequest(path: string, init: RequestInit = {}) {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) throw new Error("Supabase call storage is not configured.");
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  const result = await fetch(new URL(path, url), { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!result.ok) throw new Error(`Supabase request failed (HTTP ${result.status}).`);
  return result;
}

export async function putAlgCall(call: AlgCall) {
  await supabaseRequest("/rest/v1/alg_calls?on_conflict=id", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(call),
  });
}

export async function updateAlgCall(id: string, fields: Partial<AlgCall>) {
  await supabaseRequest(`/rest/v1/alg_calls?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
  });
}

export async function listAlgCalls() {
  const result = await supabaseRequest("/rest/v1/alg_calls?select=*&order=started_at.desc&limit=250");
  return result.json() as Promise<AlgCall[]>;
}

export async function uploadAlgRecording(id: string, audio: Uint8Array) {
  const name = `${id}.wav`;
  await supabaseRequest(`/storage/v1/object/alg-recordings/${name}`, {
    method: "POST", headers: { "Content-Type": "audio/wav", "x-upsert": "true" },
    body: new Uint8Array(audio),
  });
  return name;
}

export async function signAlgRecording(name: string) {
  const result = await supabaseRequest(`/storage/v1/object/sign/alg-recordings/${encodeURIComponent(name)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 120 }),
  });
  const { signedURL } = await result.json() as { signedURL: string };
  return new URL(`/storage/v1${signedURL}`, process.env.SUPABASE_URL!).href;
}
