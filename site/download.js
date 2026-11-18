// /download/<target>: the page view is counted as one click on the download button, then the
// browser goes on to that file in the newest GitHub release. An unknown target, or GitHub out of
// reach, leaves the person on this page with a link to the release.
const REPO = "avelixio/markas";
const FILES = {
  windows: /^Markas-Setup-.*\.exe$/,
  "macos-arm64": /^Markas-.*-mac-arm64\.dmg$/,
  "macos-x64": /^Markas-.*-mac-x64\.dmg$/,
  linux: /\.AppImage$/,
};

/** Waits for the analytics script, which sends the page view as it loads, but never long. */
function analyticsSent() {
  return new Promise((done) => {
    const script = document.querySelector('script[src="/_vercel/insights/script.js"]');
    const finish = () => setTimeout(done, 250);
    if (!script) return finish();
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", done, { once: true });
    setTimeout(done, 1500);
  });
}

async function go() {
  const target = location.pathname.replace(/^\/download\/?/, "").replace(/\/$/, "");
  const pattern = FILES[target];
  if (!pattern) {
    document.getElementById("title").textContent = "Pick your download";
    return;
  }
  try {
    const [response] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { accept: "application/vnd.github+json" },
      }),
      analyticsSent(),
    ]);
    if (!response.ok) return;
    const release = await response.json();
    const asset = (release.assets || []).find((file) => pattern.test(file.name));
    const url = asset?.browser_download_url;
    if (url?.startsWith(`https://github.com/${REPO}/releases/download/`)) location.replace(url);
  } catch {
    // The link to the release stays on the page.
  }
}

go();
