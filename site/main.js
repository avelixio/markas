// Points the download button at the right file for this visitor's system, from the newest
// GitHub release, and copies the install command. Without JavaScript, or when GitHub cannot be
// reached, the button opens the release page, which lists every file.
const REPO = "avelixio/markas";

/** Which system the visitor is on, as far as the browser says. */
async function detectSystem() {
  const data = navigator.userAgentData;
  const platform = (data?.platform || navigator.platform || "").toLowerCase();
  const agent = navigator.userAgent.toLowerCase();
  if (data?.mobile || /android|iphone|ipad|ipod/.test(agent)) return { os: "mobile" };
  if (platform.startsWith("win") || agent.includes("windows")) return { os: "windows" };
  if (platform.startsWith("mac") || agent.includes("mac os")) {
    // Only Chromium browsers say which processor a Mac has; most Macs sold now are Apple silicon.
    let arch = "arm64";
    try {
      const details = await data?.getHighEntropyValues?.(["architecture"]);
      if (details?.architecture === "x86") arch = "x64";
    } catch {
      // Keep the default.
    }
    return { os: "macos", arch };
  }
  if (platform.includes("linux") || agent.includes("linux")) return { os: "linux" };
  return { os: "unknown" };
}

/** The file a person on this system downloads, from the release's list of files. */
function pickAsset(assets, system) {
  const find = (pattern) => assets.find((asset) => pattern.test(asset.name));
  if (system.os === "windows") return find(/^Markas-Setup-.*\.exe$/);
  if (system.os === "macos") return find(new RegExp(`^Markas-.*-mac-${system.arch}\\.dmg$`));
  if (system.os === "linux") return find(/\.AppImage$/);
  return undefined;
}

const NAMES = { windows: "Windows", macos: "macOS", linux: "Linux" };

async function setUpDownload() {
  const button = document.getElementById("download");
  const label = document.getElementById("download-label");
  const version = document.getElementById("version");
  const command = document.getElementById("command");
  const system = await detectSystem();

  if (system.os === "windows" || system.os === "mobile") command.hidden = true;
  if (system.os === "mobile") {
    label.textContent = "Get Markas for your computer";
    return;
  }
  if (NAMES[system.os]) {
    const arch =
      system.os === "macos" ? (system.arch === "arm64" ? " (Apple silicon)" : " (Intel)") : "";
    label.textContent = `Download for ${NAMES[system.os]}${arch}`;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const release = await response.json();
    const number = String(release.tag_name || "").replace(/^v/, "");
    if (/^\d+\.\d+\.\d+$/.test(number)) version.textContent = `Version ${number}`;
    const asset = pickAsset(release.assets || [], system);
    if (asset?.browser_download_url?.startsWith(`https://github.com/${REPO}/releases/download/`)) {
      button.href = asset.browser_download_url;
    }
  } catch {
    // The release page stays as the link.
  }
}

function setUpCopy() {
  const copy = document.getElementById("copy");
  const text = document.getElementById("command-text");
  const status = document.getElementById("copy-status");
  if (!navigator.clipboard) {
    copy.hidden = true;
    return;
  }
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text.textContent.trim());
      copy.textContent = "Copied";
      status.textContent = "The install command is copied.";
    } catch {
      copy.textContent = "Select it";
      status.textContent = "Copying is not allowed here. Select the command and copy it.";
    }
    setTimeout(() => {
      copy.textContent = "Copy";
    }, 2000);
  });
}

setUpDownload();
setUpCopy();
