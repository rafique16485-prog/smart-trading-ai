function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
const DEFAULT_INSTRUMENTS=["NSE_INDEX|Nifty 50","NSE_INDEX|Nifty Bank","BSE_INDEX|SENSEX","NSE_INDEX|India VIX"];
async function fetchQuotes(url, token){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),7000);
  try{
    const r=await fetch(url,{method:"GET",headers:{Accept:"application/json",Authorization:"Bearer "+token},cache:"no-store",signal:controller.signal});
    const body=await r.json().catch(()=>({}));
    return {r,body};
  }finally{clearTimeout(timer);}
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const cookies=parseCookies(req.headers.cookie);
  // OAuth cookies are preferred. Server-side tokens are the reliable fallback
  // for Android WebView/native APK sessions where cookies may not persist.
  const accessToken=cookies.upstox_access_token || process.env.UPSTOX_ACCESS_TOKEN || null;
  const extendedToken=cookies.upstox_extended_token || process.env.UPSTOX_EXTENDED_TOKEN || null;
  if(!accessToken&&!extendedToken)return res.status(401).json({connected:false,error:"Upstox is not connected"});
  const raw=typeof req.query?.instrument_key==="string"?req.query.instrument_key:"";
  const instruments=raw?raw.split(",").map(x=>x.trim()).filter(Boolean).slice(0,20):DEFAULT_INSTRUMENTS;
  const url="https://api.upstox.com/v3/market-quote/quotes?instrument_key="+encodeURIComponent(instruments.join(","));
  try{
    let used="access";
    let result=accessToken?await fetchQuotes(url,accessToken):{r:{ok:false,status:401},body:{}};
    if(!result.r.ok&&extendedToken){used="extended";result=await fetchQuotes(url,extendedToken);}
    if(!result.r.ok){const status=result.r.status;const reason=status===401||status===403?"token_expired":status===429?"rate_limited":"upstox_unavailable";const message=reason==="token_expired"?"Upstox token expired or was rejected. Reconnect Upstox.":reason==="rate_limited"?"Upstox rate limit reached. Wait and retry.":"Upstox quote API is temporarily unavailable.";return res.status(status).json({connected:false,reason,message,verdict:"WAIT — NO TRADE"});}
    if(used==="extended"&&cookies.upstox_access_token)res.setHeader("Set-Cookie","upstox_access_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    const data=result.body?.data||{};
    const quotes=Object.entries(data).map(([key,value])=>({instrument_key:key,last_price:value?.last_price??null,prev_close_price:value?.prev_close_price??value?.ohlc?.close??null,open:value?.ohlc?.open??null,high:value?.ohlc?.high??null,low:value?.ohlc?.low??null,volume:value?.ohlc?.volume??null,timestamp:value?.ohlc?.ts??null}));
    return res.status(200).json({connected:true,source:"Upstox V3",token_type:used,server_token:!cookies.upstox_access_token&&!!process.env.UPSTOX_ACCESS_TOKEN,count:quotes.length,quotes});
  }catch(error){const timeout=error?.name==="AbortError";return res.status(502).json({connected:false,reason:timeout?"upstox_timeout":"upstox_unreachable",message:timeout?"Upstox quote request timed out after 7 seconds. Retry before trading.":"Unable to reach Upstox market data API.",verdict:"WAIT — NO TRADE"});}
}