"use client";
import {useState} from "react";
const setups=[
 {s:"WAITING",trend:"—",setup:"Live data pending",score:"—"},
 {s:"—",trend:"—",setup:"Connect Upstox",score:"—"},
 {s:"—",trend:"—",setup:"No invented data",score:"WAIT"}
];
export default function Home(){
 const [tab,setTab]=useState("Dashboard");
 return <main className="shell">
  <aside className="sidebar"><div className="logo">📈 <span>Smart Trading</span><b> AI</b></div>
   {["Dashboard","Live Scanner","News Scanner","Watchlist","TradingView","WhatsApp","Risk Calculator","Settings"].map(x=><button key={x} onClick={()=>setTab(x)} className={tab===x?"nav active":"nav"}>{x}</button>)}
  </aside>
  <section className="main">
   <header><div><h1>{tab}</h1><p>Scan • Analyse • Trade • Grow</p></div><div className="status">● LIVE ENGINE READY</div></header>
   <div className="marketbar"><div className="market open">● Market status</div><div className="market">NIFTY <strong>—</strong><small>Live data pending</small></div><div className="market">BANK NIFTY <strong>—</strong><small>Live data pending</small></div><div className="market">Stocks scanned <strong>—</strong><small>Waiting for Upstox</small></div></div>
   <div className="grid">
    <section className="panel"><div className="panelhead"><h2>🔥 Today's Top Swing Setups</h2><div className="chips"><span className="chip selected">All</span><span className="chip">A+ Setup</span><span className="chip">Breakout</span><span className="chip">Pullback</span><span className="chip">Positive News</span></div></div>
     <div className="table"><div className="tr head"><span>Stock</span><span>Trend</span><span>Setup</span><span>Score</span><span>Entry</span><span>SL</span><span>R:R</span></div>
      {setups.map((r,i)=><div className="tr" key={i}><span><b>{r.s}</b><small>Live candidate</small></span><span>{r.trend}</span><span>{r.setup}</span><span className="score">{r.score}</span><span>—</span><span className="loss">—</span><span>—</span></div>)}</div>
    </section>
    <aside className="right"><div className="panel"><h2>🎯 Trade Plan</h2>{[["Verdict","WAIT"],["Entry","—"],["Stop Loss","—"],["Target 1","—"],["Target 2","—"],["Risk : Reward","—"],["Capital","₹5,000"],["Risk / Trade","₹50 (1%)"]].map(([a,b])=><div className="metric" key={a}><span>{a}</span><strong className={a==="Stop Loss"?"loss":a.includes("Target")?"gain":""}>{b}</strong></div>)}<div className="buttons"><button>Open Chart</button><button className="greenBtn">Share WhatsApp</button></div></div>
     <div className="panel"><h2>🧠 Smart Rules</h2><ul><li>News + Price + Volume</li><li>EMA 20 &gt; EMA 50</li><li>HH-HL structure</li><li>Breakout + Retest</li><li>R:R ≥ 1:2</li><li>Incomplete confirmation → WAIT</li></ul></div></aside>
   </div>
   <div className="panel chartPanel"><div className="chartTitle"><h2>📊 Stock Chart & Zones</h2><span>TradingView-ready</span></div><div className="chart"><div className="supply">SUPPLY ZONE</div><div className="demand">DEMAND ZONE</div><div className="trendline"/></div><p className="muted">Real candles, VWAP, EMA 20/50, volume, breakout/fakeout, pullback and demand/supply zones will populate only after a verified market-data connection.</p></div>
  </section>
 </main>
}