// POST /api/admin/logout: ends the session in this browser.
import { clearedCookie, json, sameOrigin } from "../_lib/session.js";

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: "This request did not come from the page." }, 403);
  return json({ ok: true }, 200, { "set-cookie": clearedCookie() });
}
