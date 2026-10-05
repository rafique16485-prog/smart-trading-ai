function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
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
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function optionSide(x) {
  return x?.market_data || {};
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.upstox_access_token || cookies.upstox_extended_token;

  if (!token) {
    return res.status(401).json({ connected: false, error: "Upstox is not connected" });
  }

  const keyParam = String(req.query?.underlying || "nifty").toLowerCase();
  const instrumentKey = UNDERLYINGS[keyParam] || UNDERLYINGS.nifty;
  const expiry = String(req.query?.expiry || "current_week");

  const url =
    "https://api.upstox.com/v2/option/chain?instrument_key=" +
    encodeURIComponent(instrumentKey) +
    "&expiry_date=" +
    encodeURIComponent(expiry);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + token
      }
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        connected: response.status !== 401,
        token_type: cookies.upstox_access_token ? "access" : "extended",
        error: body?.errors || body?.message || "Upstox option chain request failed"
      });
    }

    const rows = Array.isArray(body?.data) ? body.data : [];
    if (!rows.length) {
      return res.status(200).json({
        connected: true,
        source: "Upstox Option Chain",
        instrument_key: instrumentKey,
        expiry,
        count: 0,
        message: "No option-chain rows returned"
      });
    }

    const spot = num(rows[0]?.underlying_spot_price);
    const strikes = rows
      .map((r) => num(r.strike_price))
      .filter(Boolean)
      .sort((a, b) => a - b);

    const atm = strikes.length
      ? strikes.reduce((best, strike) =>
          Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best, strikes[0])
      : null;

    const fullCallOI = rows.reduce((s, r) => s + num(optionSide(r.call_options).oi), 0);
    const fullPutOI = rows.reduce((s, r) => s + num(optionSide(r.put_options).oi), 0);
    const fullCallPrevOI = rows.reduce((s, r) => s + num(optionSide(r.call_options).prev_oi), 0);
    const fullPutPrevOI = rows.reduce((s, r) => s + num(optionSide(r.put_options).prev_oi), 0);

    const selected = atm == null ? rows : rows
      .slice()
      .sort((a, b) => Math.abs(num(a.strike_price) - atm) - Math.abs(num(b.strike_price) - atm))
      .slice(0, 11)
      .sort((a, b) => num(a.strike_price) - num(b.strike_price));

    const callOI = selected.reduce((s, r) => s + num(optionSide(r.call_options).oi), 0);
    const putOI = selected.reduce((s, r) => s + num(optionSide(r.put_options).oi), 0);

    const mapRow = (r) => {
      const ce = optionSide(r.call_options);
      const pe = optionSide(r.put_options);
      return {
        strike: num(r.strike_price),
        ce: {
          instrument_key: r.call_options?.instrument_key || null,
          ltp: num(ce.ltp),
          oi: num(ce.oi),
          oi_change: num(ce.oi) - num(ce.prev_oi),
          volume: num(ce.volume),
          iv: num(r.call_options?.option_greeks?.iv)
        },
        pe: {
          instrument_key: r.put_options?.instrument_key || null,
          ltp: num(pe.ltp),
          oi: num(pe.oi),
          oi_change: num(pe.oi) - num(pe.prev_oi),
          volume: num(pe.volume),
          iv: num(r.put_options?.option_greeks?.iv)
        }
      };
    };

    return res.status(200).json({
      connected: true,
      source: "Upstox Option Chain",
      token_type: cookies.upstox_access_token ? "access" : "extended",
      instrument_key: instrumentKey,
      expiry: rows[0]?.expiry || expiry,
      spot,
      atm_strike: atm,
      full_chain: {
        strikes: rows.length,
        call_oi: fullCallOI,
        put_oi: fullPutOI,
        call_oi_change: fullCallOI - fullCallPrevOI,
        put_oi_change: fullPutOI - fullPutPrevOI,
        pcr: fullCallOI > 0 ? Number((fullPutOI / fullCallOI).toFixed(3)) : null
      },
      atm_window: {
        strikes: selected.length,
        call_oi: callOI,
        put_oi: putOI,
        pcr: callOI > 0 ? Number((putOI / callOI).toFixed(3)) : null
      },
      chain: selected.map(mapRow)
    });
  } catch (error) {
    return res.status(502).json({
      connected: true,
      error: "Unable to reach Upstox option chain API"
    });
  }
}
