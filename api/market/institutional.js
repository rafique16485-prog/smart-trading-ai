function cookies(header){const o={};String(header||"").split(";").forEach(p=>{const i=p.indexOf("=");if(i>0)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())});return o}
async function get(url,token){const r=await fetch(url,{headers:{Accept:"application/json",Authorization:"Bearer "+token}});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b?.errors?.[0]?.message||b?.message||"Request failed");return b}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 const token=cookies(req.headers.cookie).upstox_access_token||cookies(req.headers.cookie).upstox_extended_token;
 if(!token)return res.status(401).json({connected:false,error:"Upstox is not connected"});
 const date=new Date(Date.now()+330*60000).toISOString().slice(0,10);
 try{
  const [fii,dii]=await Promise.all([
   get("https://api.upstox.com/v2/market/fii?date="+encodeURIComponent(date)+"&data_type=equity",token),
   get("https://api.upstox.com/v2/market/dii?date="+encodeURIComponent(date)+"&data_type=equity",token)
  ]);
  return res.status(200).json({connected:true,date,source:"Upstox",fii:fii?.data||fii,dii:dii?.data||dii});
 }catch(e){return res.status(502).json({connected:true,error:"FII/DII data unavailable",message:e.message})}
}