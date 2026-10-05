function cookies(header){const o={};String(header||"").split(";").forEach(p=>{const i=p.indexOf("=");if(i>0)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())});return o}
async function get(url,token){const tokens=Array.isArray(token)?token.filter(Boolean):[token];let last=null;for(const t of tokens){const r=await fetch(url,{headers:{Accept:"application/json",Authorization:"Bearer "+t}});const b=await r.json().catch(()=>({}));if(r.ok)return b;last=new Error(b?.errors?.[0]?.message||b?.message||"Request failed");if(r.status!==401&&r.status!==403)break;}throw last||new Error("Request failed")}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 const jar=cookies(req.headers.cookie);const token=[jar.upstox_access_token,jar.upstox_extended_token].filter(Boolean);
 if(!token.length)return res.status(401).json({connected:false,error:"Upstox is not connected"});
 const date=new Date(Date.now()+330*60000).toISOString().slice(0,10);
 try{
  const [fii,dii]=await Promise.all([
   get("https://api.upstox.com/v2/market/fii?date="+encodeURIComponent(date)+"&data_type=equity",token),
   get("https://api.upstox.com/v2/market/dii?date="+encodeURIComponent(date)+"&data_type=equity",token)
  ]);
  return res.status(200).json({connected:true,date,source:"Upstox",fii:fii?.data||fii,dii:dii?.data||dii});
 }catch(e){return res.status(502).json({connected:true,error:"FII/DII data unavailable",message:e.message})}
}