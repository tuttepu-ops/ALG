"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReplyPlayer, type AudioSource, type PlanSegment, type SegmentPlayback } from "./audio";
import { CallSound, DEFAULT_CALL_SOUND, type CallSoundSettings } from "./fx";
import { Mic } from "./mic";
import { costInr, emptyUsage, inr, type SessionUsage } from "@/lib/usage";

// ---------- types mirrored from the API ----------
interface Voice { id: string; model: string; label: string; inrPer1kChars: number }
interface Config {
  pilotRequired: boolean;
  pilotHint?: "none" | "placeholder" | "set";
  providers: { openaiKeySet: boolean; sarvamKeySet: boolean };
  llm: { model: string; effort: string; maxOutputTokens: number };
  stt: { provider: string; model: string; mode: string; language: string };
  voices: Voice[];
  defaultVoice: { model: string; speaker: string; pace: number };
  storage: { kind: string; persistent: boolean };
  usdInr: number;
}
interface OrderItem { nameEn: string; nameTe: string; qty: string; price: number }
interface Outcome { sessionId: string; orderId: string; kind: string; detail: string | null; callbackTime: string | null; customerWords: string; route: string; turn: number; recordedAt: string }
interface Order { id: string; customerName: string; phoneMasked: string; city: string; items: OrderItem[]; total: number; lastOutcome: Outcome | null; workflow?: "shop" | "hospital" }
interface LlmDiag {
  called: boolean; ok: boolean; model: string; effort: string; maxOutputTokens: number; latencyMs: number; retried: boolean;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number } | null;
  error?: { kind: string; summary: string; status?: number; code?: string };
  firstError?: { kind: string; message: string; retryAfterMs?: number };
  raw?: string;
}
interface TurnDiag { route: "workflow" | "openai" | "openai_failed"; intent: string | null; llmReason: string | null; llm: LlmDiag | null; manualOptions: string[] | null }
interface SttDiag { ok: boolean; provider: string; model: string; mode: string; latencyMs: number; seconds: number; error?: string | null; transcript?: string }

interface Entry {
  id: string;
  who: "agent" | "customer";
  text: string;
  input?: "voice" | "typed";
  stt?: SttDiag;
  interrupted?: boolean;
  route?: TurnDiag["route"];
  intent?: string | null;
  audio?: SegmentPlayback[];
  segments?: PlanSegment[];
  error?: string;
}

interface TurnRow {
  n: number;
  input: "voice" | "typed";
  text: string;
  stt?: SttDiag;
  diag?: TurnDiag;
  audio?: SegmentPlayback[];
  outcome?: Outcome | null;
  error?: string;
}

type Status = "idle" | "starting" | "listening" | "transcribing" | "thinking" | "speaking" | "done";
type Tab = "call" | "outcomes" | "voices" | "diag";

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const TEST_PHRASES = [
  "hi andi", "ha matladochu", "why?", "yes, confirm it", "ఆ మాట్లాడండి",
  "ఆ మాట్లాడు చెప్పండి దేని గురించి కాల్ చేశారు", "కాల్ బ్యాక్", "సాయంత్రం 6 గంటలకి",
  "kaja vaddu andi, pootharekulu inko box add cheyyandi", "total entha?", "cancel చేయండి", "అవును",
];

const HOSPITAL_TEST_PHRASES = [
  "Doctor Viswanath garu eppudu vastharu? Consultation fee entha?", "ఆ నేనే చెప్పండి", "నేను వాళ్ళ అబ్బాయిని",
  "Ma nannagari heart checkup kosam chupinchali, old reports kooda unnayi", "Appointment eppudu istaru?",
  "Na peru Ramesh andi. November 22 ki okati confirm cheseyandi", "25 ki పెట్టండి", "అవును", "ఆ",
  "Hi, I want to book an appointment with the cardiologist", "My name is Ramesh, the 22nd please",
  "parking ఉందా?", "తర్వాత call చేయండి", "BP tablets ఆపాలా?", "ఇప్పుడు ఛాతీ నొప్పి ఎక్కువగా ఉంది",
];

const SOURCE_LABEL: Record<AudioSource, string> = {
  sarvam: "Sarvam · fresh",
  "sarvam-prebuilt": "Sarvam · pre-generated",
  "sarvam-server-cache": "Sarvam · server cache",
  "sarvam-device-cache": "Sarvam · phone cache",
  "device-voice": "DEVICE VOICE (fallback)",
  failed: "No audio (voice failed)",
};

const OUTCOME_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  change_request: "Change request → staff",
  cancel_request: "Cancel request → staff",
  do_not_call: "Do not call",
  callback: "Callback",
  pending_staff: "Pending · staff follow-up",
  appointment_booked: "Appointment booked",
  enquiry_answered: "Enquiry answered",
  not_interested: "Not interested",
  urgent_referral: "URGENT · told to call 108",
};

export default function App() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [code, setCode] = useState<string>("");
  const [codeOk, setCodeOk] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateChecking, setGateChecking] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderId, setOrderId] = useState("");
  const [tab, setTab] = useState<Tab>("call");
  const [status, setStatus] = useState<Status>("idle");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rows, setRows] = useState<TurnRow[]>([]);
  const [stage, setStage] = useState<string | null>(null);
  const [sessionOutcome, setSessionOutcome] = useState<Outcome | null>(null);
  const [usage, setUsage] = useState<SessionUsage>(emptyUsage());
  const [handsFree, setHandsFree] = useState(true);
  const [deviceFallback, setDeviceFallback] = useState(false);
  const [voiceId, setVoiceId] = useState<string>("");
  const [pace, setPace] = useState(1.0);
  const [callSound, setCallSound] = useState<CallSoundSettings>(DEFAULT_CALL_SOUND);
  /** Hospital AI calls: pre-loaded acknowledgements ("హా అండి." / "Sure."). */
  const acksRef = useRef<{ te: PlanSegment[]; en: PlanSegment[] } | null>(null);
  const ackIdxRef = useRef(0);
  const soundRef = useRef<CallSound | null>(null);
  /** Unlock audio inside a tap and route the agent's voice through the call-sound chain. */
  const unlockAudio = () => {
    playerRef.current?.unlock();
    const fx = (soundRef.current ??= new CallSound());
    fx.unlock();
    fx.attachVoice(playerRef.current?.element ?? null);
    fx.set(callSoundRef.current);
  };
  const callSoundRef = useRef(callSound);
  callSoundRef.current = callSound;
  useEffect(() => { soundRef.current?.set(callSound); }, [callSound]);
  const updateCallSound = (patch: Partial<CallSoundSettings>) => setCallSound((c) => {
    const next = { ...c, ...patch };
    ls.set("gb-callsound", JSON.stringify(next));
    return next;
  });
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [manualOptions, setManualOptions] = useState<string[] | null>(null);
  const [level, setLevel] = useState(0);
  const [outcomes, setOutcomes] = useState<{ storage: string; outcomes: Outcome[]; reports: Array<{ sessionId: string; orderId: string; outcome: string | null; usage: SessionUsage; costInr: number; savedAt: string }> } | null>(null);
  const [audition, setAudition] = useState<Array<{ label: string; segment: PlanSegment }>>([]);
  const [auditionLog, setAuditionLog] = useState<Record<string, string>>({});

  const tokenRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const interruptedRef = useRef(false);
  const startedAtRef = useRef(0);
  const closedRef = useRef(false);
  const usageRef = useRef<SessionUsage>(emptyUsage());
  const entriesRef = useRef<Entry[]>([]);
  const micRef = useRef<Mic | null>(null);
  const playerRef = useRef<ReplyPlayer | null>(null);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;

  const headers = useCallback((): Record<string, string> => (code ? { "x-pilot-code": code } : {}), [code]);
  const headersRef = useRef(headers);
  headersRef.current = headers;

  const voice = useMemo(() => ({ speaker: voiceId || cfg?.defaultVoice.speaker || "", pace }), [voiceId, cfg, pace]);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const voiceModel = cfg?.voices.find((v) => v.id === voice.speaker)?.model ?? cfg?.defaultVoice.model ?? "bulbul:v4-flash";

  // ---------- boot ----------
  useEffect(() => {
    setHandsFree(ls.get("gb-handsfree") !== "0");
    setDeviceFallback(ls.get("gb-devicefallback") === "1");
    setVoiceId(ls.get("gb-voice") ?? "");
    setPace(Number(ls.get("gb-pace") ?? 1) || 1);
    try { setCallSound({ ...DEFAULT_CALL_SOUND, ...JSON.parse(ls.get("gb-callsound") ?? "{}") }); } catch { /* defaults */ }
    const saved = ls.get("gb-pilot") ?? "";
    setCode(saved);
    fetch("/api/config").then((r) => r.json()).then((c: Config) => {
      setCfg(c);
      if (!c.pilotRequired) setCodeOk(true);
    });
    playerRef.current = new ReplyPlayer(() => headersRef.current(), { onBlocked: setBlocked });
    micRef.current = new Mic();
  }, []);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const r = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), ...headersRef.current() } });
    if (r.status === 401) {
      setCodeOk(false);
      ls.del("gb-pilot");
      throw new Error("Pilot access code required");
    }
    return r;
  }, []);

  const loadOrders = useCallback(async () => {
    const r = await api("/api/orders");
    if (r.ok) setOrders(((await r.json()) as { orders: Order[] }).orders.filter((order) => order.id.startsWith("HSP-")));
  }, [api]);
  const loadOutcomes = useCallback(async () => {
    const r = await api("/api/outcomes");
    if (r.ok) setOutcomes(await r.json());
  }, [api]);

  useEffect(() => {
    if (!cfg) return;
    if (cfg.pilotRequired && !code) return;
    api("/api/orders").then(async (r) => {
      if (r.ok) {
        setCodeOk(true);
        setOrders(((await r.json()) as { orders: Order[] }).orders.filter((order) => order.id.startsWith("HSP-")));
      }
    }).catch(() => {});
  }, [cfg, code, api]);

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [entries]);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const bumpUsage = (f: (u: SessionUsage) => void) => {
    const u = { ...usageRef.current };
    f(u);
    if (startedAtRef.current) u.sessionSeconds = Math.round((Date.now() - startedAtRef.current) / 1000);
    usageRef.current = u;
    setUsage(u);
  };
  const patchEntry = (id: string, patch: Partial<Entry>) =>
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  // ---------- speaking ----------
  const speak = useCallback(async (entryId: string, segments: PlanSegment[]) => {
    const player = playerRef.current!;
    setStatus("speaking");
    const res = await player.play(segments, voiceRef.current, { deviceFallback });
    patchEntry(entryId, { audio: res.segments });
    setRows((rs) => rs.length ? rs.map((r, i) => (i === rs.length - 1 && !r.audio ? { ...r, audio: res.segments } : r)) : rs);
    bumpUsage((u) => {
      for (const s of res.segments) {
        if (s.source === "sarvam") { u.ttsCharsBilled += s.billedChars; u.ttsSarvamRequests++; }
        else if (s.source.startsWith("sarvam-")) { u.ttsCacheHits++; u.ttsCharsReused += [...s.text].length; }
        else if (s.source === "device-voice") u.deviceVoiceSegments++;
        if (s.error && s.source !== "sarvam") u.ttsFailures += s.source === "failed" || s.source === "device-voice" ? 1 : 0;
      }
    });
    if (res.interrupted) interruptedRef.current = true;
    setStatus((st) => (st === "speaking" ? "idle" : st));
    return res;
  }, [deviceFallback]);

  // ---------- finishing ----------
  const finalize = useCallback(async () => {
    if (closedRef.current) return;
    closedRef.current = true;
    setStatus("done");
    soundRef.current?.stopAmbience();
    micRef.current?.cancel();
    bumpUsage(() => {});
    const u = usageRef.current;
    const cost = costInr(u, { model: cfg?.llm.model ?? "gpt-5.4-mini", ttsModel: voiceModel, usdInr: cfg?.usdInr ?? 88 });
    try {
      await api("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: tokenRef.current,
          usage: u,
          costInr: cost.totalInr,
          turns: entriesRef.current.map((e) => ({
            who: e.who, text: e.text, route: e.route,
            audio: e.audio?.map((a) => a.source).join(","), stt: e.stt ? `${e.stt.provider}:${e.stt.ok ? "ok" : "failed"}` : undefined,
          })),
        }),
      });
    } catch { /* report is best-effort */ }
    loadOrders().catch(() => {});
    loadOutcomes().catch(() => {});
  }, [api, cfg, voiceModel, loadOrders, loadOutcomes]);

  // ---------- one customer turn ----------
  const submit = useCallback(async (text: string, input: "voice" | "typed", stt?: SttDiag) => {
    if (busyRef.current || !tokenRef.current || closedRef.current) return;
    busyRef.current = true;
    const interrupted = interruptedRef.current;
    interruptedRef.current = false;
    const turnId = uid();
    const custId = uid();
    setEntries((es) => [...es, { id: custId, who: "customer", text: text || "(nothing recognised)", input, stt, interrupted }]);
    const rowN = usageRef.current.turns + 1;
    setRows((rs) => [...rs, { n: rowN, input, text, stt }]);
    setManualOptions(null);
    setStatus("thinking");
    let next: { segments: PlanSegment[]; agentId: string; closed: boolean } | null = null;
    // Streaming: the first sentence arrives while the model is still writing — start speaking it at once.
    let firstPlay: Promise<{ interrupted: boolean }> | null = null;
    const streamAgentId = uid();
    // Hospital AI call: say a short "హా అండి." / "Sure." the instant the caller stops — the model's answer follows.
    let ackText: string | null = null;
    let ackPlay: Promise<{ interrupted: boolean }> | null = null;
    const acks = acksRef.current;
    if (acks && text.trim()) {
      const lang = /[\u0C00-\u0C7F]/u.test(text) || /\b(?:andi|garu|cheyandi|entha|ekkada|kavali|ledu|undi)\b/iu.test(text) ? "te" : /[a-z]{3,}/iu.test(text) ? "en" : "te";
      const list = acks[lang];
      const seg = list[(ackIdxRef.current++) % list.length];
      ackText = seg.text;
      ackPlay = speak(streamAgentId, [seg]);
    }
    try {
      const r = await api("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current, text, turnId, interrupted, voice: voiceRef.current, stream: true, ackPlayed: ackText }),
      });
      let j: Record<string, any>;
      if ((r.headers.get("content-type") ?? "").includes("ndjson") && r.body) {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let fin: Record<string, any> | null = null;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            const ev = JSON.parse(line);
            if (ev.type === "first") {
              const seg = ev.segment as PlanSegment;
              setEntries((es) => [...es, { id: streamAgentId, who: "agent", text: ackText ? `${ackText} ${seg.text}` : seg.text, route: "openai", intent: null, segments: [seg] }]);
              const prior = ackPlay;
              firstPlay = prior ? prior.then((a) => (a.interrupted ? a : speak(streamAgentId, [seg]))) : speak(streamAgentId, [seg]);
            } else if (ev.type === "final") fin = ev;
            else if (ev.type === "error") throw new Error(ev.error);
          }
        }
        if (!fin) throw new Error("No reply");
        j = fin;
      } else {
        j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      tokenRef.current = j.token;
      setStage(j.stage);
      const diag = j.diag as TurnDiag;
      bumpUsage((u) => {
        u.turns++;
        if (diag.route === "workflow") u.workflowTurns++;
        else u.openaiTurns++;
        if (diag.llm?.called) {
          u.llmRequests += diag.llm.retried ? 2 : 1;
          if (!diag.llm.ok) u.llmFailures++;
          u.llmInputTokens += diag.llm.usage?.inputTokens ?? 0;
          u.llmCachedInputTokens += diag.llm.usage?.cachedInputTokens ?? 0;
          u.llmOutputTokens += diag.llm.usage?.outputTokens ?? 0;
        }
      });
      if (j.outcome) setSessionOutcome(j.outcome);
      if (diag.manualOptions) setManualOptions(diag.manualOptions);
      setRows((rs) => rs.map((x) => (x.n === rowN ? { ...x, diag, outcome: j.outcome } : x)));
      const segs = j.reply.segments as PlanSegment[];
      if (firstPlay) {
        // Same chat bubble: show the whole reply; the rest plays after the first sentence.
        setEntries((es) => es.map((e) => (e.id === streamAgentId ? { ...e, text: `${ackText ? `${ackText} ` : ""}${j.reply.fullText ?? e.text}`, route: diag.route, intent: diag.intent } : e)));
        next = { segments: segs, agentId: streamAgentId, closed: j.stage === "closed" };
      } else {
        const agentId = uid();
        setEntries((es) => [...es, { id: agentId, who: "agent", text: segs.map((s) => s.text).join(" "), route: diag.route, intent: diag.intent, segments: segs }]);
        next = { segments: segs, agentId, closed: j.stage === "closed" };
      }
    } catch (e) {
      // Transcript and stage are kept; the customer can retry or type.
      const msg = (e as Error).message;
      setRows((rs) => rs.map((x) => (x.n === rowN ? { ...x, error: msg } : x)));
      setEntries((es) => [...es, { id: uid(), who: "agent", text: "", error: `Turn failed: ${msg}. Your words and the conversation stage are kept — try again or type.` }]);
      setStatus("idle");
    } finally {
      busyRef.current = false;
    }
    if (!firstPlay && ackPlay) firstPlay = ackPlay; // no early sentence: the ack plays, then the whole reply
    if (!next) { if (firstPlay) await firstPlay; return; }
    let res: { interrupted: boolean } = { interrupted: false };
    if (firstPlay) res = await firstPlay;
    if (!res.interrupted && next.segments.length) res = await speak(next.agentId, next.segments);
    if (next.closed) return finalize();
    if (handsFreeRef.current && !res.interrupted) listenRef.current?.();
  }, [api, speak, finalize]);

  // ---------- listening ----------
  const listen = useCallback(async () => {
    const mic = micRef.current!;
    if (!tokenRef.current || closedRef.current || busyRef.current || mic.active) return;
    try {
      await mic.init();
    } catch (e) {
      setNotice((e as Error).message + " You can still type below.");
      setStatus("idle");
      return;
    }
    setStatus("listening");
    const recordings: { blob: Blob; ms: number }[] = [];
    let cap;
    do {
      cap = await mic.capture({ auto: handsFreeRef.current, onLevel: (level) => setLevel(level) });
      if (cap.blob) recordings.push({ blob: cap.blob, ms: cap.ms });
      if (cap.reason === "max") setNotice("Still listening. Tap the mic when you're finished.");
    } while (cap.reason === "max" && cap.hadSpeech && !closedRef.current);
    setLevel(0);
    if (closedRef.current) return;
    if (cap.reason === "cancelled") { setStatus("idle"); return; }
    if (!recordings.length) {
      setStatus("idle");
      if (cap.reason === "no-speech") setNotice("Didn't hear anything — tap the mic to talk (no recognition request was sent).");
      return;
    }
    setNotice(null);
    const seconds = recordings.reduce((sum, recording) => sum + Math.ceil(recording.ms / 1000), 0);
    setStatus("transcribing");
    let stt: SttDiag;
    try {
      const transcripts: string[] = [];
      let latencyMs = 0;
      let model = "";
      let mode = "";
      for (const recording of recordings) {
        const fd = new FormData();
        fd.append("file", await recordingToWav(recording.blob), "utterance.wav");
        bumpUsage((u) => { u.sttRequests++; u.sttSecondsBilled += Math.ceil(recording.ms / 1000); });
        const r = await api("/api/stt", { method: "POST", body: fd });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error?.summary ?? j.error ?? "Recognition failed");
        transcripts.push(j.transcript);
        latencyMs += j.latencyMs ?? 0;
        model = j.model ?? model;
        mode = j.mode ?? mode;
      }
      stt = { ok: true, provider: "Sarvam", model, mode, latencyMs, seconds, error: null, transcript: transcripts.join(" ") };
    } catch (e) {
      stt = { ok: false, provider: "Sarvam", model: cfg?.stt.model ?? "?", mode: "", latencyMs: 0, seconds, error: (e as Error).message };
    }
    if (!stt.ok) {
      bumpUsage((u) => { u.sttFailures++; });
      setEntries((es) => [...es, { id: uid(), who: "customer", text: "", input: "voice", stt, error: `Speech recognition failed: ${stt.error}. Stage kept — tap the mic again or type.` }]);
      setRows((rs) => [...rs, { n: usageRef.current.turns + 0.5, input: "voice", text: "", stt, error: stt.error ?? "STT failed" }]);
      setStatus("idle");
      return;
    }
    await submit(stt.transcript ?? "", "voice", stt);
  }, [api, cfg, submit]);
  const listenRef = useRef<(() => void) | null>(null);
  listenRef.current = () => { void listen(); };

  // ---------- session control ----------
  const selectedOrderId = orders.find((order) => order.id === orderId)?.id ?? orders[0]?.id;
  const startingRef = useRef(false);
  const startSession = useCallback(async () => {
    if (!selectedOrderId || startingRef.current) return;
    startingRef.current = true;
    unlockAudio();
    soundRef.current?.startAmbience();
    if (handsFree) micRef.current?.init().catch((e) => setNotice((e as Error).message + " You can still type below."));
    setStatus("starting");
    setEntries([]);
    setRows([]);
    setSessionOutcome(null);
    setManualOptions(null);
    setNotice(null);
    closedRef.current = false;
    interruptedRef.current = false;
    usageRef.current = emptyUsage();
    setUsage(emptyUsage());
    startedAtRef.current = Date.now();
    try {
      const r = await api("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: selectedOrderId, voice: voiceRef.current }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      tokenRef.current = j.token;
      acksRef.current = j.acks ?? null;
      if (j.acks) void playerRef.current?.prefetch([...j.acks.te, ...j.acks.en], voiceRef.current);
      setStage(j.stage);
      const agentId = uid();
      const segs = j.reply.segments as PlanSegment[];
      setEntries([{ id: agentId, who: "agent", text: segs.map((s) => s.text).join(" "), route: "workflow", intent: "opening", segments: segs }]);
      setRows([{ n: 0, input: "typed", text: "(session start)" }]);
      const res = await speak(agentId, segs);
      if (handsFreeRef.current && !res.interrupted) void listen();
    } catch (e) {
      setNotice(`Could not start: ${(e as Error).message}`);
      setStatus("idle");
    } finally {
      startingRef.current = false;
    }
  }, [api, handsFree, selectedOrderId, speak, listen]);

  const endSession = useCallback(() => {
    playerRef.current?.stop();
    soundRef.current?.stopAmbience();
    micRef.current?.cancel();
    if (tokenRef.current) void finalize();
  }, [finalize]);

  const orbTap = useCallback(() => {
    unlockAudio();
    const mic = micRef.current!;
    if (!tokenRef.current || status === "done") return void startSession();
    if (status === "speaking") {
      // Barge-in: stop the agent and listen.
      interruptedRef.current = true;
      playerRef.current?.stop();
      setTimeout(() => void listen(), 60);
      return;
    }
    if (status === "listening" && mic.active) return mic.finish();
    if (status === "idle") void listen();
  }, [status, startSession, listen]);

  const sendTyped = useCallback((t: string) => {
    const text = t.trim();
    if (!text) return;
    if (playerRef.current?.playing) {
      interruptedRef.current = true;
      playerRef.current.stop();
    }
    micRef.current?.cancel();
    setTyped("");
    setTimeout(() => void submit(text, "typed"), 30);
  }, [submit]);

  const replay = useCallback(async (e: Entry) => {
    if (!e.segments || playerRef.current?.playing) return;
    unlockAudio();
    await speak(e.id, e.segments);
  }, [speak]);

  // ---------- voices ----------
  const loadAudition = useCallback(async (speaker: string, p: number) => {
    const r = await api("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice: { speaker, pace: p } }) });
    if (r.ok) setAudition(((await r.json()) as { lines: Array<{ label: string; segment: PlanSegment }> }).lines);
  }, [api]);
  useEffect(() => { if (tab === "voices" && codeOk && cfg) void loadAudition(voice.speaker, pace); }, [tab, codeOk, cfg, voice.speaker, pace, loadAudition]);
  useEffect(() => { if (tab === "outcomes" && codeOk) void loadOutcomes(); }, [tab, codeOk, loadOutcomes]);

  const playAudition = async (label: string, seg: PlanSegment) => {
    unlockAudio();
    setAuditionLog((l) => ({ ...l, [label]: "loading…" }));
    const res = await playerRef.current!.play([seg], voiceRef.current, { deviceFallback: false });
    const s = res.segments[0];
    if (s.source === "sarvam") bumpUsage((u) => { u.ttsCharsBilled += s.billedChars; u.ttsSarvamRequests++; });
    setAuditionLog((l) => ({ ...l, [label]: `${SOURCE_LABEL[s.source]}${s.speaker ? ` · ${s.speaker}` : ""}${s.billedChars ? ` · ${s.billedChars} chars billed` : ""}${s.error ? ` · ${s.error}` : ""}` }));
  };

  // ---------- derived ----------
  const cost = costInr(usage, { model: cfg?.llm.model ?? "gpt-5.4-mini", ttsModel: voiceModel, usdInr: cfg?.usdInr ?? 88 });
  const order = orders.find((o) => o.id === selectedOrderId);
  const lastAudio = [...entries].reverse().find((e) => e.who === "agent" && e.audio)?.audio;
  const lastLlm = [...rows].reverse().find((r) => r.diag?.llm?.called)?.diag?.llm;
  const lastStt = [...rows].reverse().find((r) => r.stt)?.stt;
  const inSession = status === "starting" || (!!tokenRef.current && status !== "done");

  // ---------- gate ----------
  if (cfg && cfg.pilotRequired && !codeOk) {
    return (
      <main className="wrap gate">
        <Brand />
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            const typed = codeInput.trim();
            if (!typed) { setGateError("Type the access code first."); return; }
            setGateChecking(true);
            setGateError(null);
            try {
              // Check the code directly, so a wrong code always shows a message (even if typed twice).
              const r = await fetch("/api/orders", { headers: { "x-pilot-code": typed } });
              if (r.status === 401) {
                setGateError(cfg?.pilotHint === "placeholder"
                  ? "Code not accepted. Your .env.local still has PILOT_ACCESS_CODE=change-me — type change-me, or set your own code and restart npm run dev."
                  : "Code not accepted. It must match PILOT_ACCESS_CODE in .env.local exactly. If you just edited .env.local, stop the server (Ctrl+C) and run npm run dev:3001 again.");
                return;
              }
              if (!r.ok) { setGateError(`Server error (HTTP ${r.status}). Check the terminal running npm run dev.`); return; }
              ls.set("gb-pilot", typed);
              setOrders(((await r.json()) as { orders: Order[] }).orders.filter((order) => order.id.startsWith("HSP-")));
              setCode(typed);
              setCodeOk(true);
            } catch {
              setGateError("Could not reach the local server. Is npm run dev:3001 still running?");
            } finally {
              setGateChecking(false);
            }
          }}
        >
          <h2>Pilot access</h2>
          <p className="muted">Enter the private pilot code to use the paid voice endpoints.</p>
          <input className="input" type="password" autoComplete="off" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Access code" aria-label="Access code" />
          <button className="btn primary" type="submit" disabled={gateChecking}>{gateChecking ? "Checking…" : "Continue"}</button>
          {gateError && <p className="bad small" role="alert">{gateError}</p>}
        </form>
      </main>
    );
  }

  const orbLabel: Record<Status, string> = {
    idle: inSession ? "Tap to talk" : "Start call",
    starting: "Starting…",
    listening: handsFree ? "Listening… (tap to send)" : "Recording… tap to send",
    transcribing: "Recognising…",
    thinking: "Thinking…",
    speaking: "Speaking · tap to interrupt",
    done: "Call ended · tap to restart",
  };

  return (
    <main className="wrap">
      <header className="top">
        <Brand />
        <div className="chips">
          <Chip ok={cfg?.providers.sarvamKeySet} label="Sarvam" />
          <Chip ok={cfg?.providers.openaiKeySet} label="OpenAI" />
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {(["call", "outcomes", "voices", "diag"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "tab on" : "tab"} onClick={() => setTab(t)}>
            {t === "call" ? "Call" : t === "outcomes" ? "Outcomes" : t === "voices" ? "Voices" : "Diagnostics"}
          </button>
        ))}
      </nav>

      {tab === "call" && (
        <>
          <section className="orders" aria-label="Sample orders">
            {orders.map((o) => (
              <button key={o.id} className={o.id === selectedOrderId ? "order on" : "order"} disabled={inSession} onClick={() => setOrderId(o.id)}>
                <span className="oid">{o.workflow === "hospital" ? "🏥 Hospital · " : "🛒 Shop · "}{o.id}</span>
                <span className="oname">{o.customerName} · {o.city}</span>
                <span className="oitems">{o.items.map((i) => i.nameTe).join(", ")}</span>
                <span className="ototal">{o.workflow === "hospital" ? `Fee ₹${o.total}` : `₹${o.total}`}</span>
                {o.lastOutcome && <span className="obadge">{OUTCOME_LABEL[o.lastOutcome.kind]}</span>}
              </button>
            ))}
          </section>

          <section className="stagebar">
            <span>Stage: <b>{stage ?? "—"}</b></span>
            <label className="toggle">
              <input type="checkbox" checked={handsFree} onChange={(e) => { setHandsFree(e.target.checked); ls.set("gb-handsfree", e.target.checked ? "1" : "0"); }} />
              Hands-free
            </label>
          </section>

          <section className="orbzone">
            <button className={`orb ${status}`} onClick={orbTap} aria-label={orbLabel[status]} style={{ ["--lvl" as string]: Math.min(1, level * 12) }}>
              <span className="orbcore" />
            </button>
            <div className="orblabel">{orbLabel[status]}</div>
            {blocked && (
              <button className="btn primary" onClick={() => playerRef.current?.resume()}>▶ Tap to play the agent's reply</button>
            )}
            {inSession && <button className="btn ghost small" onClick={endSession}>End call</button>}
            {notice && <p className="notice" role="status">{notice}</p>}
          </section>

          <section className="transcript" aria-label="Live transcript">
            {entries.length === 0 && <p className="muted center">Pick an order and start the call. The agent speaks first.</p>}
            {entries.map((e) => (
              <div key={e.id} className={`bubble ${e.who}${e.error ? " err" : ""}`}>
                {e.text && <div className="btext" lang="te">{e.text}</div>}
                {e.error && <div className="berr">{e.error}</div>}
                <div className="bmeta">
                  {e.who === "customer" && (
                    <>
                      <span className="tag">{e.input === "voice" ? `🎙 ${e.stt?.provider ?? "Sarvam"} ${e.stt?.model ?? ""}${e.stt?.ok === false ? " · FAILED" : ""}` : "⌨ typed"}</span>
                      {e.interrupted && <span className="tag warn">interrupted agent</span>}
                    </>
                  )}
                  {e.who === "agent" && e.route && (
                    <span className={`tag ${e.route === "openai_failed" ? "bad" : ""}`}>
                      {e.route === "workflow" ? "workflow" : e.route === "openai" ? "OpenAI" : "OpenAI FAILED → clarify"}
                      {e.intent ? ` · ${e.intent}` : ""}
                    </span>
                  )}
                  {e.audio && <AudioTags audio={e.audio} />}
                  {e.who === "agent" && e.segments && (
                    <button className="linkbtn" onClick={() => replay(e)} aria-label="Play this reply">▶ play</button>
                  )}
                </div>
              </div>
            ))}
            <div ref={transcriptEnd} />
          </section>

          {manualOptions && (
            <section className="manual">
              <p className="muted">Couldn&apos;t understand that automatically. Tap an option or type:</p>
              <div className="chiprow">
                {manualOptions.map((m) => <button key={m} className="chipbtn" onClick={() => sendTyped(m)}>{m}</button>)}
              </div>
            </section>
          )}

          <form className="typebar" onSubmit={(e) => { e.preventDefault(); sendTyped(typed); }}>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={inSession ? "Type a reply (skips speech recognition)" : "Start the call first"} disabled={!inSession} lang="te" aria-label="Typed reply" />
            <button className="btn primary" type="submit" disabled={!inSession || !typed.trim()}>Send</button>
          </form>
          <details className="phrases">
            <summary>Test phrases (typed)</summary>
            <div className="chiprow">
              {(order?.workflow === "hospital" ? HOSPITAL_TEST_PHRASES : TEST_PHRASES).map((p) => <button key={p} className="chipbtn" disabled={!inSession} onClick={() => sendTyped(p)}>{p}</button>)}
            </div>
          </details>

          {sessionOutcome && (
            <section className="card outcome">
              <h3>Outcome recorded</h3>
              <p><b>{OUTCOME_LABEL[sessionOutcome.kind]}</b>{sessionOutcome.detail ? ` — ${sessionOutcome.detail}` : ""}{sessionOutcome.callbackTime ? ` — ${sessionOutcome.callbackTime}` : ""}</p>
              <p className="muted small">Order {sessionOutcome.orderId} · turn {sessionOutcome.turn} · via {sessionOutcome.route} · “{sessionOutcome.customerWords}”</p>
            </section>
          )}

          <UsageCard usage={usage} cost={cost} />
          {order && <p className="muted small center">Order data comes from the app ({order.items.length} items, ₹{order.total}); the model never sets totals.</p>}
        </>
      )}

      {tab === "outcomes" && (
        <section>
          <p><a className="btn small" href={`/api/calls?code=${encodeURIComponent(code)}`} download>⬇ Download call log (CSV)</a> <span className="muted small">Every call: phone, name, language, outcome, booked date, questions for reception, transcript.</span></p>
          {outcomes && !["file", "upstash"].includes(outcomes.storage) && (
            <p className="notice">Storage: in-memory (not persistent on Vercel). Add Upstash or Supabase for durable outcomes.</p>
          )}
          <h3>Outcomes</h3>
          {!outcomes?.outcomes.length && <p className="muted">No outcomes yet.</p>}
          {outcomes?.outcomes.map((o) => (
            <div className="card" key={o.sessionId}>
              <b>{o.orderId}</b> · {OUTCOME_LABEL[o.kind]}
              {o.detail && <div>Detail: {o.detail}</div>}
              {o.callbackTime && <div>Callback: {o.callbackTime}</div>}
              <div className="muted small">“{o.customerWords}” · {o.route} · {new Date(o.recordedAt).toLocaleString()}</div>
            </div>
          ))}
          <h3>Session usage reports</h3>
          {outcomes?.reports.map((r) => (
            <div className="card small" key={r.sessionId}>
              <b>{r.orderId}</b> · {r.outcome ?? "no outcome"} · {r.usage.turns} turns · {r.usage.sessionSeconds}s
              <div className="muted">
                LLM {r.usage.llmRequests} req ({r.usage.llmInputTokens} in / {r.usage.llmOutputTokens} out tok) · Sarvam TTS {r.usage.ttsCharsBilled} chars (+{r.usage.ttsCharsReused} reused) · STT {r.usage.sttSecondsBilled}s · {inr(r.costInr)}
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === "voices" && cfg && (
        <section>
          <p className="muted">Audition Sarvam voices (your cloned voice is the default when <code>SARVAM_CLONE_VOICE_ID</code> is set). Your choice is used for the whole conversation.</p>
          <label className="field">Voice
            <select className="input" value={voice.speaker} onChange={(e) => { setVoiceId(e.target.value); ls.set("gb-voice", e.target.value); }}>
              {cfg.voices.map((v) => <option key={v.id} value={v.id}>{v.label} · ₹{v.inrPer1kChars}/1K chars</option>)}
            </select>
          </label>
          <label className="field">Pace {pace.toFixed(2)}
            <input type="range" min={0.8} max={1.2} step={0.05} value={pace} onChange={(e) => { setPace(Number(e.target.value)); ls.set("gb-pace", e.target.value); }} />
          </label>
          <div className="card">
            <b>Call sound</b>
            <p className="muted small">Makes the call feel like a real person on the phone. Runs in the browser; no extra cost.</p>
            <label className="toggle">
              <input type="checkbox" checked={callSound.ambience} onChange={(e) => updateCallSound({ ambience: e.target.checked })} />
              Hospital office background (murmur, keyboard, room tone)
            </label>
            {callSound.ambience && (
              <label className="field">Background level {Math.round(callSound.ambienceLevel * 100)}%
                <input type="range" min={0.05} max={1} step={0.05} value={callSound.ambienceLevel} onChange={(e) => updateCallSound({ ambienceLevel: Number(e.target.value) })} />
              </label>
            )}
            <label className="toggle">
              <input type="checkbox" checked={callSound.phoneLine} onChange={(e) => updateCallSound({ phoneLine: e.target.checked })} />
              Phone-line sound for the agent&apos;s voice
            </label>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={deviceFallback} onChange={(e) => { setDeviceFallback(e.target.checked); ls.set("gb-devicefallback", e.target.checked ? "1" : "0"); }} />
            Allow phone voice if Sarvam fails (clearly labelled as fallback)
          </label>
          {audition.map((l) => (
            <div className="card" key={l.label}>
              <div className="row">
                <b>{l.label}</b>
                <button className="btn small" onClick={() => playAudition(l.label, l.segment)}>▶ Play</button>
              </div>
              <div lang="te">{l.segment.text}</div>
              <div className="muted small">{auditionLog[l.label] ?? (l.segment.prebuiltUrl ? "pre-generated (free)" : `${l.segment.chars} chars if not cached`)}</div>
            </div>
          ))}
        </section>
      )}

      {tab === "diag" && cfg && (
        <section className="diag">
          <div className="card">
            <h3>Providers</h3>
            <table><tbody>
              <tr><th>Recognition</th><td>{cfg.stt.provider} {cfg.stt.model} ({cfg.stt.mode}, {cfg.stt.language}) · key {cfg.providers.sarvamKeySet ? "set" : "MISSING"}</td></tr>
              <tr><th>Last recognition</th><td>{lastStt ? `${lastStt.provider} ${lastStt.model} · ${lastStt.ok ? "OK" : "FAILED"} · ${lastStt.seconds}s audio · ${lastStt.latencyMs} ms${lastStt.error ? ` · ${lastStt.error}` : ""}` : "—"}</td></tr>
              <tr><th>Understanding</th><td>OpenAI {cfg.llm.model} · effort {cfg.llm.effort} · max {cfg.llm.maxOutputTokens} out tok · key {cfg.providers.openaiKeySet ? "set" : "MISSING"}</td></tr>
              <tr><th>Last OpenAI call</th><td>{lastLlm ? (lastLlm.ok ? `OK · ${lastLlm.usage?.inputTokens} in / ${lastLlm.usage?.outputTokens} out · ${lastLlm.latencyMs} ms${lastLlm.retried ? " · retried once" : ""}` : `FAILED · ${lastLlm.error?.summary}`) : "none yet (clear replies use the workflow)"}</td></tr>
              <tr><th>Voice</th><td>Sarvam {voiceModel} · {voice.speaker} · pace {pace} · device fallback {deviceFallback ? "ON" : "off"}</td></tr>
              <tr><th>Last playback</th><td>{lastAudio ? <AudioTags audio={lastAudio} /> : "—"}</td></tr>
              <tr><th>Storage</th><td>{cfg.storage.kind}{cfg.storage.persistent ? "" : " (not persistent)"}</td></tr>
            </tbody></table>
          </div>
          <h3>Turns</h3>
          {rows.map((r) => (
            <div className="card small" key={r.n}>
              <div><b>#{r.n}</b> {r.input === "voice" ? "🎙" : "⌨"} <span lang="te">{r.text}</span></div>
              {r.stt && <div>Recognition: {r.stt.provider} {r.stt.model} · {r.stt.ok ? "OK" : "FAILED"} · {r.stt.seconds}s · {r.stt.latencyMs} ms</div>}
              {r.diag && (
                <div>
                  Route: <b>{r.diag.route}</b>{r.diag.intent ? ` → ${r.diag.intent}` : ""}
                  {r.diag.llmReason && <span className="muted"> (sent to LLM: {r.diag.llmReason})</span>}
                </div>
              )}
              {r.diag?.llm?.called && (
                <div>
                  OpenAI: {r.diag.llm.ok ? "OK" : "FAILED"} · {r.diag.llm.usage ? `${r.diag.llm.usage.inputTokens} in / ${r.diag.llm.usage.outputTokens} out tok · ` : ""}{r.diag.llm.latencyMs} ms
                  {r.diag.llm.retried && " · retried once"}
                  {r.diag.llm.error && <div className="bad">{r.diag.llm.error.summary}</div>}
                  {r.diag.llm.raw && <div className="muted mono">{r.diag.llm.raw}</div>}
                </div>
              )}
              {r.audio && <div>Audio: <AudioTags audio={r.audio} /></div>}
              {r.outcome && <div className="good">Outcome: {r.outcome.kind}</div>}
              {r.error && <div className="bad">{r.error}</div>}
            </div>
          ))}
          <UsageCard usage={usage} cost={cost} />
        </section>
      )}
    </main>
  );
}

function Brand() {
  return (
    <div className="brand">
      
      <div>
        <div className="bname">ALG</div>
        <div className="bsub">Ravi · Sai Viswas Hospital</div>
      </div>
    </div>
  );
}

function Chip({ ok, label }: { ok: boolean | undefined; label: string }) {
  return <span className={`chip ${ok ? "ok" : ok === false ? "bad" : ""}`}>{label} {ok ? "key ✓" : ok === false ? "no key" : "…"}</span>;
}

function AudioTags({ audio }: { audio: SegmentPlayback[] }) {
  return (
    <>
      {audio.map((a, i) => (
        <span key={i} className={`tag ${a.source === "device-voice" || a.source === "failed" ? "bad" : a.source === "sarvam" ? "" : "good"}`} title={a.error ?? a.text}>
          🔊 {SOURCE_LABEL[a.source]}{a.speaker ? ` · ${a.speaker}` : ""}{a.billedChars ? ` · ${a.billedChars}ch` : ""}{a.interrupted ? " · cut" : ""}
        </span>
      ))}
    </>
  );
}

function UsageCard({ usage, cost }: { usage: SessionUsage; cost: ReturnType<typeof costInr> }) {
  return (
    <section className="card usage" aria-label="Session usage">
      <h3>This session</h3>
      <div className="grid">
        <div><span className="k">Turns</span><span className="v">{usage.turns} ({usage.workflowTurns} workflow · {usage.openaiTurns} OpenAI)</span></div>
        <div><span className="k">LLM requests</span><span className="v">{usage.llmRequests}{usage.llmFailures ? ` (${usage.llmFailures} failed)` : ""}</span></div>
        <div><span className="k">LLM tokens</span><span className="v">{usage.llmInputTokens} in · {usage.llmOutputTokens} out</span></div>
        <div><span className="k">Sarvam TTS</span><span className="v">{usage.ttsCharsBilled} chars billed · {usage.ttsCharsReused} reused</span></div>
        <div><span className="k">Sarvam STT</span><span className="v">{usage.sttRequests} req · {usage.sttSecondsBilled}s</span></div>
        <div><span className="k">Device voice</span><span className="v">{usage.deviceVoiceSegments} segments</span></div>
        <div><span className="k">Est. cost</span><span className="v">{inr(cost.totalInr)} (LLM {inr(cost.llmInr)} · TTS {inr(cost.ttsInr)} · STT {inr(cost.sttInr)})</span></div>
        <div><span className="k">Per minute</span><span className="v">{cost.perMinuteInr !== null ? inr(cost.perMinuteInr) : "—"} over {usage.sessionSeconds}s</span></div>
      </div>
    </section>
  );
}

async function recordingToWav(recording: Blob): Promise<Blob> {
  const context = new OfflineAudioContext(1, 1, 16000);
  const decoded = await context.decodeAudioData(await recording.arrayBuffer());
  const samples = decoded.getChannelData(0);
  const dataSize = samples.length * 2;
  const wav = new DataView(new ArrayBuffer(44 + dataSize));

  wav.setUint32(0, 0x52494646); // RIFF
  wav.setUint32(4, 36 + dataSize, true);
  wav.setUint32(8, 0x57415645); // WAVE
  wav.setUint32(12, 0x666d7420); // fmt
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); // PCM
  wav.setUint16(22, 1, true); // mono
  wav.setUint32(24, decoded.sampleRate, true);
  wav.setUint32(28, decoded.sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  wav.setUint32(36, 0x64617461); // data
  wav.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    wav.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true);
  }

  return new Blob([wav.buffer], { type: "audio/wav" });
}
