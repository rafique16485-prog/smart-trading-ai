function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > -1) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
      catch (_) { out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
    }
  });
  return out;
}

const UNDERLYINGS = {
  nifty: "NSE_INDEX|Nifty 50",
  "nifty-50": "NSE_INDEX|Nifty 50",
  banknifty: "NSE_INDEX|Nifty Bank",
  "bank-nifty": "NSE_INDEX|Nifty Bank"
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function optionSide(x) {
  return x?.market_data || {};
}

function istToday() {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

async function upstoxGet(url, tokens) {
  let last = null;
  for (const token of tokens.filter(Boolean)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    let response;
    let body;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: "Bearer " + token },
        cache: "no-store",
        signal: controller.signal
      });
      body = await response.json().catch(() => ({}));
    } catch (cause) {
      if (cause?.name === "AbortError") {
        const timeout = new Error("Upstox request timed out after 7 seconds");
        timeout.status = 504;
        throw timeout;
      }
      throw cause;
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) return { body, token };
    last = { status: response.status, message: body?.errors?.[0]?.message || body?.message || "Upstox request failed" };
    if (response.status !== 401 && response.status !== 403) break;
  }
  const error = new Error(last?.message || "Upstox authentication required");
  error.status = last?.status || 401;
  throw error;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const cookies = parseCookies(req.headers.cookie);
  const tokens = [
    cookies.upstox_access_token,
    cookies.upstox_extended_token,
    process.env.UPSTOX_ACCESS_TOKEN,
    process.env.UPSTOX_EXTENDED_TOKEN
  ].filter(Boolean);
  if (!tokens.length) return res.status(401).json({ connected: false, error: "Upstox is not connected" });

  const keyParam = String(req.query?.underlying || "nifty").toLowerCase();
  const instrumentKey = UNDERLYINGS[keyParam];
  if (!instrumentKey) return res.status(400).json({ connected: false, error: "Unsupported underlying. Use nifty or banknifty." });

  const requestedExpiry = String(req.query?.expiry || "current_week");
  const isRealDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + "T00:00:00.000Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const today = istToday();
  if (requestedExpiry !== "current_week" && !isRealDate(requestedExpiry)) {
    return res.status(400).json({ connected: false, error: "Expiry must be a real calendar date in YYYY-MM-DD format." });
  }
  if (requestedExpiry !== "current_week" && requestedExpiry < today) {
    return res.status(400).json({ connected: false, error: "Requested expiry is in the past. Choose a future expiry. WAIT — NO TRADE." });
  }

  try {
    let expiry = requestedExpiry;
    if (requestedExpiry === "current_week") {
      const contractsUrl = "https://api.upstox.com/v2/option/contract?instrument_key=" + encodeURIComponent(instrumentKey);
      const contractsResult = await upstoxGet(contractsUrl, tokens);
      const contracts = Array.isArray(contractsResult.body?.data) ? contractsResult.body.data : [];
      const expiries = [...new Set(contracts.map(x => String(x?.expiry || x?.expiry_date || "").slice(0, 10))
        .filter(x => isRealDate(x) && x >= today))].sort();
      if (!expiries.length) {
        return res.status(200).json({
          connected: true, source: "Upstox Option Chain", instrument_key: instrumentKey,
          expiry: null, count: 0, chain: [], full_chain: { pcr: null },
          message: "No future option expiry returned by Upstox. WAIT — NO TRADE."
        });
      }
      expiry = expiries[0];
    }

    const chainUrl = "https://api.upstox.com/v2/option/chain?instrument_key=" +
      encodeURIComponent(instrumentKey) + "&expiry_date=" + encodeURIComponent(expiry);
    const chainResult = await upstoxGet(chainUrl, tokens);
    const rows = Array.isArray(chainResult.body?.data) ? chainResult.body.data : [];
    if (!rows.length) {
      return res.status(200).json({
        connected: true, source: "Upstox Option Chain", instrument_key: instrumentKey,
        expiry, count: 0, chain: [], full_chain: { pcr: null },
        message: "No option-chain rows returned for the selected expiry. WAIT — NO TRADE."
      });
    }

    const spot = num(rows[0]?.underlying_spot_price);
    if (!(spot > 0)) {
      return res.status(502).json({ connected: true, error: "Invalid underlying spot price from Upstox. WAIT — NO TRADE." });
    }
    const strikes = rows.map(r => num(r.strike_price)).filter(x => x > 0).sort((a, b) => a - b);
    const atm = strikes.length ? strikes.reduce((best, strike) =>
      Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best, strikes[0]) : null;

    const fullCallOI = rows.reduce((s, r) => s + num(optionSide(r.call_options).oi), 0);
    const fullPutOI = rows.reduce((s, r) => s + num(optionSide(r.put_options).oi), 0);
    const fullCallPrevOI = rows.reduce((s, r) => s + num(optionSide(r.call_options).prev_oi), 0);
    const fullPutPrevOI = rows.reduce((s, r) => s + num(optionSide(r.put_options).prev_oi), 0);
    const selected = atm == null ? rows : rows.slice()
      .sort((a, b) => Math.abs(num(a.strike_price) - atm) - Math.abs(num(b.strike_price) - atm))
      .slice(0, 11).sort((a, b) => num(a.strike_price) - num(b.strike_price));
    const callOI = selected.reduce((s, r) => s + num(optionSide(r.call_options).oi), 0);
    const putOI = selected.reduce((s, r) => s + num(optionSide(r.put_options).oi), 0);

    const mapRow = (r) => {
      const ce = optionSide(r.call_options);
      const pe = optionSide(r.put_options);
      return {
        strike: num(r.strike_price),
        ce: { instrument_key: r.call_options?.instrument_key || null, ltp: num(ce.ltp), oi: num(ce.oi), oi_change: num(ce.oi) - num(ce.prev_oi), volume: num(ce.volume), iv: num(r.call_options?.option_greeks?.iv) },
        pe: { instrument_key: r.put_options?.instrument_key || null, ltp: num(pe.ltp), oi: num(pe.oi), oi_change: num(pe.oi) - num(pe.prev_oi), volume: num(pe.volume), iv: num(r.put_options?.option_greeks?.iv) }
      };
    };

    return res.status(200).json({
      connected: true, source: "Upstox Option Chain", token_type: "verified",
      server_token: !cookies.upstox_access_token && !!(process.env.UPSTOX_ACCESS_TOKEN || process.env.UPSTOX_EXTENDED_TOKEN),
      instrument_key: instrumentKey, expiry, spot, atm_strike: atm,
      full_chain: {
        strikes: rows.length, call_oi: fullCallOI, put_oi: fullPutOI,
        call_oi_change: fullCallOI - fullCallPrevOI, put_oi_change: fullPutOI - fullPutPrevOI,
        pcr: fullCallOI > 0 ? Number((fullPutOI / fullCallOI).toFixed(3)) : null
      },
      atm_window: {
        strikes: selected.length, call_oi: callOI, put_oi: putOI,
        pcr: callOI > 0 ? Number((putOI / callOI).toFixed(3)) : null
      },
      chain: selected.map(mapRow)
    });
  } catch (error) {
    const status = error.status || 502;
    return res.status(status).json({
      connected: status !== 401 && status !== 403,
      error: status === 401 || status === 403
        ? "Upstox session expired or authorization failed. Reconnect Upstox."
        : status === 504
          ? "Upstox option-chain request timed out after 7 seconds. Retry; WAIT — NO TRADE."
          : "Upstox option-chain request failed. Check connection and retry.",
      verdict: "WAIT — NO TRADE"
    });
  }
}
