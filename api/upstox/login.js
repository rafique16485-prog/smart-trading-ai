const crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const clientId = process.env.UPSTOX_CLIENT_ID;
  const redirectUri = process.env.UPSTOX_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: "Upstox environment variables are not configured" });
  }

  const state = crypto.randomBytes(24).toString("hex");
  res.setHeader("Set-Cookie", [
    `upstox_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  ]);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state
  });

  res.writeHead(302, {
    Location: `https://api.upstox.com/v2/login/authorization/dialog?${params.toString()}`
  });
  res.end();
};
