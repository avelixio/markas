# ADR 0002: Host authentication with a bearer token and a session cookie

- Status: accepted
- Date: 2026-11-11

## Context

The host controls agents that have full access to the machine.
Any local web page, and any website the user visits, can send requests to a loopback port.
The UI also needs to load images and open an event stream, and neither can carry an `Authorization` header.

## Decision

- A 256-bit random token is created on first run in `~/.markas/token` with mode 0600.
- Scripts send it as `Authorization: Bearer <token>`.
- The browser exchanges it once at `POST /api/session` for an `HttpOnly`, `SameSite=Strict` cookie.
- `markas open` puts the token in the URL fragment, which is never sent to a server, and the page removes it from the address bar immediately.
- Every request must carry a loopback `Host` header, which blocks DNS rebinding.
- A request with an `Origin` header is refused unless the origin is the host itself.
- Method calls must be `application/json`, so a cross-site form post cannot reach them.
- Attachments are served with a sandboxing content security policy, because their content is untrusted.

## Consequences

- The static UI files are served without a token, since they contain no user data.
- Anyone who can read `~/.markas/token` controls the host, the same trust boundary as the user's own files.
- Token comparison hashes both sides first, so it runs in constant time and leaks no length.
