const https = require("https");
const zlib = require("zlib");

function parseCookies(req){
  const out={};
  String(req.headers.cookie||"").split(";").forEach(p=>{
    const i=p.indexOf("=");
    if(i>-1) out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim());
  });
  return out;
}
function request(url,token,headers={}){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{Accept:"application/json",Authorization:"Bearer "+token,...headers}},res=>{
      const chunks=[];res.on("data",c=>chunks.push(c));res.on("end",()=>{
        const raw=Buffer.concat(chunks);
        let body=raw;
        try{
          const enc=String(res.headers["content-encoding"]||"");
          if(enc.includes("gzip")) body=zlib.gunzipSync(raw);
        }catch(e){return reject(e)}
        const text=body.toString("utf8");
        let parsed;try{parsed=JSON.parse(text)}catch(e){parsed=text}
        if(res.statusCode<200||res.statusCode>=300)return reject(new Error(parsed?.errors?.[0]?.message||parsed?.message||"Request failed ("+res.statusCode+")"));
        resolve(parsed);
      });
    });
    req.on("error",reject);
  });
}
function csvRows(text){
  const lines=String(text).replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);
  if(!lines.length)return [];
  const parse=line=>{
    const out=[];let cur="",q=false;
    for(let i=0;i<line.length;i++){const ch=line[i];
      if(ch==="""&&line[i+1]==="""){cur+=""";i++;continue}
      if(ch==="""){q=!q;continue}
      if(ch===","&&!q){out.push(cur.trim());cur="";continue}
      cur+=ch;
    }out.push(cur.trim());return out;
  };
  const h=parse(lines[0]).map(x=>x.toLowerCase().replace(/[^a-z0-9]+/g,"_"));
  return lines.slice(1).map(line=>{const v=parse(line),o={};h.forEach((k,i)=>o[k]=v[i]||"");return o}).filter(o=>Object.values(o).some(Boolean));
}
function istDate(d=new Date()){
  const x=new Date(d.getTime()+330*60000);
  return x.toISOString().slice(0,10);
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function rsi(closes,p=14){
  if(closes.length<p+1)return null;
  let gain=0,loss=0;
  for(let i=closes.length-p;i<closes.length;i++){const ch=closes[i]-closes[i-1];if(ch>0)gain+=ch;else loss-=ch}
  let ag=gain/p,al=loss/p;
  for(let i=Math.max(p+1,closes.length-20);i<closes.length;i++){
    const ch=closes[i]-closes[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);
    ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p;
  }
  if(al===0)return 100;return 100-(100/(1+ag/al));
}
function ema(closes,p){
  if(closes.length<p)return null;let e=closes.slice(0,p).reduce((s,v)=>s+v,0)/p,k=2/(p+1);
  for(let i=p;i<closes.length;i++)e=closes[i]*k+e*(1-k);return e;
}
function fetchHistory(key,token,to,from){
  return request("https://api.upstox.com/v3/historical-candle/"+encodeURIComponent(key)+"/days/1/"+to+"/"+from,token);
}
function newsImpact(items){
  const all=items.map(x=>((x.heading||"")+" "+(x.summary||"")).toLowerCase()).join(" ");
  if(!all)return {flag:"NONE",gov:false,impact:"NONE"};
  const gov=/(government|govt|ministry|minister|psu|railway|defence|defense|tender|government order|policy|capex|pmo|state government)/i.test(all);
  const neg=/(fraud|penalty|probe|raid|downgrade|default|loss|lawsuit|ban|fine|resign|weak|fall|decline)/i.test(all);
  const pos=/(order win|contract|approval|award|acquisition|profit|growth|upgrade|partnership|capex|tender win|positive)/i.test(all);
  return {flag:items.length?"NEWS":"NONE",gov,impact:pos&&!neg?"POSITIVE":neg&&!pos?"NEGATIVE":pos&&neg?"MIXED":"NEUTRAL"};
}

module.exports=async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const token=parseCookies(req).upstox_access_token;
  if(!token)return res.status(401).json({connected:false,error:"Upstox not connected"});
  const universe=String(req.query?.universe||"both").toLowerCase();
  try{
    const urls=[];
    if(universe==="nifty100"||universe==="both")urls.push(["NIFTY 100","https://nsearchives.nseindia.com/content/indices/ind_nifty100list.csv"]);
    if(universe==="midcap100"||universe==="both")urls.push(["NIFTY MIDCAP 100","https://www.niftyindices.com/IndexConstituent/ind_niftymidcap100list.csv"]);
    const csvs=await Promise.all(urls.map(async x=>{
      const r=await new Promise((resolve,reject)=>https.get(x[1],{headers:{"User-Agent":"Mozilla/5.0","Accept":"text/csv,*/*"}},res2=>{
        const chunks=[];res2.on("data",c=>chunks.push(c));res2.on("end",()=>resolve({status:res2.statusCode,text:Buffer.concat(chunks).toString("utf8")}));}).on("error",reject));
      if(r.status<200||r.status>=300)throw new Error(x[0]+" constituent file unavailable");
      return [x[0],r.text];
    }));
    const map=new Map();
    csvs.forEach(([group,text])=>csvRows(text).forEach(r=>{
      const symbol=r.symbol||r.trading_symbol||r.symbol_name;
      const isin=r.isin_code||r.isin||r.isin_code_;
      if(symbol&&isin)map.set(isin,{symbol,isin,groups:[...(map.get(isin)?.groups||[]),group]});
    }));
    const universeRows=[...map.values()];
    const keys=universeRows.map(x=>"NSE_EQ|"+x.isin);
    const quoteBody=await request("https://api.upstox.com/v3/market-quote/quotes?instrument_key="+keys.map(encodeURIComponent).join(","),token);
    const qdata=quoteBody?.data||{};
    const candidates=universeRows.map(x=>{
      const key="NSE_EQ:"+x.isin, q=qdata[key];
      if(!q)return null;
      const ltp=num(q.last_price),vol=num(q.volume),pc=num(q.prev_close_price),dayHigh=num(q.ohlc?.high),dayLow=num(q.ohlc?.low);
      return {...x,key:key.replace(":", "|"),ltp,vol,pc,dayHigh,dayLow,changePct:ltp!=null&&pc?((ltp-pc)/pc)*100:0,turnover:ltp&&vol?ltp*vol:0};
    }).filter(Boolean).sort((a,b)=>b.turnover-a.turnover).slice(0,50);
    const to=istDate(), from=istDate(new Date(Date.now()-100*86400000));
    const hist=await Promise.all(candidates.map(async x=>{
      try{
        const body=await fetchHistory(x.key,token,to,from);
        const raw=Array.isArray(body?.data?.candles)?body.data.candles:[];
        const cs=raw.map(a=>({ts:a[0],open:num(a[1]),high:num(a[2]),low:num(a[3]),close:num(a[4]),volume:num(a[5])})).filter(c=>c.close!=null).reverse();
        const prior=cs.slice(-21,-1), closes=prior.map(c=>c.close);
        if(prior.length<20)return {...x,eligible:false};
        const hi=Math.max(...prior.map(c=>c.high)),lo=Math.min(...prior.map(c=>c.low)),mid=(hi+lo)/2;
        const avgVol=prior.reduce((s,c)=>s+c.volume,0)/prior.length;
        const volRatio=x.vol&&avgVol?x.vol/avgVol:null;
        const rrsi=rsi([...closes,x.ltp||prior.at(-1).close],14);
        const e20=ema([...closes,x.ltp||prior.at(-1).close],20);
        const e50=ema([...closes,x.ltp||prior.at(-1).close],50);
        const rangePct=mid?((hi-lo)/mid)*100:null;
        const breakout=x.ltp>hi;
        const consolidation=rangePct!=null&&rangePct<=12;
        const volumeUp=volRatio!=null&&volRatio>=1.5;
        const rsiOK=rrsi!=null&&rrsi>=60&&rrsi<=80;
        const trend=x.ltp>e20&&e20>e50;
        let score=0; if(breakout)score+=2;if(volumeUp)score+=2;if(consolidation)score+=1;if(rsiOK)score+=1;if(trend)score+=1;
        const trigger=breakout&&volumeUp&&rsiOK;
        return {...x,eligible:true,breakout,consolidation,volumeRatio:volRatio,rsi:rrsi,ema20:e20,ema50:e50,rangePct,trend,score,trigger,priorHigh:hi,priorLow:lo};
      }catch(e){return {...x,eligible:false,error:e.message}}
    }));
    const scored=hist.filter(x=>x.eligible).sort((a,b)=>b.score-a.score||b.volumeRatio-a.volumeRatio).slice(0,30);
    const topKeys=scored.map(x=>x.key);
    const newsMap={};
    for(let i=0;i<topKeys.length;i+=30){
      try{
        const nb=await request("https://api.upstox.com/v2/news?category=instrument_keys&instrument_keys="+topKeys.slice(i,i+30).map(encodeURIComponent).join(",")+"&page_number=1&page_size=5",token);
        Object.assign(newsMap,nb?.data||{});
      }catch(e){}
    }
    const results=scored.map(x=>{
      const ni=newsImpact(newsMap[x.key]||[]);
      return {...x,news:ni.flag,newsImpact:ni.impact,governmentLinked:ni.gov,newsHeadlines:(newsMap[x.key]||[]).slice(0,2).map(n=>n.heading)};
    });
    return res.status(200).json({connected:true,source:"Upstox + NSE/Nifty Indices",universe:urls.map(x=>x[0]),scanned:universeRows.length,technicalShortlist:candidates.length,results,notes:{
      volume:"Today volume / prior 20 completed daily bars",
      breakout:"LTP above prior 20-day high",
      consolidation:"Prior 20-day range <= 12%",
      rsi:"14-period daily RSI, preferred 60–80",
      news:"Upstox news from past 7 days; keyword tags are heuristic",
      fii_dii:"Market-wide institutional flow is not treated as stock-specific interest in this scanner."
    }});
  }catch(e){return res.status(502).json({connected:true,error:e.message||"Swing scanner failed"})}
};