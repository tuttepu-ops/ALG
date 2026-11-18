"use client";

import { useEffect, useState } from "react";
import type { AlgCall } from "@/lib/storage/alg";
import "./dashboard.css";

const tabs = ["Overview", "Agents", "Test calls", "Call logs", "Settings"] as const;
type Tab = typeof tabs[number];
const samples: AlgCall[] = [
  { id: "sample-1", channel: "phone", status: "Completed", destination: "+91 ••••••0321", seconds: 134, cost_inr: 4.72, response_ms: 1300, transcript: [{who:"ravi",text:"నమస్కారం అండి, సాయి విశ్వాస్ హాస్పిటల్ నుంచి రవి మాట్లాడుతున్నాను."}] },
  { id: "sample-2", channel: "phone", status: "No answer", destination: "+91 ••••••0764", seconds: 0 },
  { id: "sample-3", channel: "browser", status: "Completed", seconds: 98, cost_inr: 2.12, response_ms: 1420 },
];
const money = (n: number | null | undefined) => n == null ? "—" : `₹${Number(n).toFixed(2)}`;
const time = (n?: number) => n == null ? "—" : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [code, setCode] = useState("");
  const [activeCode, setActiveCode] = useState("");
  const [calls, setCalls] = useState<AlgCall[]>([]);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [number, setNumber] = useState("");
  const [dialing, setDialing] = useState(false);
  const [selected, setSelected] = useState<AlgCall>();
  const [recording, setRecording] = useState("");
  const [days, setDays] = useState(7);
  const headers = (value = activeCode) => ({ "x-pilot-code": value, "Content-Type": "application/json" });
  const shown = connected ? calls.filter((call) => !call.started_at || Date.now() - Date.parse(call.started_at) <= days * 86400000) : samples;
  const phoneCalls = shown.filter((call) => call.channel === "phone");
  const answered = phoneCalls.filter((call) => ["Connected", "Completed"].includes(call.status ?? "")).length;
  const latencies = shown.flatMap((call) => call.response_ms == null ? [] : [call.response_ms]);
  const costed = shown.filter((call) => call.cost_inr != null && (call.seconds ?? 0) > 0);
  const costPerMinute = costed.length ? costed.reduce((sum, call) => sum + Number(call.cost_inr), 0) * 60 /
    costed.reduce((sum, call) => sum + (call.seconds ?? 0), 0) : null;

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    try {
      const response = await fetch("/api/alg", { headers: headers(code) });
      const result = await response.json();
      if (!response.ok || !result.configured) throw new Error(result.error ?? "Configure Supabase to load live call logs.");
      setCalls(result.calls);
      setActiveCode(code);
      setConnected(true);
      setNotice("Live logs connected.");
    } catch (error) { setNotice((error as Error).message); }
  }

  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/alg", { headers: { "x-pilot-code": activeCode } });
        if (response.ok && !stopped) setCalls((await response.json()).calls);
      } catch {}
    }, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [connected, activeCode]);

  async function dial(event: React.FormEvent) {
    event.preventDefault();
    setDialing(true);
    try {
      const response = await fetch("/api/alg/phone", { method: "POST", headers: headers(), body: JSON.stringify({ to: number.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not start test.");
      setNotice("Vobiz accepted the request. Pick up your test phone.");
    } catch (error) { setNotice((error as Error).message); }
    finally { setDialing(false); }
  }

  async function openCall(call: AlgCall) {
    setSelected(call);
    setRecording("");
    if (!call.recording) return;
    try {
      const result = await fetch(`/api/alg?recording=${encodeURIComponent(call.id)}`, { headers: headers() });
      const payload = await result.json();
      if (!result.ok) throw new Error(payload.error ?? "Recording unavailable.");
      setRecording(payload.url);
    } catch (error) { setNotice((error as Error).message); }
  }

  const activity = connected ? Array.from({ length: 7 }, (_, index) => {
    const start = Date.now() - (7 - index) * days * 86400000 / 7;
    const end = start + days * 86400000 / 7;
    return phoneCalls.filter((item) => {
      const stamp = Date.parse(item.started_at ?? "");
      return stamp >= start && stamp < end;
    }).length;
  }) : [12, 18, 16, 21, 24, 33, 28];
  const maximum = Math.max(1, ...activity);

  function testCard() {
    return <section className="alg-card"><h2>Test Ravi</h2><p>Sai Viswas Hospital · Telugu + English</p>
      <div className="alg-wave" aria-hidden="true">{[10,17,29,15,37,44,24,53,37,16,24,12,29,16,9].map((h,i) => <i key={i} style={{height:h}} />)}</div>
      <div className="alg-actions"><button onClick={() => setTab("Test calls")}>Test by phone</button><a href="/browser-test">Test in browser</a></div></section>;
  }

  function logTable(all = false) {
    return <section className="alg-table-section"><div className="alg-table-heading"><h2>{all ? "Call logs" : "Recent calls"}</h2>
      {!all && <button className="alg-secondary" onClick={() => setTab("Call logs")}>View call logs</button>}</div>
      {shown.length ? <div className="alg-table-wrap"><table><thead><tr><th>Date</th><th>Agent</th><th>Destination</th><th>Status</th><th>Duration</th><th>Cost</th></tr></thead>
        <tbody>{shown.slice(0, all ? 250 : 5).map((call) => <tr key={call.id}>
          <td><button className="alg-text" onClick={() => openCall(call)}>{call.started_at ? new Date(call.started_at).toLocaleString("en-IN") : "Sample call"}</button></td>
          <td>Ravi</td><td>{call.destination ?? "Browser mic"}</td><td><span className="alg-badge">{call.status}</span></td>
          <td>{time(call.seconds)}</td><td>{money(call.cost_inr)}</td></tr>)}</tbody></table></div> : <p>No calls in this period.</p>}</section>;
  }

  return <div className="alg"><div className="alg-frame">
    <aside className="alg-sidebar"><strong>ALG<span>.</span></strong><nav aria-label="Dashboard">{tabs.map((item,index) => <button key={item} aria-current={tab === item ? "page" : undefined} onClick={() => {setTab(item); setSelected(undefined);}}><span aria-hidden="true">{["▥","◎","☎","≡","⚙"][index]}</span>{item}</button>)}</nav></aside>
    <main><header className="alg-hero"><div><small>{connected ? "Live workspace" : "Demo workspace"}</small><h1>{tab === "Overview" ? "Voice agent overview" : tab}</h1></div>
      <select aria-label="Date range" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></header>
      <div className="alg-content">
        {notice && <p className="alg-notice" role="status">{notice}</p>}
        {tab === "Overview" && <><div className="alg-grid">
          <section className="alg-card"><h2>Call activity</h2><p>{phoneCalls.length} outbound calls in view</p>
            <div className="alg-chart" aria-label="Outbound calls by time interval">{activity.map((n,i) => <div key={i} title={`${n} calls`}><i style={{height:`${Math.max(2, n / maximum * 100)}%`}} /></div>)}</div></section>
          {testCard()}
          <section className="alg-card"><h2>Connection rate</h2><div className="alg-ring" style={{"--rate": `${phoneCalls.length ? answered / phoneCalls.length * 100 : 0}%`} as React.CSSProperties}><b>{phoneCalls.length ? `${Math.round(answered / phoneCalls.length * 100)}%` : "—"}</b></div>
            <p className="alg-metric">Response time <b>{latencies.length ? `${(latencies.reduce((a,b) => a+b,0) / latencies.length / 1000).toFixed(1)} s` : "—"}</b></p>
            <p className="alg-metric">Tracked cost / min <b>{money(costPerMinute)}</b></p></section>
        </div>{logTable()}</>}
        {tab === "Agents" && <div className="alg-panel">{testCard()}</div>}
        {tab === "Call logs" && logTable(true)}
        {tab === "Test calls" && <section className="alg-card alg-panel"><h2>Call a test phone</h2><p>Use an approved Indian mobile number.</p>
          <form className="alg-form" onSubmit={dial}><label>Test number<input type="tel" placeholder="+91XXXXXXXXXX" value={number} onChange={(event) => setNumber(event.target.value)} required /></label>
            <button disabled={!connected || dialing}>{dialing ? "Dialing…" : "Call test number"}</button></form>
          {!connected && <button className="alg-secondary" onClick={() => setTab("Settings")}>Unlock live testing</button>}
          <a className="alg-link" href="/browser-test">Open browser mic test</a></section>}
        {tab === "Settings" && <section className="alg-card alg-panel"><h2>Live workspace access</h2><p>Use the pilot access code configured on the server.</p>
          <form className="alg-form" onSubmit={unlock}><label>Pilot code<input type="password" value={code} onChange={(event) => setCode(event.target.value)} required /></label><button>Connect live workspace</button></form>
          {connected && <button className="alg-secondary" onClick={() => {setConnected(false);setActiveCode("");setCode("");setCalls([]);setNotice("");}}>Lock workspace</button>}</section>}
        {selected && <section className="alg-card alg-details"><div className="alg-table-heading"><h2>Call details</h2><button className="alg-secondary" onClick={() => setSelected(undefined)}>Close</button></div>
          {recording && <audio key={recording} controls preload="metadata" src={recording} />}
          {selected.outcome != null && <p><b>Outcome</b> {typeof selected.outcome === "string" ? selected.outcome : String((selected.outcome as {kind?: string}).kind ?? "")}</p>}
          {selected.transcript?.length ? selected.transcript.map((line,i) => <p key={i}><b>{line.who === "ravi" || line.who === "agent" ? "Ravi" : "Caller"}</b> {line.text}</p>) : <p>No transcript available.</p>}</section>}
      </div>
    </main>
  </div></div>;
}
