#!/bin/sh
# Installs the markas command for the person running it, on macOS or Linux:
#
#   curl -fsSL https://raw.githubusercontent.com/avelixio/markas/main/install.sh | sh
#
# It downloads the release for this computer from GitHub, checks it against the release's
# SHA-256 list, unpacks it under ~/.markas/app and puts a small `markas` launcher in
# ~/.local/bin. It needs no administrator password and changes nothing outside those folders.
#
# MARKAS_VERSION=0.1.0 picks a release; the newest one is used otherwise.
# MARKAS_BIN_DIR picks where the launcher goes.
set -eu

REPO="avelixio/markas"
APP_ROOT="${HOME}/.markas/app"
BIN_DIR="${MARKAS_BIN_DIR:-${HOME}/.local/bin}"

say() { printf '%s\n' "$*"; }
fail() {
  printf 'markas install: %s\n' "$*" >&2
  exit 1
}
need() { command -v "$1" >/dev/null 2>&1 || fail "it needs \`$1\`, which is not on this computer."; }

need curl
need unzip
need uname

case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux) os=linux ;;
  *) fail "this computer is not macOS or Linux. On Windows, download the installer from https://github.com/${REPO}/releases." ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "there is no Markas build for a $(uname -m) processor." ;;
esac
# A Mac with Apple silicon can run the shell under Rosetta; the native build is the right one.
if [ "$os" = macos ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi
target="${os}-${arch}"
case "$target" in
  macos-arm64 | macos-x64 | linux-x64) ;;
  *) fail "there is no Markas build for ${target} yet." ;;
esac

if [ -n "${MARKAS_VERSION:-}" ]; then
  version="${MARKAS_VERSION#v}"
else
  version="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" |
    sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$version" ] || fail "could not find the newest release. Set MARKAS_VERSION and try again."
fi
case "$version" in
  *[!0-9A-Za-z.-]*) fail "\"${version}\" is not a version." ;;
esac

name="markas-${version}-${target}"
base="https://github.com/${REPO}/releases/download/v${version}"
work="$(mktemp -d "${TMPDIR:-/tmp}/markas-install.XXXXXX")"
trap 'rm -rf "$work"' EXIT INT TERM

say "Downloading Markas ${version} for ${target}..."
curl -fsSL --retry 2 -o "${work}/${name}.zip" "${base}/${name}.zip" ||
  fail "could not download ${base}/${name}.zip."
curl -fsSL --retry 2 -o "${work}/sums.txt" "${base}/SHA256SUMS-${target}.txt" ||
  fail "could not download the release's SHA-256 list."

expected="$(awk -v file="${name}.zip" '$2 == file { print $1 }' "${work}/sums.txt")"
[ -n "$expected" ] || fail "the release's SHA-256 list does not name ${name}.zip."
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${work}/${name}.zip" | awk '{ print $1 }')"
else
  need shasum
  actual="$(shasum -a 256 "${work}/${name}.zip" | awk '{ print $1 }')"
fi
[ "$actual" = "$expected" ] || fail "the download does not match the release's SHA-256 list; it was not installed."

unzip -q "${work}/${name}.zip" -d "$work"
[ -x "${work}/${name}/markas" ] || chmod +x "${work}/${name}/markas" 2>/dev/null || true
[ -f "${work}/${name}/markas" ] || fail "the download does not hold the markas program."

mkdir -p "$APP_ROOT"
rm -rf "${APP_ROOT:?}/${version}"
mv "${work}/${name}" "${APP_ROOT}/${version}"
chmod +x "${APP_ROOT}/${version}/markas"
# `current` points at the version in use, so the launcher never has to change.
ln -sfn "${APP_ROOT}/${version}" "${APP_ROOT}/current.new"
mv -f "${APP_ROOT}/current.new" "${APP_ROOT}/current" 2>/dev/null ||
  { rm -rf "${APP_ROOT}/current" && mv "${APP_ROOT}/current.new" "${APP_ROOT}/current"; }

mkdir -p "$BIN_DIR"
cat >"${BIN_DIR}/markas" <<LAUNCHER
#!/bin/sh
# Starts the Markas installed by install.sh. It finds its web interface beside the real program.
exec "${APP_ROOT}/current/markas" "\$@"
LAUNCHER
chmod +x "${BIN_DIR}/markas"

say "Installed Markas ${version} in ${APP_ROOT}/${version}."
case ":${PATH}:" in
  *":${BIN_DIR}:"*) say "Run \`markas\` to start it. It opens in your browser." ;;
  *)
    say "Add ${BIN_DIR} to your PATH, for example:"
    # The advice names the person's own shell: most Linux computers have no zsh.
    case "${SHELL:-}" in
      */zsh) say "  echo 'export PATH=\"${BIN_DIR}:\$PATH\"' >> ~/.zshrc && exec zsh" ;;
      */fish) say "  fish_add_path ${BIN_DIR}" ;;
      */bash)
        if [ "$os" = macos ]; then rc="~/.bash_profile"; else rc="~/.bashrc"; fi
        say "  echo 'export PATH=\"${BIN_DIR}:\$PATH\"' >> ${rc} && exec bash"
        ;;
      *) say "  echo 'export PATH=\"${BIN_DIR}:\$PATH\"' >> ~/.profile, then log in again" ;;
    esac
    say "Then run \`markas\` to start it. It opens in your browser."
    ;;
esac
