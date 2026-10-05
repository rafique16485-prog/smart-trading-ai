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
  const tokens=Array.isArray(token)?token.filter(Boolean):[token];
  const attempt=(idx)=>new Promise((resolve,reject)=>{
    if(idx>=tokens.length)return reject(new Error("Request failed"));
    const req=https.get(url,{headers:{Accept:"application/json",Authorization:"Bearer "+tokens[idx],...headers}},res=>{
      const chunks=[];res.on("data",c=>chunks.push(c));res.on("end",()=>{
        const raw=Buffer.concat(chunks);
        let body=raw;
        try{
          const enc=String(res.headers["content-encoding"]||"");
          if(enc.includes("gzip")) body=zlib.gunzipSync(raw);
        }catch(e){return reject(e)}
        const text=body.toString("utf8");
        let parsed;try{parsed=JSON.parse(text)}catch(e){parsed=text}
        if(res.statusCode<200||res.statusCode>=300){
          if((res.statusCode===401||res.statusCode===403)&&idx+1<tokens.length)return attempt(idx+1).then(resolve).catch(reject);
          return reject(new Error(parsed?.errors?.[0]?.message||parsed?.message||"Request failed ("+res.statusCode+")"));
        }
        resolve(parsed);
      });
    });
    req.on("error",e=>idx+1<tokens.length?attempt(idx+1).then(resolve).catch(reject):reject(e));
  });
  return attempt(0);
}
function csvRows(text){
  const lines=String(text).replace(/^\uFEFF/,"").split(/\r?
/).filter(Boolean);
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
  const jar=parseCookies(req);
  const token=[jar.upstox_access_token,jar.upstox_extended_token].filter(Boolean);
  if(!token.length)return res.status(401).json({connected:false,error:"Upstox not connected"});
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
      const industry=r.industry||r.sector||r.industry_name||"UNKNOWN";
      if(symbol&&isin)map.set(isin,{symbol,isin,industry,groups:[...(map.get(isin)?.groups||[]),group]});
    }));
    const universeRows=[...map.values()];
    const keys=universeRows.map(x=>"NSE_EQ|"+x.isin);
    const quoteBody=await request("https://api.upstox.com/v3/market-quote/quotes?instrument_key="+keys.map(encodeURIComponent).join(","),token);
    const qdata=quoteBody?.data||{};
    const candidates=universeRows.map(x=>{
      const key="NSE_EQ|"+x.isin, q=qdata[key];
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
        const series=[...closes,x.ltp||prior.at(-1).close];
        const e20=ema(series,20);
        const e50=ema(series,50);
        const rangePct=mid?((hi-lo)/mid)*100:null;
        const breakout=x.ltp>hi;
        const consolidation=rangePct!=null&&rangePct<=12;
        const volumeUp=volRatio!=null&&volRatio>=1.5;
        const rsiOK=rrsi!=null&&rrsi>=60&&rrsi<=80;
        const trend=x.ltp>e20&&e20>e50;
        const trs=prior.slice(-15).map(c=>Math.max(c.high-c.low,Math.abs(c.high-(c.close||c.high)),Math.abs(c.low-(c.close||c.low))));
        const atr14=trs.length?trs.reduce((s,v)=>s+v,0)/trs.length:null;
        const entryBase=hi;
        const entryHigh=atr14!=null?hi+atr14*0.25:hi;
        const chaseLimit=atr14!=null?hi+atr14*1.0:hi*1.03;
        const chase=breakout&&x.ltp>chaseLimit;
        const entryLow=hi;
        const invalidation=atr14!=null?hi-atr14*0.75:Math.min(hi,prior.at(-1).low);
        const riskPerShare=Math.max(0,entryLow-invalidation);
        const target1=entryLow+riskPerShare*1.5;
        const target2=entryLow+riskPerShare*2;
        const holdingDays=atr14&&riskPerShare>0?Math.max(3,Math.min(15,Math.round((riskPerShare/atr14)*8))):7;
        let score=0; if(breakout)score+=2;if(volumeUp)score+=2;if(consolidation)score+=1;if(rsiOK)score+=1;if(trend)score+=1;
        const trigger=breakout&&volumeUp&&rsiOK&&!chase;
        return {...x,eligible:true,breakout,consolidation,volumeRatio:volRatio,rsi:rrsi,ema20:e20,ema50:e50,rangePct,trend,score,volumeUp,rsiOK,trigger,priorHigh:hi,priorLow:lo,atr14,entryLow,entryHigh,invalidation,riskPerShare,target1,target2,holdingDays,chase};
      }catch(e){return {...x,eligible:false,error:e.message}}
    }));
    const scored=hist.filter(x=>x.eligible).sort((a,b)=>b.score-a.score||b.volumeRatio-a.volumeRatio).slice(0,30);
    // 15-minute multi-timeframe confirmation for the technical shortlist.
    const mtf=await Promise.all(scored.slice(0,30).map(async x=>{
      try{
        const body=await request("https://api.upstox.com/v3/historical-candle/"+encodeURIComponent(x.key)+"/minutes/15/"+to+"/"+to,token);
        const rows=(body?.data?.candles||[]).map(a=>({close:num(a[4]),volume:num(a[5])})).filter(a=>a.close!=null).reverse();
        const closes=rows.map(a=>a.close);
        if(closes.length<20)return [x.key,{ready:false,trend:"UNKNOWN",note:"15m data insufficient"}];
        const e20=ema(closes,20), last=closes.at(-1), prev=closes.at(-2);
        const avgVol=rows.slice(-21,-1).reduce((s,a)=>s+(a.volume||0),0)/Math.max(1,Math.min(20,rows.length-1));
        const vr=rows.at(-1)?.volume&&avgVol?rows.at(-1).volume/avgVol:null;
        const up=last>e20&&last>=prev, down=last<e20&&last<=prev;
        return [x.key,{ready:true,trend:up?"UP":down?"DOWN":"MIXED",volumeRatio:vr,ema20:e20,close:last,note:up?"15m trend aligned":"15m trend not aligned"}];
      }catch(e){return [x.key,{ready:false,trend:"UNKNOWN",note:"15m unavailable"}]}
    }));
    const mtfMap=Object.fromEntries(mtf);
    scored.forEach(x=>{
      const m=mtfMap[x.key]||{ready:false,trend:"UNKNOWN"};
      x.mtf15=m;
      x.mtfAligned=m.ready&&m.trend==="UP";
      if(!x.mtfAligned)x.score-=2;
    });
    scored.sort((a,b)=>b.score-a.score||b.volumeRatio-a.volumeRatio);
    const topKeys=scored.map(x=>x.key);
    const newsMap={};
    for(let i=0;i<topKeys.length;i+=30){
      try{
        const nb=await request("https://api.upstox.com/v2/news?category=instrument_keys&instrument_keys="+topKeys.slice(i,i+30).map(encodeURIComponent).join(",")+"&page_number=1&page_size=5",token);
        Object.assign(newsMap,nb?.data||{});
      }catch(e){}
    }
    // Market-wide NIFTY benchmark + institutional flow context
    let benchmarkReturn=null;
    try{
      const nb=await fetchHistory("NSE_INDEX|Nifty 50",token,to,from);
      const nc=(nb?.data?.candles||[]).map(a=>({close:num(a[4])})).filter(x=>x.close!=null).reverse();
      if(nc.length>=21){
        const b0=nc[nc.length-21].close,b1=nc[nc.length-1].close;
        benchmarkReturn=b0?((b1-b0)/b0)*100:null;
      }
    }catch(e){}

    let fiiDii={available:false};
    try{
      const d=istDate();
      const [fi,di]=await Promise.all([
        request("https://api.upstox.com/v2/market/fii?date="+encodeURIComponent(d)+"&data_type=equity",token),
        request("https://api.upstox.com/v2/market/dii?date="+encodeURIComponent(d)+"&data_type=equity",token)
      ]);
      fiiDii={available:true,date:d,fii:fi?.data||fi,dii:di?.data||di};
    }catch(e){ fiiDii={available:false,message:e.message||"Institutional flow unavailable"}; }

    // Adaptive market-regime engine: NIFTY 5m structure + VWAP + EMA + volume.
    let marketRegime={regime:"INSUFFICIENT DATA",confidence:0,allowedBias:"WAIT",note:"Market regime unavailable"};
    try{
      const intraday=await request("https://api.upstox.com/v3/historical-candle/NSE_INDEX%7CNifty%2050/minutes/5/"+to+"/"+to,token);
      const rows=(intraday?.data?.candles||[]).map(a=>({ts:a[0],open:num(a[1]),high:num(a[2]),low:num(a[3]),close:num(a[4]),volume:num(a[5])})).filter(x=>x.close!=null).reverse().slice(-78);
      if(rows.length>=20){
        let pv=0,pvol=0;rows.forEach(x=>{pv+=(x.close||0)*(x.volume||0);pvol+=(x.volume||0)});
        const vwap=pvol?pv/pvol:null;
        const cls=rows.map(x=>x.close), e20=ema(cls,20);
        const last=rows.at(-1), prev=rows.at(-2), highs=rows.slice(-12).map(x=>x.high), lows=rows.slice(-12).map(x=>x.low);
        const hh=Math.max(...highs), ll=Math.min(...lows);
        const avgVol=rows.slice(-21,-1).reduce((s,x)=>s+(x.volume||0),0)/Math.max(1,rows.slice(-21,-1).length);
        const volRatio=last.volume&&avgVol?last.volume/avgVol:null;
        const above=last.close>vwap, emaUp=e20!=null&&last.close>e20;
        const higher=last.high>=prev.high&&last.low>=prev.low, lower=last.high<=prev.high&&last.low<=prev.low;
        const rangePct=last.close?((hh-ll)/last.close)*100:0;
        let regime="TRANSITION",confidence=55,bias="WAIT",note="Mixed structure";
        if(rangePct<=0.9 && !higher && !lower){regime="RANGE";confidence=82;bias="WAIT";note="Tight 5m range; avoid mid-range chase";}
        else if(above&&emaUp&&higher){regime="TREND UP";confidence=86;bias="LONG";note="Price above VWAP/EMA20 with higher structure";}
        else if(!above&&!emaUp&&lower){regime="TREND DOWN";confidence=86;bias="SHORT";note="Price below VWAP/EMA20 with lower structure";}
        else if((above!==emaUp)&&volRatio!=null&&volRatio>=1.5){regime="REVERSAL WATCH";confidence=72;bias="WAIT";note="VWAP/EMA conflict with volume expansion";}
        else if(above&&emaUp){regime="EARLY TREND UP";confidence=70;bias="LONG";note="Bullish alignment forming";}
        else if(!above&&!emaUp){regime="EARLY TREND DOWN";confidence=70;bias="SHORT";note="Bearish alignment forming";}
        const allowed=regime==="TREND UP"||regime==="EARLY TREND UP"?"LONG SETUPS":regime==="TREND DOWN"||regime==="EARLY TREND DOWN"?"SHORT SETUPS":regime==="RANGE"?"RANGE EXTREMES ONLY":"WAIT FOR CONFIRMATION";
        marketRegime={regime,confidence,allowedBias:bias,allowedSetup:allowed,vwap,ema20:e20,volumeRatio:volRatio,note};
      }
    }catch(e){marketRegime.note=e.message||"Regime unavailable";}

    // Sector/industry relative strength from the scanned universe
    const sectorMap={};
    scored.forEach(x=>{
      const k=x.industry||"UNKNOWN";
      if(!sectorMap[k])sectorMap[k]={sum:0,count:0,breakouts:0};
      const base=x.pc||x.ltp;
      const ret=base&&x.ltp?((x.ltp-base)/base)*100:0;
      sectorMap[k].sum+=ret;sectorMap[k].count++;if(x.breakout)sectorMap[k].breakouts++;
    });
    const sectorStats=Object.fromEntries(Object.entries(sectorMap).map(([k,v])=>[k,{avgReturn:v.count?v.sum/v.count:0,count:v.count,breakouts:v.breakouts}]));
    // Company-level fundamentals are fetched only for the top 15 technical candidates
    const fundMap={};
    await Promise.all(scored.slice(0,15).map(async x=>{
      try{
        const [sh,ca,rat,inc,cf,bs] = await Promise.all([
          request("https://api.upstox.com/v2/fundamentals/"+encodeURIComponent(x.isin)+"/share-holdings",token),
          request("https://api.upstox.com/v2/fundamentals/"+encodeURIComponent(x.isin)+"/corporate-actions",token),
          request("https://api.upstox.com/v2/fundamentals/"+encodeURIComponent(x.isin)+"/key-ratios",token),
          request("https://api.upstox.com/v2/fundamentals/"+encodeURIComponent(x.isin)+"/income-statement?type=consolidated&time_period=quarterly",token),
          request("https://api.upstox.com/v2/fundamentals/"+encodeURIComponent(x.isin)+"/cash-flow?type=consolidated",token),
          request("https://api.upstox.com/v2/fundamentals/"+encodeURIComponent(x.isin)+"/balance-sheet?type=consolidated",token)
        ]);
        const cats=sh?.data||[];
        const latest=cat=>{const h=cats.find(z=>String(z.category||"").toLowerCase()===cat)?.history||[];return h.length?h[h.length-1]:null};
        const prev=cat=>{const h=cats.find(z=>String(z.category||"").toLowerCase()===cat)?.history||[];return h.length>1?h[h.length-2]:null};
        const p=latest("promoters"),fi=latest("fii"),di=latest("other_dii");
        const pp=prev("promoters"),fp=prev("fii"),dp=prev("other_dii");
        const actions=Array.isArray(ca?.data)?ca.data.slice(0,5):[];
        const ratios=rat?.data||{};
        const income=inc?.data?.income_statement||[];
        const cash=cf?.data?.cash_flow||[];
        const balance=bs?.data?.history||[];
        const pickHist=(arr, names)=>{const z=arr.find(q=>names.includes(String(q.category||"").toLowerCase()));return z?.history||[]};
        const rev=pickHist(income,["revenue"]), op=pickHist(income,["operating profit","operating_profit"]), np=pickHist(income,["net profit","net_profit"]);
        const latestVal=a=>a.length?a[a.length-1]:null, prevVal=a=>a.length>1?a[a.length-2]:null;
        const rv=latestVal(rev), pv=latestVal(np), ov=latestVal(op), rvp=prevVal(rev), pvp=prevVal(np);
        const quality={
          revenue:rv?.value??null, revenueGrowth:rv?.change??null,
          netProfit:pv?.value??null, netProfitGrowth:pv?.change??null,
          operatingProfit:ov?.value??null,
          totalAssets:latestVal(balance)?.total_asset??null,
          totalLiability:latestVal(balance)?.total_liability??null,
          cashFlow:cash,
          ratios
        };
        const ratioMap={};(ratios?.data||ratios||[]).forEach(q=>{ratioMap[String(q.name||"").toUpperCase()]=q});
        const roe=ratioMap.ROE?.company_value, roce=ratioMap.ROCE?.company_value;
        const qualityFlags=[];
        if(roe)qualityFlags.push("ROE "+roe);
        if(roce)qualityFlags.push("ROCE "+roce);
        if(rv?.change)qualityFlags.push("Revenue "+rv.change);
        if(pv?.change)qualityFlags.push("Profit "+pv.change);
        fundMap[x.isin]={shareholding:{promoter:p?.value??null,fii:fi?.value??null,dii:di?.value??null,promoterChange:pp&&p?p.value-pp.value:null,fiiChange:fp&&fi?fi.value-fp.value:null,diiChange:dp&&di?di.value-dp.value:null,period:p?.period||fi?.period||di?.period||null},corporateActions:actions.slice(0,3).map(a=>({name:a.name,expiry_date:a.expiry_date,amount:a.amount,ratio:a.ratio})),ratios,quality,qualityFlags};
      }catch(e){fundMap[x.isin]={error:e.message||"Fundamentals unavailable"}}
    }));
    // V80 composite score: descriptive decision gate, not a prediction
    const finalScore=(x)=>{
      let s=0;
      if(x.breakout)s+=2;
      if(x.volumeUp)s+=2;
      if(x.rsiOK)s+=1;
      if(x.trend)s+=1;
      if(x.relativeStrength!=null && x.relativeStrength>0)s+=1;
      if(x.sectorAvgReturn!=null && x.sectorAvgReturn>0)s+=1;
      const q=x.fundamentals?.quality||{};
      if(q.revenueGrowth!=null && Number(q.revenueGrowth)>0)s+=1;
      if(q.netProfitGrowth!=null && Number(q.netProfitGrowth)>0)s+=1;
      const news=x.news?.flag;
      if(news==="NEGATIVE")s-=2;
      if(news==="MIXED")s-=1;
      if(x.trigger)s+=1;
      if(x.chase)s-=2;
      if(x.relativeStrength!=null && x.relativeStrength<-1)s-=1;
      return s;
    };
    const results=scored.map(x=>{
      const ni=newsImpact(newsMap[x.key]||[]);
      const sector=sectorStats[x.industry||"UNKNOWN"]||{avgReturn:0,count:0,breakouts:0};
      const relativeStrength=benchmarkReturn!=null&&x.changePct!=null?x.changePct-benchmarkReturn:null;
      const fund=fundMap[x.isin]||{};
      const composite=finalScore({...x,fundamentals:fund,sectorAvgReturn:sector.avgReturn,relativeStrength,news:ni});
      const rr=Number.isFinite(x.riskPerShare)&&x.riskPerShare>0?Number(((x.target2-x.entryLow)/x.riskPerShare).toFixed(2)):0;
      const entryDistance=Number.isFinite(x.ltp)&&Number.isFinite(x.entryHigh)&&x.entryHigh>0?Number(((x.ltp-x.entryHigh)/x.entryHigh*100).toFixed(2)):null;
      const regimeCompatible=marketRegime.allowedBias==="WAIT"||marketRegime.allowedBias==="LONG"||marketRegime.allowedBias==="SHORT" ? (marketRegime.allowedBias==="WAIT" ? false : marketRegime.allowedBias==="LONG") : false;
      const adaptiveAllowed=marketRegime.allowedBias==="LONG";
      const setupGate=x.trigger&&x.mtfAligned&&!x.chase&&rr>=2&&(entryDistance==null||entryDistance<=0.75)&&adaptiveAllowed;
      const gateReason=setupGate?"5m + 15m + DAILY + VOLUME + RSI + R:R PASS":!adaptiveAllowed?"MARKET REGIME BLOCK":!x.mtfAligned?"15m CONFIRMATION FAIL":x.chase?"CHASE FILTER":!x.trigger?"BREAKOUT/VOLUME/RSI INCOMPLETE":rr<2?"R:R < 1:2":"ENTRY TOO EXTENDED";
      const decisionGate=setupGate&&composite>=9?"READY":composite>=6?"WATCH":composite<=2?"AVOID":"WAIT";

      // Setup Quality Score /100: descriptive ranking only, never overrides hard trade gates.
      const qualityParts={
        technical: Math.round((Number(x.breakout)*8)+(Number(x.trend)*5)+(Number(x.rsiOK)*4)+(Number(x.volumeUp)*5)+(Number(x.consolidation)*3)),
        marketAlignment: (relativeStrength==null?0:(relativeStrength>1?10:relativeStrength>0?6:0)) + (sector.avgReturn>1?10:sector.avgReturn>0?6:0),
        fundamentals: (fund.quality?.revenueGrowth!=null && Number(fund.quality.revenueGrowth)>0?5:0) +
          (fund.quality?.netProfitGrowth!=null && Number(fund.quality.netProfitGrowth)>0?5:0) +
          ((fund.ratios?.ROE?.company_value||fund.ratios?.ROCE?.company_value)?5:0),
        tradeability: (x.trigger?7:0) + (x.mtfAligned?3:0) +
          (entryDistance==null?4:(entryDistance<=0.25?6:entryDistance<=0.75?4:0)) +
          (rr>=2?6:0) + (!x.chase?3:0),
        news: ni.impact==="POSITIVE"?10:ni.impact==="NEUTRAL"||ni.impact==="NONE"?6:ni.impact==="MIXED"?3:0,
        institutional: !fiiDii.available?0:5
      };
      const qualityRaw=Object.values(qualityParts).reduce((a,b)=>a+b,0);
      const setupQualityScore=Math.max(0,Math.min(100,qualityRaw));
      const setupQualityGrade=setupQualityScore>=90?"A+":setupQualityScore>=80?"A":setupQualityScore>=70?"B":setupQualityScore>=60?"C":"D";
      const marketAlignment=relativeStrength!=null && sector.avgReturn!=null
        ? (relativeStrength>0 && sector.avgReturn>0 ? "ALIGNED" : relativeStrength<0 && sector.avgReturn<0 ? "WEAK" : "MIXED")
        : "UNKNOWN";
      return {...x,marketRegime:marketRegime.regime,marketRegimeConfidence:marketRegime.confidence,adaptiveAllowed,mtf15:x.mtf15,mtfAligned:x.mtfAligned,sectorAvgReturn:sector.avgReturn,sectorCount:sector.count,sectorBreakouts:sector.breakouts,relativeStrength,news:ni.flag,newsImpact:ni.impact,governmentLinked:ni.gov,newsHeadlines:(newsMap[x.key]||[]).slice(0,2).map(n=>n.heading),fundamentals:fund,compositeScore:composite,riskReward:rr,entryDistancePct:entryDistance,setupGate,gateReason,decisionGate,setupQualityScore,setupQualityGrade,qualityBreakdown:qualityParts,marketAlignment};
    });
    results.sort((a,b)=>b.setupQualityScore-a.setupQualityScore||b.compositeScore-a.compositeScore);
    return res.status(200).json({connected:true,source:"Upstox + NSE/Nifty Indices",universe:urls.map(x=>x[0]),scanned:universeRows.length,technicalShortlist:candidates.length,benchmark:{name:"NIFTY 50",returnPct:benchmarkReturn},institutional:fiiDii,sectorStats,marketRegime,results,qualityModel:{maxScore:100,grades:"A+ >=90, A >=80, B >=70, C >=60, D <60",hardGateIndependent:true},tradePlan:{entry:"Prior 20-day high to +0.25 ATR breakout zone; chase filter at +1 ATR",stop:"Breakout level minus 0.75 ATR (or recent structure fallback)",targets:"T1=1.5R, T2=2R",quantity:"Calculated client-side from capital and risk %",holding:"Estimated 3–15 trading days from ATR; not a guarantee"},notes:{
      volume:"Today volume / prior 20 completed daily bars",
      breakout:"LTP above prior 20-day high",
      consolidation:"Prior 20-day range <= 12%",
      rsi:"14-period daily RSI, preferred 60–80",
      news:"Upstox news from past 7 days; keyword tags are heuristic",
      fii_dii:"Market-wide institutional flow is not treated as stock-specific interest in this scanner.",
      finalGate:"READY requires composite >=9 plus daily breakout+volume+RSI, 15m confirmation, no chase, entry not >0.75% above zone, minimum 1:2 R:R, and a LONG market regime.",
      qualityScore:"/100 ranking combines daily structure, 15m confirmation, market/sector alignment, fundamentals, tradeability, news and institutional context. It is descriptive, not predictive, and cannot override the hard gate.",
      fundamentals:"Shareholding is quarterly; corporate actions are event-based; key ratios are descriptive context, not a trade trigger."
    }});
  }catch(e){return res.status(502).json({connected:true,error:e.message||"Swing scanner failed"})}
};