function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const item = raw.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const token = getCookie(req, "upstox_access_token");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ connected: !!token });
};
