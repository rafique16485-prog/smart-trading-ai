function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const item = raw.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { code, state, error, error_description } = req.query || {};
  if (error) {
    return res.status(400).send(`<h2>Upstox Login Failed</h2><p>${error_description || error}</p><p><a href="/">Back to Smart Trading AI</a></p>`);
  }

  const expectedState = getCookie(req, "upstox_oauth_state");
  if (!code || !state || !expectedState || state !== expectedState) {
    return res.status(400).send("<h2>Upstox Login Failed</h2><p>Invalid or expired OAuth state.</p><p><a href='/'>Back to Smart Trading AI</a></p>");
  }

  const clientId = process.env.UPSTOX_CLIENT_ID;
  const clientSecret = process.env.UPSTOX_CLIENT_SECRET;
  const redirectUri = process.env.UPSTOX_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).send("<h2>Upstox Setup Incomplete</h2><p>Required server environment variables are missing.</p>");
  }

  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });

    const tokenResponse = await fetch("https://api.upstox.com/v2/login/authorization/token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const data = await tokenResponse.json();

    if (!tokenResponse.ok || !data.access_token) {
      return res.status(502).send(`<h2>Upstox Token Exchange Failed</h2><pre>${JSON.stringify(data, null, 2)}</pre><p><a href="/">Back</a></p>`);
    }

    const maxAge = 60 * 60 * 12;
    const cookies = [
      `upstox_access_token=${encodeURIComponent(data.access_token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
      "upstox_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    ];
    if (data.extended_token) cookies.push(`upstox_extended_token=${encodeURIComponent(data.extended_token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    res.setHeader("Set-Cookie", cookies);

    res.writeHead(302, { Location: "/?upstox=connected" });
    res.end();
  } catch (e) {
    return res.status(500).send("<h2>Upstox Connection Error</h2><p>Server could not complete the token exchange.</p><p><a href='/'>Back</a></p>");
  }
};
