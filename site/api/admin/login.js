// POST /api/admin/login with {"password": "..."}: starts the owner's session.
import {
  configuredPassword,
  createSession,
  json,
  passwordMatches,
  sameOrigin,
  sessionCookie,
} from "../_lib/session.js";

/** A wrong password waits a second, so guessing many is slow. */
export const WRONG_PASSWORD_DELAY_MS = 1000;

export async function POST(request, { env = process.env, delay = WRONG_PASSWORD_DELAY_MS } = {}) {
  if (!sameOrigin(request)) return json({ error: "This request did not come from the page." }, 403);
  const password = configuredPassword(env);
  if (!password) {
    return json(
      {
        error:
          "The numbers page is not set up: ADMIN_PASSWORD is missing or shorter than 16 characters.",
      },
      503,
    );
  }
  let given = "";
  try {
    given = (await request.json())?.password;
  } catch {
    return json({ error: "Send the password as JSON." }, 400);
  }
  if (!passwordMatches(given, password)) {
    await new Promise((done) => setTimeout(done, delay));
    return json({ error: "That password is not right." }, 401);
  }
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(createSession(password)) });
}
