function getCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(p => {
    const i=p.indexOf("=");
    if(i>-1) out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim());
  });
  return out;
}
async function check(token){
  const r=await fetch("https://api.upstox.com/v3/market-quote/ltp?instrument_key="+encodeURIComponent("NSE_INDEX|Nifty 50"),{headers:{Accept:"application/json",Authorization:"Bearer "+token}});
  const b=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:b};
}
module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control","no-store");
  const c=getCookies(req);
  // Prefer the user's OAuth session, but allow a securely configured server-side
  // token so the Android APK can receive live quotes without depending on a
  // WebView cookie surviving the OAuth redirect.
  const accessToken=c.upstox_access_token || process.env.UPSTOX_ACCESS_TOKEN || null;
  const extendedToken=c.upstox_extended_token || process.env.UPSTOX_EXTENDED_TOKEN || null;
  if(!accessToken && !extendedToken) return res.status(200).json({connected:false,reason:"not_logged_in"});
  try{
    let used="access";
    let r=accessToken?await check(accessToken):{ok:false,status:401};
    if(!r.ok && extendedToken){
      used="extended";
      r=await check(extendedToken);
    }
    if(!r.ok){
      const expired=r.status===401||r.status===403;
      const clear=[
        "upstox_access_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        ...(expired?["upstox_extended_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"]:[])
      ];
      res.setHeader("Set-Cookie",clear);
      return res.status(200).json({connected:false,reason:expired?"token_expired":"upstox_unavailable"});
    }
    if(used==="extended" && c.upstox_access_token){
      res.setHeader("Set-Cookie","upstox_access_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    }
    return res.status(200).json({connected:true,source:"Upstox V3",token_type:used,server_token:!c.upstox_access_token&&!!process.env.UPSTOX_ACCESS_TOKEN});
  }catch(e){return res.status(200).json({connected:false,reason:"upstox_unreachable"});}
};