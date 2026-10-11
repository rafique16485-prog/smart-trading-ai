function getCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(p => {
    const i=p.indexOf("=");
    if(i>-1) { try { out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1)); } catch (_) {} }
  });
  return out;
}
async function check(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const r = await fetch("https://api.upstox.com/v3/market-quote/ltp?instrument_key="+encodeURIComponent("NSE_INDEX|Nifty 50"), {
      headers: { Accept:"application/json", Authorization:"Bearer "+token },
      cache:"no-store", signal:controller.signal
    });
    const b = await r.json().catch(() => ({}));
    return { ok:r.ok, status:r.status, body:b };
  } finally { clearTimeout(timer); }
}
function safeMessage(reason) {
  const messages = {
    not_logged_in:"Upstox login is missing. Connect Upstox first.",
    token_expired:"Upstox token expired or was rejected. Reconnect Upstox.",
    upstox_unavailable:"Upstox API rejected the request or is temporarily unavailable.",
    upstox_unreachable:"Could not reach Upstox within the time limit. Check connection and retry.",
    invalid_quote:"Upstox responded, but a valid NIFTY quote was not present."
  };
  return messages[reason] || "Upstox connection needs attention.";
}
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "GET") return res.status(405).json({ error:"Method not allowed" });
  const c = getCookies(req);
  const accessToken = c.upstox_access_token || process.env.UPSTOX_ACCESS_TOKEN || null;
  const extendedToken = c.upstox_extended_token || process.env.UPSTOX_EXTENDED_TOKEN || null;
  const config = {
    client_id: !!process.env.UPSTOX_CLIENT_ID,
    client_secret: !!process.env.UPSTOX_CLIENT_SECRET,
    redirect_uri: !!process.env.UPSTOX_REDIRECT_URI,
    access_token: !!(c.upstox_access_token || process.env.UPSTOX_ACCESS_TOKEN),
    extended_token: !!(c.upstox_extended_token || process.env.UPSTOX_EXTENDED_TOKEN)
  };
  if (!accessToken && !extendedToken) {
    return res.status(200).json({ connected:false, reason:"not_logged_in", message:safeMessage("not_logged_in"), diagnostics:config, verdict:"WAIT — NO TRADE" });
  }
  try {
    let used = "access";
    let result = accessToken ? await check(accessToken) : { ok:false, status:401, body:{} };
    if (!result.ok && extendedToken) {
      used = "extended";
      result = await check(extendedToken);
    }
    if (!result.ok) {
      const expired = result.status === 401 || result.status === 403;
      const reason = expired ? "token_expired" : "upstox_unavailable";
      const clear = ["upstox_access_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"];
      if (expired) clear.push("upstox_extended_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
      res.setHeader("Set-Cookie", clear);
      return res.status(200).json({ connected:false, reason, message:safeMessage(reason), http_status:result.status, token_type:used, diagnostics:config, verdict:"WAIT — NO TRADE" });
    }
    const data = result.body?.data || {};
    const values = Object.values(data);
    const quote = values.find(x => Number(x?.last_price) > 0);
    if (!quote) {
      return res.status(200).json({ connected:false, reason:"invalid_quote", message:safeMessage("invalid_quote"), token_type:used, diagnostics:config, verdict:"WAIT — NO TRADE" });
    }
    if (used === "extended" && c.upstox_access_token) {
      res.setHeader("Set-Cookie","upstox_access_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    }
    return res.status(200).json({
      connected:true, source:"Upstox V3", token_type:used,
      server_token:!c.upstox_access_token && !!process.env.UPSTOX_ACCESS_TOKEN,
      diagnostics:config, checked_at:new Date().toISOString(), verdict:"CONNECTION OK — verify quote freshness before trading"
    });
  } catch (e) {
    const reason = e?.name === "AbortError" ? "upstox_unreachable" : "upstox_unavailable";
    return res.status(200).json({ connected:false, reason, message:safeMessage(reason), diagnostics:config, verdict:"WAIT — NO TRADE" });
  }
};
