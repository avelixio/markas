// Turns GitHub's release download counts and Vercel's Web Analytics rows into the numbers page.
// Pure functions, so the rules are tested without the network.

/** The website's download pages, one per file the button can give. */
export const DOWNLOAD_TARGETS = {
  windows: "Windows",
  "macos-arm64": "macOS, Apple silicon",
  "macos-x64": "macOS, Intel",
  linux: "Linux",
};

const total = (assets, pattern) =>
  assets
    .filter((asset) => pattern.test(asset.name))
    .reduce((sum, asset) => sum + (asset.download_count ?? 0), 0);

/**
 * One release's downloads by system and by way of installing.
 * The install script and Homebrew download the same command-line zip; only the install script
 * also downloads the SHA-256 list, so Homebrew is the zip count minus the list count.
 */
export function summarizeRelease(release) {
  const assets = release.assets ?? [];
  const sums = (target) => total(assets, new RegExp(`^SHA256SUMS-${target}\\.txt$`));
  const zip = (target) => total(assets, new RegExp(`^markas-.*-${target}\\.zip$`));
  const scriptMac = sums("macos-arm64") + sums("macos-x64");
  return {
    release: String(release.tag_name ?? "").replace(/^v/, ""),
    published: String(release.published_at ?? "").slice(0, 10),
    windowsApp: total(assets, /^Markas-Setup-.*\.exe$|^Markas-.*-win-x64\.zip$/),
    macosApp: total(assets, /^Markas-.*-mac-(arm64|x64)\.(dmg|zip)$/),
    linuxApp: total(assets, /\.AppImage$/),
    installScript: scriptMac + sums("linux-x64"),
    homebrew: Math.max(0, zip("macos-arm64") + zip("macos-x64") - scriptMac),
    windowsCommand: zip("windows-x64"),
  };
}

export function summarizeReleases(releases) {
  const rows = releases.map(summarizeRelease);
  const sum = (key) => rows.reduce((value, row) => value + row[key], 0);
  return {
    releases: rows,
    appDownloads: sum("windowsApp") + sum("macosApp") + sum("linuxApp"),
    commandInstalls: sum("installScript") + sum("homebrew") + sum("windowsCommand"),
  };
}

/** Clicks on the download button, from the page views of /download/<target>. */
export function clicksFromPaths(rows) {
  const counts = Object.fromEntries(Object.keys(DOWNLOAD_TARGETS).map((target) => [target, 0]));
  for (const row of rows ?? []) {
    const match = /^\/download\/([a-z0-9-]+)\/?$/.exec(row.requestPath ?? "");
    if (match && match[1] in counts) counts[match[1]] += row.pageviews ?? 0;
  }
  return Object.entries(DOWNLOAD_TARGETS).map(([target, name]) => ({
    target,
    name,
    clicks: counts[target],
  }));
}

/** Every day in the range, with zero for a quiet day, so the chart has no gaps. */
export function fillDays(rows, since, days) {
  const byDay = new Map(
    (rows ?? []).map((row) => [String(row.timestamp ?? row.day ?? "").slice(0, 10), row]),
  );
  const start = new Date(`${since}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(day);
    return { day, visitors: row?.visitors ?? 0, pageviews: row?.pageviews ?? 0 };
  });
}

/**
 * Downloads per day from the daily snapshots of the total, newest last. A day's number is the
 * growth since the snapshot before it; a total that went down (a file replaced) counts as zero.
 */
export function downloadsPerDay(snapshots) {
  const sorted = [...(snapshots ?? [])].sort((left, right) => left.day.localeCompare(right.day));
  return sorted.slice(1).map((snapshot, index) => ({
    day: snapshot.day,
    downloads: Math.max(0, snapshot.total - sorted[index].total),
  }));
}

/** Reads the snapshot file: one JSON object per line, lines that do not parse are left out. */
export function parseSnapshots(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => {
      try {
        const value = JSON.parse(line);
        return typeof value?.day === "string" && Number.isFinite(value?.total) ? value : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** The first day of a range that ends today, in UTC. */
export function rangeStart(days, now = new Date()) {
  return new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}
