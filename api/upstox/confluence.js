const https = require("https");

const INSTRUMENTS = {
  nifty: "NSE_INDEX|Nifty 50",
  "nifty-50": "NSE_INDEX|Nifty 50",
  banknifty: "NSE_INDEX|Nifty Bank",
  "bank-nifty": "NSE_INDEX|Nifty Bank"
};

function getJson(url, token) {
  const tokens=Array.isArray(token)?token.filter(Boolean):[token];
  return new Promise((resolve, reject) => {
    const attempt=(idx)=>new Promise((resolve,reject)=>{const req = https.get(url, {
      headers: { Accept: "application/json", Authorization: "Bearer " + tokens[idx] }
    }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          if((res.statusCode===401||res.statusCode===403)&&idx+1<tokens.length)return attempt(idx+1).then(resolve).catch(reject); return reject(new Error(parsed?.errors?.[0]?.message || parsed?.message || "Upstox candle request failed (" + res.statusCode + ")"));
        }
        resolve(parsed || {});
      });
    });
    req.on("error", reject);});
    return attempt(0);
  });
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim());
  });
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const cookies = parseCookies(req);
  const token = [cookies.upstox_access_token,cookies.upstox_extended_token].filter(Boolean);
  if (!token.length) return res.status(401).json({ connected: false, error: "Upstox not connected" });

  const key = String(req.query?.underlying || "nifty").toLowerCase();
  const instrumentKey = INSTRUMENTS[key] || INSTRUMENTS.nifty;
  const interval = Math.min(300, Math.max(1, parseInt(req.query?.interval || "5", 10) || 5));

  try {
    const url = "https://api.upstox.com/v3/historical-candle/intraday/" +
      encodeURIComponent(instrumentKey) + "/minutes/" + interval;
    const body = await getJson(url, token);
    const raw = Array.isArray(body?.data?.candles) ? body.data.candles : [];
    const candles = raw.map(x => ({
      ts: x[0], open: Number(x[1]), high: Number(x[2]), low: Number(x[3]),
      close: Number(x[4]), volume: Number(x[5]), oi: Number(x[6] || 0)
    })).filter(x => Number.isFinite(x.close));

    if (!candles.length) {
      return res.status(200).json({
        connected: true, source: "Upstox V3 Intraday Candles",
        instrument_key: instrumentKey, interval_minutes: interval,
        count: 0, message: "No intraday candles returned"
      });
    }

    const ordered = [...candles].reverse();
    let pv = 0, vv = 0;
    ordered.forEach(c => {
      const typical = (c.high + c.low + c.close) / 3;
      pv += typical * Math.max(0, c.volume);
      vv += Math.max(0, c.volume);
    });
    const vwap = vv > 0 ? pv / vv : null;
    const last = ordered[ordered.length - 1];
    const prev = ordered[ordered.length - 2] || null;
    const prior = ordered.slice(Math.max(0, ordered.length - 11), Math.max(0, ordered.length - 1));
    const avgVol = prior.length ? prior.reduce((s,c)=>s+c.volume,0)/prior.length : 0;
    const volumeRatio = avgVol > 0 ? last.volume / avgVol : null;

    const recent = ordered.slice(-8);
    const highs = recent.map(c=>c.high);
    const lows = recent.map(c=>c.low);
    let structure = "RANGE / INSUFFICIENT";
    if (recent.length >= 4) {
      const mid = Math.floor(recent.length/2);
      const h1 = Math.max(...highs.slice(0,mid)), h2 = Math.max(...highs.slice(mid));
      const l1 = Math.min(...lows.slice(0,mid)), l2 = Math.min(...lows.slice(mid));
      if (h2 > h1 && l2 > l1) structure = "HH-HL";
      else if (h2 < h1 && l2 < l1) structure = "LH-LL";
      else structure = "MIXED";
    }

    const aboveVWAP = vwap != null ? last.close > vwap : null;
    const candleBias = last.close > last.open ? "BULLISH" : last.close < last.open ? "BEARISH" : "NEUTRAL";
    const volumeSpike = volumeRatio != null && volumeRatio >= 1.5;

    function ema(values, period){
      if(values.length < period) return null;
      const k=2/(period+1);
      let e=values.slice(0,period).reduce((s,v)=>s+v,0)/period;
      for(let i=period;i<values.length;i++) e=values[i]*k+e*(1-k);
      return e;
    }
    function atr(values, period){
      if(values.length < period+1) return null;
      const trs=[];
      for(let i=1;i<values.length;i++){
        const c=values[i], p=values[i-1];
        trs.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));
      }
      return trs.slice(-period).reduce((s,v)=>s+v,0)/Math.min(period,trs.length);
    }
    const closes=ordered.map(c=>c.close);
    const ema20=ema(closes,20);
    const ema50=ema(closes,50);
    const atr14=atr(ordered,14);
    const emaSpread=(ema20!=null&&ema50!=null&&atr14>0)?Math.abs(ema20-ema50)/atr14:null;
    let marketRegime="INSUFFICIENT DATA";
    if(ema20!=null&&atr14!=null&&ema50==null&&ordered.length>=20){
      if(structure==="HH-HL" && last.close>ema20) marketRegime="EARLY TREND UP";
      else if(structure==="LH-LL" && last.close<ema20) marketRegime="EARLY TREND DOWN";
      else if(structure==="MIXED") marketRegime="EARLY RANGE / TRANSITION";
      else marketRegime="EARLY TRANSITION";
    } else if(ema20!=null&&ema50!=null&&atr14!=null){
      if(structure==="HH-HL" && last.close>ema20 && ema20>ema50) marketRegime="TREND UP";
      else if(structure==="LH-LL" && last.close<ema20 && ema20<ema50) marketRegime="TREND DOWN";
      else if(emaSpread<0.35 && structure==="MIXED") marketRegime="RANGE";
      else if((structure==="HH-HL" && ema20<ema50) || (structure==="LH-LL" && ema20>ema50)) marketRegime="REVERSAL WATCH";
      else marketRegime="TRANSITION";
    }
    const volumeState=volumeRatio==null?"UNAVAILABLE":volumeRatio>=1.5?"SPIKE":volumeRatio>=1.15?"ELEVATED":volumeRatio>=0.85?"NORMAL":"LOW";

    return res.status(200).json({
      connected: true,
      source: "Upstox V3 Intraday Candles",
      instrument_key: instrumentKey,
      interval_minutes: interval,
      count: ordered.length,
      latest: last,
      previous: prev,
      vwap,
      above_vwap: aboveVWAP,
      structure_5m: interval === 5 ? structure : null,
      candle_bias: candleBias,
      volume_ratio: volumeRatio,
      volume_spike: volumeSpike,
      volume_state: volumeState,
      ema20,
      ema50,
      atr14,
      ema_spread_atr: emaSpread,
      market_regime: marketRegime,
      regime_note: ema50==null && ordered.length<50 ? "EMA50 needs 50 five-minute candles; early-session regime uses EMA20 + structure + ATR only." : null,
      index_volume_note: vwap==null ? "Index candle volume is unavailable/zero; VWAP and volume ratio are not used as confirmation." : null,
      chart_candles: ordered.slice(-60)
    });
  } catch (e) {
    return res.status(502).json({ connected: true, source: "Upstox V3 Intraday Candles", error: e.message });
  }
};
