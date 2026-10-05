const https=require("https");
const zlib=require("zlib");
function cookies(req){const o={};String(req.headers.cookie||"").split(";").forEach(p=>{const i=p.indexOf("=");if(i>0)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())});return o}
function req(url,tokens){tokens=Array.isArray(tokens)?tokens.filter(Boolean):[tokens];return new Promise((resolve,reject)=>{const go=i=>{if(i>=tokens.length)return reject(new Error("Request failed"));https.get(url,{headers:{Accept:"application/json",Authorization:"Bearer "+tokens[i]}},r=>{const a=[];r.on("data",x=>a.push(x));r.on("end",()=>{let b=Buffer.concat(a);try{if(String(r.headers["content-encoding"]||"").includes("gzip"))b=zlib.gunzipSync(b)}catch(e){return reject(e)}let d;try{d=JSON.parse(b.toString())}catch(e){d={}}if(r.statusCode>=200&&r.statusCode<300)return resolve(d);if((r.statusCode===401||r.statusCode===403)&&i+1<tokens.length)return go(i+1);reject(new Error(d?.errors?.[0]?.message||d?.message||"HTTP "+r.statusCode))})}).on("error",e=>i+1<tokens.length?go(i+1):reject(e))};go(0)})}
function date(d){return new Date(d.getTime()+330*60000).toISOString().slice(0,10)}
function n(v){v=Number(v);return Number.isFinite(v)?v:null}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 const jar=cookies(req),tokens=[jar.upstox_access_token,jar.upstox_extended_token].filter(Boolean);if(!tokens.length)return res.status(401).json({connected:false,error:"Upstox not connected"});
 try{
  const days=Math.max(120,Math.min(365,Number(req.query?.days)||365));
  const end=new Date(),start=new Date(end.getTime()-days*86400000),to=date(end),from=date(start);
  const csv=await new Promise((resolve,reject)=>https.get("https://nsearchives.nseindia.com/content/indices/ind_nifty100list.csv",{headers:{"User-Agent":"Mozilla/5.0","Accept":"text/csv,*/*"}},r=>{const a=[];r.on("data",x=>a.push(x));r.on("end",()=>r.statusCode>=200&&r.statusCode<300?resolve(Buffer.concat(a).toString()):reject(new Error("NIFTY100 constituent file unavailable")))}).on("error",reject));
  const lines=csv.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);const h=lines.shift().split(",").map(x=>x.toLowerCase().replace(/[^a-z0-9]+/g,"_"));const rows=lines.map(l=>{const v=l.split(",");const o={};h.forEach((k,i)=>o[k]=v[i]||"");return o}).filter(x=>x.symbol&&x.isin_code);
  const quotes=await req("https://api.upstox.com/v3/market-quote/quotes?instrument_key="+rows.map(x=>encodeURIComponent("NSE_EQ|"+x.isin_code)).join(","),tokens);
  const q=quotes?.data||{};const universe=rows.map(x=>{const key="NSE_EQ|"+x.isin_code,z=q[key];return z?{symbol:x.symbol,key,ltp:n(z.last_price),turnover:(n(z.last_price)||0)*(n(z.volume)||0)}:null}).filter(Boolean).sort((a,b)=>b.turnover-a.turnover).slice(0,20);
  const trades=[];
  for(const x of universe){
   try{
    const body=await req("https://api.upstox.com/v3/historical-candle/"+encodeURIComponent(x.key)+"/days/1/"+to+"/"+from,tokens);
    const cs=(body?.data?.candles||[]).map(a=>({d:a[0],h:n(a[2]),l:n(a[3]),c:n(a[4]),v:n(a[5])})).filter(a=>a.c!=null).reverse();
    for(let i=21;i<cs.length-1;i++){
      const prev=cs.slice(i-20,i),hi=Math.max(...prev.map(a=>a.h)),lo=Math.min(...prev.map(a=>a.l));
      const atr=prev.slice(-14).reduce((s,a)=>s+(a.h-a.l),0)/14;
      if(!(cs[i].c>hi)||!atr)continue;
      const entry=cs[i].c,sl=hi-0.75*atr,risk=Math.max(0,entry-sl),t2=entry+2*risk;
      let outcome="OPEN",exit=cs.at(-1).c,exitDate=cs.at(-1).d,r=0;
      for(let j=i+1;j<cs.length;j++){if(cs[j].l<=sl){outcome="LOSS";exit=sl;exitDate=cs[j].d;r=-1;break}if(cs[j].h>=t2){outcome="WIN";exit=t2;exitDate=cs[j].d;r=2;break}}
      trades.push({symbol:x.symbol,entryDate:cs[i].d,exitDate,outcome,r,entry,sl,target:t2});
    }
   }catch(e){}
  }
  const closed=trades.filter(t=>t.outcome!=="OPEN"),wins=closed.filter(t=>t.outcome==="WIN").length,losses=closed.filter(t=>t.outcome==="LOSS").length;
  const grossWin=closed.filter(t=>t.r>0).reduce((s,t)=>s+t.r,0),grossLoss=Math.abs(closed.filter(t=>t.r<0).reduce((s,t)=>s+t.r,0));
  let equity=0,peak=0,maxDD=0;closed.forEach(t=>{equity+=t.r;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity)});
  const avgR=closed.length?closed.reduce((s,t)=>s+t.r,0)/closed.length:null;
  return res.status(200).json({connected:true,model:"20-day breakout + 0.75 ATR invalidation + 2R target",lookbackDays:days,universeSize:rows.length,testedSymbols:universe.length,tradeCount:trades.length,closedTrades:closed.length,wins,losses,openTrades:trades.length-closed.length,winRate:closed.length?wins/closed.length*100:null,avgR,maxDrawdownR:maxDD,profitFactor:grossLoss?grossWin/grossLoss:null,totalR:closed.reduce((s,t)=>s+t.r,0),note:"Historical rule test only; excludes option premium, slippage, brokerage, taxes and survivorship bias. Not a guarantee.",recentTrades:trades.slice(-20).reverse()});
 }catch(e){return res.status(502).json({connected:true,error:e.message||"Backtest unavailable"})}
};