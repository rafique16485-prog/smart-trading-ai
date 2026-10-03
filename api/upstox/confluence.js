const https = require("https");

const INSTRUMENTS = {
  nifty: "NSE_INDEX|Nifty 50",
  "nifty-50": "NSE_INDEX|Nifty 50",
  banknifty: "NSE_INDEX|Nifty Bank",
  "bank-nifty": "NSE_INDEX|Nifty Bank"
};

function getJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Accept: "application/json", Authorization: "Bearer " + token }
    }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(parsed?.errors?.[0]?.message || parsed?.message || "Upstox candle request failed (" + res.statusCode + ")"));
        }
        resolve(parsed || {});
      });
    });
    req.on("error", reject);
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

  const token = parseCookies(req).upstox_access_token;
  if (!token) return res.status(401).json({ connected: false, error: "Upstox not connected" });

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
      volume_spike: volumeSpike
    });
  } catch (e) {
    return res.status(502).json({ connected: true, source: "Upstox V3 Intraday Candles", error: e.message });
  }
};
