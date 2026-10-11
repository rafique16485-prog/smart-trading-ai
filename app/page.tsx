"use client";
import {useCallback, useEffect, useState} from "react";

type Quote = { instrument_key?: string; last_price?: number | string; prev_close_price?: number | string; timestamp?: string | number | null };
type Status = { connected?: boolean; reason?: string; message?: string; verdict?: string };

const navItems = ["Dashboard","Live Scanner","News Scanner","Watchlist","TradingView","WhatsApp","Risk Calculator","Settings"];
const fmt = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? "₹" + n.toLocaleString("en-IN",{maximumFractionDigits:2}) : "—"; };

export default function Home(){
 const [tab,setTab]=useState("Dashboard");
 const [status,setStatus]=useState<Status>({connected:false,reason:"checking"});
 const [quotes,setQuotes]=useState<Quote[]>([]);
 const [notice,setNotice]=useState("Upstox connection check pending. Connect Upstox to load verified market data.");
 const [busy,setBusy]=useState(false);

 const refresh = useCallback(async()=>{
  try {
   const sr = await fetch("/api/upstox/status",{cache:"no-store"});
   const sd:Status = await sr.json();
   setStatus(sd);
   if(!sd.connected){ setNotice(sd.message || "Upstox is not connected. Tap Connect Upstox to sign in."); setQuotes([]); return; }
   const qr=await fetch("/api/upstox/quote",{cache:"no-store"});
   const qd=await qr.json();
   if(!qr.ok || !qd.connected || !Array.isArray(qd.quotes)){setNotice(qd.message || qd.error || "Live quotes unavailable — WAIT, NO TRADE.");setQuotes([]);return;}
   const rows:Quote[]=qd.quotes;
   const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
   const n=rows.find(q=>norm(q.instrument_key||"").includes("nifty50"));
   const b=rows.find(q=>norm(q.instrument_key||"").includes("niftybank"));
   if(!n || !b || Number(n.last_price)<=0 || Number(b.last_price)<=0){setNotice("Upstox responded, but valid NIFTY/BANK NIFTY quotes are missing. WAIT — NO TRADE.");setQuotes([]);return;}
   setQuotes(rows);
   setNotice("Upstox API returned NIFTY and BANK NIFTY quotes. Check quote timestamp and market session before trading.");
  } catch { setStatus({connected:false,reason:"unreachable"});setQuotes([]);setNotice("Could not verify Upstox connection. Check API configuration; WAIT — NO TRADE."); }
 },[]);

 useEffect(()=>{void refresh();const t=setInterval(()=>void refresh(),15000);return()=>clearInterval(t);},[refresh]);
 const connect=()=>{window.location.href="/api/upstox/login";};
 const find=(needle:string)=>quotes.find(q=>(q.instrument_key||"").toLowerCase().replace(/[^a-z0-9]/g,"").includes(needle));
 const nifty=find("nifty50"), bank=find("niftybank");
 const connected=!!status.connected && quotes.length>0;
 const quoteTime=(q?:Quote)=>{if(!q?.timestamp)return "Timestamp unavailable";const raw=q.timestamp;const num=typeof raw==="number"?raw:Number(raw);const d=Number.isFinite(num)?new Date(num>1e12?num:num>1e9?num*1000:NaN):new Date(raw as string);return Number.isFinite(d.getTime())?d.toLocaleString("en-IN",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",day:"2-digit",month:"short"})+" IST":"Timestamp unavailable";};

 return <main className="shell">
  <aside className="sidebar"><div className="logo">📈 <span>Smart Trading</span><b> AI</b></div>
   {navItems.map(x=><button key={x} onClick={()=>setTab(x)} className={tab===x?"nav active":"nav"}>{x}</button>)}
  </aside>
  <section className="main">
   <header><div><h1>{tab}</h1><p>Scan • Analyse • Trade • Grow</p></div><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><button onClick={connect} disabled={busy} style={{background:"#0b62d6",color:"#fff",border:0,borderRadius:12,padding:"10px 14px",fontWeight:800,cursor:"pointer"}}>{connected?"RECONNECT UPSTOX":"CONNECT UPSTOX"}</button><button onClick={()=>{setBusy(true);void refresh().finally(()=>setBusy(false));}} style={{background:"#102b3c",color:"#d8eaff",border:"1px solid #23465b",borderRadius:12,padding:"10px 12px",fontWeight:700}}>{busy?"CHECKING…":"REFRESH"}</button><div className="status" style={{color:connected?"#00e676":"#ffd27a"}}>● {connected?"UPSTOX VERIFIED":"WAIT — NO DATA"}</div></div></header>
   <div className="panel" style={{marginTop:14,borderColor:connected?"#0b5d3e":"#75551c"}}><b>{connected?"Connection status":"Upstox connection required"}</b><p style={{marginTop:6,color:"#a9bdcc"}}>{notice}</p>{status.reason&&<p style={{marginTop:5,color:"#ffd27a",fontSize:12}}>Status: {status.reason}</p>}</div>
   <div className="marketbar"><div className="market"><span>● Market status</span><small>{connected?"Quote API verified; freshness must be checked":"Waiting for verified data"}</small></div><div className="market">NIFTY <strong>{fmt(nifty?.last_price)}</strong><small>{nifty?quoteTime(nifty):"Live data pending"}</small></div><div className="market">BANK NIFTY <strong>{fmt(bank?.last_price)}</strong><small>{bank?quoteTime(bank):"Live data pending"}</small></div><div className="market">Stocks scanned <strong>—</strong><small>{connected?"Scanner not yet verified":"Waiting for Upstox"}</small></div></div>
   <div className="grid">
    <section className="panel"><div className="panelhead"><h2>🔥 Today's Top Swing Setups</h2><div className="chips"><span className="chip selected">All</span><span className="chip">A+ Setup</span><span className="chip">Breakout</span><span className="chip">Pullback</span><span className="chip">Positive News</span></div></div>
     <div className="table"><div className="tr head"><span>Stock</span><span>Trend</span><span>Setup</span><span>Score</span><span>Entry</span><span>SL</span><span>R:R</span></div>
      <div className="tr"><span><b>{connected?"DATA CHECKED":"WAITING"}</b><small>Verified quote required</small></span><span>—</span><span>{connected?"Scanner test pending":"Connect Upstox"}</span><span className="score">WAIT</span><span>—</span><span className="loss">—</span><span>—</span></div>
      <div className="tr"><span><b>NO SIGNAL</b><small>No invented setup</small></span><span>—</span><span>Awaiting scanner validation</span><span className="score">WAIT</span><span>—</span><span className="loss">—</span><span>—</span></div></div>
    </section>
    <aside className="right"><div className="panel"><h2>🎯 Trade Plan</h2>{[["Verdict","WAIT"],["Entry","—"],["Stop Loss","—"],["Target 1","—"],["Target 2","—"],["Risk : Reward","—"],["Capital","₹5,000"],["Risk / Trade","₹50 (1%)"]].map(([a,b])=><div className="metric" key={a}><span>{a}</span><strong className={a==="Stop Loss"?"loss":a.includes("Target")?"gain":""}>{b}</strong></div>)}<p className="muted" style={{marginTop:10}}>No option recommendation until price action, OI, expiry and risk checks are verified.</p></div>
     <div className="panel"><h2>🧠 Smart Rules</h2><ul><li>News + Price + Volume</li><li>EMA 20 &gt; EMA 50</li><li>HH-HL structure</li><li>Breakout + Retest</li><li>R:R ≥ 1:2</li><li>Incomplete confirmation → WAIT</li></ul></div></aside>
   </div>
   <div className="panel chartPanel"><div className="chartTitle"><h2>📊 Stock Chart & Zones</h2><span>TradingView-ready</span></div><div className="chart"><div className="supply">SUPPLY ZONE</div><div className="demand">DEMAND ZONE</div><div className="trendline"/></div><p className="muted">Quote timestamp: {quoteTime(nifty)}. Real candles, VWAP, EMA 20/50, volume, breakout/fakeout, pullback and demand/supply zones remain unavailable until their data feeds are verified.</p></div>
  </section>
 </main>
}