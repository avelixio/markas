/** The longest key name the Keyring takes: as long as a host can be. */
const MAX_NAME = 253;

/**
 * A name for a new key, made from its website: the site's own host, so "https://app.example.com"
 * gives "app.example.com". A leading "www." and the port are left out. Anything the Keyring
 * does not take in a name becomes a dash.
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
  const used = new Set(taken);
  if (!used.has(name)) return name;
  for (let count = 2; ; count += 1) {
    const candidate = `${name.slice(0, MAX_NAME - String(count).length - 1)}-${count}`;
    if (!used.has(candidate)) return candidate;
  }
}
