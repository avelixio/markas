export class KeyringOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyringOriginError";
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The exact site a login belongs to: scheme, full host and port.
 * Never the parent domain, so metrics.example.com and admin.example.com are different sites
 * and can each hold their own logins.
 */
export function normalizeOrigin(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new KeyringOriginError("A website is required.");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new KeyringOriginError(`"${input}" is not a website address.`);
  }
  if (url.username || url.password) {
    throw new KeyringOriginError("Leave the username and password out of the website address.");
  }
  const secure = url.protocol === "https:";
  if (!secure && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new KeyringOriginError("Logins need an https website.");
  }
  // URL.origin drops the default port and lower-cases the host.
  return url.origin;
}

/** True when a page address is on exactly the saved site. */
export function isSameOrigin(savedOrigin: string, pageUrl: string): boolean {
  try {
    return new URL(pageUrl).origin === savedOrigin;
  } catch {
    return false;
  }
}
