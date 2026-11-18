// How often each release was downloaded, from the counts GitHub keeps for every release file.
// Nothing is collected by Markas itself: this only reads public numbers from GitHub.
//
//   bun scripts/download-stats.ts            every release
//   bun scripts/download-stats.ts 0.1.2      one release
//
// The install script and Homebrew both download the same command-line zip, so they are told
// apart by the SHA-256 list, which only the install script downloads with it:
//   install script ~ SHA-256 list downloads
//   Homebrew       ~ command-line zip downloads minus SHA-256 list downloads (macOS only)
// The numbers are estimates: CI's own install checks, and anyone who downloads a list or a zip
// by hand, count too.
export {};

const REPO = "avelixio/markas";

interface Asset {
  name: string;
  download_count: number;
}
interface Release {
  tag_name: string;
  published_at: string;
  assets: Asset[];
}

const wanted = process.argv[2]?.replace(/^v/, "");
const headers: Record<string, string> = { accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
  headers,
});
if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
const releases = ((await response.json()) as Release[]).filter(
  (release) => !wanted || release.tag_name.replace(/^v/, "") === wanted,
);
if (releases.length === 0) throw new Error(`There is no release ${wanted}.`);

const count = (assets: Asset[], pattern: RegExp) =>
  assets
    .filter((asset) => pattern.test(asset.name))
    .reduce((sum, asset) => sum + asset.download_count, 0);

const rows = releases.map((release) => {
  const a = release.assets;
  const sums = (target: string) => count(a, new RegExp(`^SHA256SUMS-${target}\\.txt$`));
  const zip = (target: string) => count(a, new RegExp(`^markas-.*-${target}\\.zip$`));
  const scriptMac = sums("macos-arm64") + sums("macos-x64");
  const scriptLinux = sums("linux-x64");
  const brew = Math.max(0, zip("macos-arm64") + zip("macos-x64") - scriptMac);
  return {
    release: release.tag_name,
    published: release.published_at.slice(0, 10),
    "Windows app": count(a, /^Markas-Setup-.*\.exe$|^Markas-.*-win-x64\.zip$/),
    "macOS app": count(a, /^Markas-.*-mac-(arm64|x64)\.(dmg|zip)$/),
    "Linux app": count(a, /\.AppImage$/),
    "install script": scriptMac + scriptLinux,
    Homebrew: brew,
    "Windows command": zip("windows-x64"),
  };
});

console.table(rows);
const total = rows.reduce(
  (sum, row) =>
    sum +
    row["Windows app"] +
    row["macOS app"] +
    row["Linux app"] +
    row["install script"] +
    row.Homebrew +
    row["Windows command"],
  0,
);
console.log(
  `Installs and downloads in all: about ${total}. Visits to the website are in Vercel's Web Analytics.`,
);
