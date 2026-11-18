/** The longest key name the Keyring takes. */
const MAX_NAME = 100;

/**
 * The name a new key starts with, made from its website: the site's own host, so
 * "https://app.example.com" gives "app.example.com". A leading "www." and the port are left out.
 * It is only a starting point: the person can name a key anything, such as "web example".
 */
export function keyNameFor(site: string): string {
  let host: string;
  try {
    host = new URL(site).hostname;
  } catch {
    host = site;
  }
  const name = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .map((part) => part.replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, ""))
    .filter(Boolean)
    .join(".")
    .slice(0, MAX_NAME)
    .replace(/[.-]+$/, "");
  return name || "login";
}

/**
 * The name made unique among the names already in use: "app.example.com", then
 * "app.example.com-2", and so on, for a second key on the same site.
 */
export function uniqueKeyName(name: string, taken: readonly string[]): string {
  // The Keyring treats "App.example.com" and "app.example.com" as one name.
  const used = new Set(taken.map((entry) => entry.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let count = 2; ; count += 1) {
    const candidate = `${name.slice(0, MAX_NAME - String(count).length - 1)}-${count}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
