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
  const r=await fetch(url,{method:"GET",headers:{Accept:"application/json",Authorization:"Bearer "+token}});
  const body=await r.json().catch(()=>({}));
  return {r,body};
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const cookies=parseCookies(req.headers.cookie);
  if(!cookies.upstox_access_token&&!cookies.upstox_extended_token)return res.status(401).json({connected:false,error:"Upstox is not connected"});
  const raw=typeof req.query?.instrument_key==="string"?req.query.instrument_key:"";
  const instruments=raw?raw.split(",").map(x=>x.trim()).filter(Boolean).slice(0,20):DEFAULT_INSTRUMENTS;
  const url="https://api.upstox.com/v3/market-quote/quotes?instrument_key="+encodeURIComponent(instruments.join(","));
  try{
    let used="access";
    let result=cookies.upstox_access_token?await fetchQuotes(url,cookies.upstox_access_token):{r:{ok:false,status:401},body:{}};
    if(!result.r.ok&&cookies.upstox_extended_token){used="extended";result=await fetchQuotes(url,cookies.upstox_extended_token);}
    if(!result.r.ok)return res.status(result.r.status).json({connected:false,error:result.body?.errors||result.body?.message||"Upstox quote request failed"});
    if(used==="extended"&&cookies.upstox_access_token)res.setHeader("Set-Cookie","upstox_access_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    const data=result.body?.data||{};
    const quotes=Object.entries(data).map(([key,value])=>({instrument_key:key,last_price:value?.last_price??null,prev_close_price:value?.prev_close_price??value?.ohlc?.close??null,open:value?.ohlc?.open??null,high:value?.ohlc?.high??null,low:value?.ohlc?.low??null,volume:value?.ohlc?.volume??null,timestamp:value?.ohlc?.ts??null}));
    return res.status(200).json({connected:true,source:"Upstox V3",token_type:used,count:quotes.length,quotes});
  }catch(error){return res.status(502).json({connected:true,error:"Unable to reach Upstox market data API"});}
}