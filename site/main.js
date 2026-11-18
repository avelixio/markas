// Points the download button at this system's download page, which counts the click and then
// starts the file from the newest GitHub release; shows the newest version; copies the install
// command. Without JavaScript the button opens the release page, which lists every file.
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

/** The website's download page for this system, which counts the click and starts the file. */
function downloadPage(system) {
  if (system.os === "windows") return "/download/windows";
  if (system.os === "macos") return `/download/macos-${system.arch}`;
  if (system.os === "linux") return "/download/linux";
  return null;
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
    button.href = downloadPage(system);
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const release = await response.json();
    const number = String(release.tag_name || "").replace(/^v/, "");
    if (/^\d+\.\d+\.\d+$/.test(number)) version.textContent = `Version ${number}`;
  } catch {
    // The version written in the page stays.
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
