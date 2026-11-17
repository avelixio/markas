// Packaging for the Markas desktop app.
// The app is a thin shell: its only code is dist/desktop/main.cjs. The host and the web
// interface travel beside it as resources, built first by scripts/package.ts.
const { version } = require("./package.json");

const HOST_TARGETS = {
  win32: { x64: "windows-x64" },
  darwin: { arm64: "macos-arm64", x64: "macos-x64" },
  linux: { x64: "linux-x64" },
};

const hostTarget = HOST_TARGETS[process.platform]?.[process.env.MARKAS_ARCH ?? process.arch];
if (!hostTarget) throw new Error(`No Markas host build for ${process.platform} ${process.arch}.`);

module.exports = {
  appId: "id.markas.app",
  productName: "Markas",
  copyright: "Copyright 2026 Markas contributors",
  directories: { output: "dist/desktop-release", buildResources: "build" },
  // Everything the shell needs is bundled into main.cjs, so no node_modules are shipped.
  files: ["dist/desktop/main.cjs", "package.json", "!node_modules/**"],
  extraResources: [
    {
      from: `dist/release/markas-${version}-${hostTarget}`,
      to: "host",
      filter: ["markas*", "ui/**", "bots/**"],
    },
    { from: "build/icon.png", to: "build/icon.png" },
    { from: "LICENSE", to: "LICENSE" },
    { from: "NOTICE", to: "NOTICE" },
    { from: "THIRD-PARTY-NOTICES.md", to: "THIRD-PARTY-NOTICES.md" },
  ],
  asar: true,
  win: { target: ["nsis", "zip"], icon: "build/icon.png" },
  nsis: {
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Markas",
    artifactName: "Markas-Setup-${version}.${ext}",
  },
  mac: {
    target: ["dmg", "zip"],
    icon: "build/icon.png",
    category: "public.app-category.productivity",
    // There is no Apple developer certificate yet. An ad-hoc signature is the least macOS accepts on
    // Apple silicon; without it the app is reported as damaged and will not start.
    identity: "-",
    hardenedRuntime: false,
  },
  linux: { target: ["AppImage"], icon: "build/icon.png", category: "Utility" },
  artifactName: "Markas-${version}-${os}-${arch}.${ext}",
  publish: null,
};
