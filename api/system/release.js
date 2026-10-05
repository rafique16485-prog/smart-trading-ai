export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  return res.status(200).json({
    product:"Smart Trading AI",
    release:"FINAL-1.0",
    status:"FEATURE_FREEZE",
    build:"10KX",
    rule:"No more cosmetic/numbered upgrades. Only bug fixes, security fixes, verified-data fixes and explicitly requested missing capabilities.",
    verifiedModules:[
      "Index dashboard: NIFTY 50, BANK NIFTY, SENSEX, India VIX",
      "Upstox OAuth/token fallback",
      "Market regime + VWAP + EMA + 5-minute structure",
      "Option-chain PCR/OI/volume",
      "FII/DII verified flow",
      "Top 10 equity swing scanner",
      "Multi-timeframe scanner kill gate",
      "Setup Quality /100",
      "Adaptive strike selector",
      "Option Quality /100",
      "Contract liquidity/spread/expiry firewall",
      "Unified hard-gate scorecard /100",
      "Trade Journal",
      "Equity historical backtest",
      "WhatsApp sharing",
      "Android WebView shell"
    ],
    knownLimitations:[
      "The existing equity backtest is not an option-premium backtest.",
      "True expired-option historical candles require the Upstox Expired Instruments APIs and an eligible Upstox Plus subscription.",
      "No live market call is guaranteed; missing or stale verification produces WAIT."
    ],
    acceptance:[
      "No invented prices or historical results",
      "Final Trade Gate remains WAIT unless required verified gates pass",
      "Production deployment must be READY before release is called live"
    ]
  });
}