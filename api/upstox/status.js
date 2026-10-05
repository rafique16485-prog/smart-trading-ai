function getCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(p => {
    const i=p.indexOf("=");
    if(i>-1) out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim());
  });
  return out;
}
module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control","no-store");
  const c=getCookies(req);
  const token=c.upstox_access_token || c.upstox_extended_token;
  if(!token) return res.status(200).json({connected:false,reason:"not_logged_in"});
  try{
    const r=await fetch("https://api.upstox.com/v3/market-quote/ltp?instrument_key="+encodeURIComponent("NSE_INDEX|Nifty 50"),{
      headers:{Accept:"application/json",Authorization:"Bearer "+token}
    });
    const b=await r.json().catch(()=>({}));
    if(!r.ok){
      const expired=r.status===401||r.status===403;
      const clear=[
        "upstox_access_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        ...(expired?["upstox_extended_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"]:[])
      ];
      res.setHeader("Set-Cookie",clear);
      return res.status(200).json({connected:false,reason:expired?"token_expired":"upstox_unavailable"});
    }
    return res.status(200).json({connected:true,source:"Upstox V3",token_type:c.upstox_access_token?"access":"extended"});
  }catch(e){return res.status(200).json({connected:false,reason:"upstox_unreachable"});}
};