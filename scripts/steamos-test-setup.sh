#!/usr/bin/env bash
# User-local SteamOS test workspace. Downloads files; does not modify or launch the game.
set -Eeuo pipefail
umask 077

APP_VERSION=1.0.0
SOURCE_COMMIT=42f0a508108a981d19146ce61e3b86d08e68ca32
APP_FILE="UnX-Manager-${APP_VERSION}-linux-x86_64.AppImage"
APP_SHA=075346f9abaa49001de4431c21efed26fdd38274c67b4095da1c7d96a437ba4e
MANIFEST_SHA=210978874b7bf1f9efa3b2bf93c5bc8bc83777ded41d3ab15df622cd9db2e4fc
SOURCE_SHA=16730e57ef1ebac6c2c501e2a459a3b579de6b8ef8fcedc7a05f04e5aa04633f
NODE_VERSION=24.22.1
NODE_SHA=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
GH_VERSION=2.103.1
GH_SHA=57500f347b5e84efb6578c9b644eeb3b4e54046762635a939dd0ee2cca1c1add
RELEASE_URL="https://github.com/adrigm/UnX/releases/download/v${APP_VERSION}"
want_node=false; want_gh=false
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
Usage: bash steamos-test-setup.sh [--dev-tools] [--github-cli] [--help]
Default: verify/download the released AppImage, payload manifest and pinned source.
--dev-tools   Also install verified official Node.js 24 LTS in this workspace.
--github-cli  Also install verified official GitHub CLI in this workspace.
Set UNX_TEST_ROOT to a dedicated directory (default: $HOME/UnX-SteamOS).
No sudo, pacman, authentication, game writes, mod installation or game launch.
Existing source edits and test results are preserved. Git and gh are not required.
HELP
}
for arg in "$@"; do
  case "$arg" in
    --dev-tools) want_node=true ;;
    --github-cli) want_gh=true ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown argument: $arg. Use --help." ;;
  esac
done
[[ "$(uname -s)" == Linux ]] || die 'Run this script on SteamOS/Linux, not Windows.'
[[ "$(uname -m)" == x86_64 ]] || die 'This release requires an x86_64 machine.'
[[ "$EUID" -ne 0 ]] || die 'Run as your normal desktop user, without sudo.'
for command_name in tar sha256sum awk grep sed mktemp date; do
  command -v "$command_name" >/dev/null || die "Required tool missing: $command_name. Do not change SteamOS system packages; consult the test guide."
done
if command -v curl >/dev/null; then downloader=curl
elif command -v wget >/dev/null; then downloader=wget
else
  die "Neither curl nor wget is available. Use the desktop browser to download assets from https://github.com/adrigm/UnX/releases/tag/v${APP_VERSION}; consult the guide before proceeding."
fi

root_input="${UNX_TEST_ROOT:-$HOME/UnX-SteamOS}"
[[ "$root_input" == /* && "$root_input" != *$'\n'* ]] || die 'UNX_TEST_ROOT must be an absolute path without newlines.'
mkdir -p -- "$root_input"
root="$(cd -- "$root_input" && pwd -P)"
[[ "$root" != / && "$root" != "$HOME" ]] || die 'Use a dedicated test directory, not / or your home directory itself.'
[[ ! -e "$root/FFX.exe" && ! -e "$root/FFX&X-2_LAUNCHER.exe" ]] || die 'The test workspace must not be the game directory.'
for directory in downloads tools logs results source; do
  [[ ! -L "$root/$directory" ]] || die "Refusing workspace directory symbolic link: $root/$directory"
done
mkdir -p -- "$root/downloads" "$root/tools" "$root/logs" "$root/results"
[[ ! -L "$root/.source-commit" ]] || die 'Refusing source marker symbolic link.'
work="$(mktemp -d "$root/.setup.XXXXXXXX")"
cleanup() {
  # This path is generated above, resolved inside the chosen workspace, never a game path.
  [[ -n "${work:-}" && "$work" == "$root"/.setup.* && -d "$work" && ! -L "$work" ]] && rm -rf -- "$work"
  return 0
}
trap cleanup EXIT
trap 'printf "Setup stopped at line %s. Existing files were preserved.\n" "$LINENO" >&2' ERR
log="$root/logs/setup-$(date -u +%Y%m%dT%H%M%SZ)-$$.txt"
[[ ! -e "$log" && ! -L "$log" ]] || die 'Log name already exists; retry setup.'

verify() {
  local actual
  actual="$(sha256sum -- "$1")"; actual="${actual%% *}"
  [[ "$actual" == "$2" ]] || die "SHA256 mismatch for $1. File preserved; do not execute it."
}
download_verified() {
  local url="$1" target="$2" expected="$3"
  [[ ! -L "$target" ]] || die "Refusing symbolic link: $target"
  if [[ -e "$target" ]]; then
    [[ -f "$target" ]] || die "Expected a regular file: $target"
    verify "$target" "$expected"
    printf 'Verified existing: %s\n' "$target"
    return
  fi
  printf 'Downloading: %s\n' "$url"
  if [[ "$downloader" == curl ]]; then
    curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --output "$work/download" "$url"
  else
    wget --https-only --tries=3 --timeout=30 --output-document="$work/download" "$url"
  fi
  verify "$work/download" "$expected"
  mv -- "$work/download" "$target"
}
validate_archive() {
  local archive="$1" top="$2" allow_links="${3:-false}"
  tar -tf "$archive" > "$work/archive-paths"
  awk -v top="$top" '
    BEGIN { count=0 }
    { count++; if ($0 != top && index($0,top "/")!=1) exit 1;
      n=split($0, parts, "/"); for(i=1;i<=n;i++) if(parts[i]=="..") exit 1 }
    END { if(count==0) exit 1 }
  ' "$work/archive-paths" || die "Unsafe archive paths in $archive"
  if [[ "$allow_links" != true ]]; then
    tar -tvf "$archive" > "$work/archive-types"
    awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {exit 1}' "$work/archive-types" || die "Unsupported archive links in $archive"
  fi
}

app_path="$root/downloads/$APP_FILE"
manifest_path="$root/downloads/payload-manifest.json"
source_archive="$root/downloads/UnX-${SOURCE_COMMIT}.tar.gz"
download_verified "$RELEASE_URL/$APP_FILE" "$app_path" "$APP_SHA"
download_verified "$RELEASE_URL/payload-manifest.json" "$manifest_path" "$MANIFEST_SHA"
grep -Eq '"sourceCommit"[[:space:]]*:[[:space:]]*"'"$SOURCE_COMMIT"'"' "$manifest_path" || die 'Payload source commit does not match the pinned release.'
download_verified "https://codeload.github.com/adrigm/UnX/tar.gz/$SOURCE_COMMIT" "$source_archive" "$SOURCE_SHA"
source_path="$root/source"
if [[ -e "$source_path" || -L "$source_path" ]]; then
  [[ -d "$source_path" && ! -L "$source_path" && -f "$root/.source-commit" && ! -L "$root/.source-commit" ]] || die 'Existing source directory is unrecognized; choose a new UNX_TEST_ROOT.'
  [[ "$(cat "$root/.source-commit")" == "$SOURCE_COMMIT" ]] || die 'Existing source uses another commit; choose a new UNX_TEST_ROOT.'
  printf 'Preserving existing source and edits: %s\n' "$source_path"
else
  validate_archive "$source_archive" "UnX-$SOURCE_COMMIT"
  tar -xf "$source_archive" -C "$work" --no-same-owner --no-same-permissions
  mv -- "$work/UnX-$SOURCE_COMMIT" "$source_path"
  printf '%s\n' "$SOURCE_COMMIT" > "$root/.source-commit"
fi
chmod u+x -- "$app_path"

node_dir="$root/tools/node-v${NODE_VERSION}-linux-x64"
gh_dir="$root/tools/gh_${GH_VERSION}_linux_amd64"
[[ ! -L "$node_dir" && ! -L "$gh_dir" ]] || die 'Refusing symbolic link in tool installation paths.'
if "$want_node"; then
  node_archive="$root/downloads/node-v${NODE_VERSION}-linux-x64.tar.xz"
  download_verified "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" "$node_archive" "$NODE_SHA"
  if [[ ! -e "$node_dir" ]]; then
    # Official, pinned Node archives include npm/npx symlinks within their tree.
    validate_archive "$node_archive" "node-v${NODE_VERSION}-linux-x64" true
    tar -xf "$node_archive" -C "$work" --no-same-owner --no-same-permissions
    mv -- "$work/node-v${NODE_VERSION}-linux-x64" "$node_dir"
  fi
  [[ ! -L "$node_dir" && -x "$node_dir/bin/node" ]] || die 'Invalid existing Node directory; inspect it before retrying.'
  [[ "$("$node_dir/bin/node" --version)" == "v$NODE_VERSION" ]] || die 'Unexpected Node version.'
fi
if "$want_gh"; then
  gh_archive="$root/downloads/gh_${GH_VERSION}_linux_amd64.tar.gz"
  download_verified "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" "$gh_archive" "$GH_SHA"
  if [[ ! -e "$gh_dir" ]]; then
    validate_archive "$gh_archive" "gh_${GH_VERSION}_linux_amd64"
    tar -xf "$gh_archive" -C "$work" --no-same-owner --no-same-permissions
    mv -- "$work/gh_${GH_VERSION}_linux_amd64" "$gh_dir"
  fi
  [[ ! -L "$gh_dir" && -x "$gh_dir/bin/gh" ]] || die 'Invalid existing GitHub CLI directory; inspect it before retrying.'
  "$gh_dir/bin/gh" --version
fi

env_file="$root/unx-test-env.sh"
[[ ! -L "$env_file" && ! -L "$log" ]] || die 'Refusing environment or log symbolic link.'
env_header='# UnX SteamOS test environment (generated by steamos-test-setup.sh).'
if [[ -e "$env_file" ]]; then
  IFS= read -r previous_header < "$env_file" || true
  [[ "${previous_header:-}" == "$env_header" ]] || die 'Existing environment file is unrecognized; choose a new UNX_TEST_ROOT.'
fi
{
  printf '%s\n' "$env_header"
  printf '# Source this file in Bash; no system profile is modified.\n'
  printf 'export UNX_TEST_ROOT=%q\n' "$root"
  printf 'export UNX_TEST_APPIMAGE=%q\n' "$app_path"
  printf 'export UNX_TEST_SOURCE=%q\n' "$source_path"
  printf 'export UNX_TEST_MANIFEST=%q\n' "$manifest_path"
  printf 'export UNX_TEST_COMMIT=%q\n' "$SOURCE_COMMIT"
  printf 'export UNX_TEST_RESULTS=%q\n' "$root/results"
  printf 'export UNX_TEST_NODE_DIR=%q\n' "$node_dir"
  printf 'export UNX_TEST_GH_DIR=%q\n' "$gh_dir"
  printf 'export PATH=%q:%q:"$PATH"\n' "$node_dir/bin" "$gh_dir/bin"
} > "$env_file"
{
  printf 'UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Kernel: %s\n' "$(uname -srm)"
  [[ ! -f /etc/os-release ]] || grep -E '^(ID|ID_LIKE|VERSION_ID|PRETTY_NAME)=' /etc/os-release
  printf 'Session type: %s\nDesktop: %s\n' "${XDG_SESSION_TYPE:-unknown}" "${XDG_CURRENT_DESKTOP:-unknown}"
  printf 'Display present: %s\nWayland display present: %s\n' "$([[ -n "${DISPLAY:-}" ]] && echo yes || echo no)" "$([[ -n "${WAYLAND_DISPLAY:-}" ]] && echo yes || echo no)"
  printf 'Workspace: %s\nSource snapshot: %s\nSource commit: %s\n' "$root" "$source_path" "$SOURCE_COMMIT"
  printf 'AppImage: %s\nManifest: %s\n' "$app_path" "$manifest_path"
  sha256sum -- "$app_path" "$manifest_path" "$source_archive"
  printf 'Bash: %s\n' "$BASH_VERSION"
  for tool_name in curl wget tar sha256sum node npm gh steam flatpak; do
    printf '%s path: %s\n' "$tool_name" "$(command -v "$tool_name" || true)"
  done
  "$downloader" --version | sed -n '1p'
  tar --version | sed -n '1p'
  if [[ -x "$node_dir/bin/node" ]]; then "$node_dir/bin/node" --version; fi
  if [[ -x "$gh_dir/bin/gh" ]]; then "$gh_dir/bin/gh" --version; fi
  printf 'No game files, Steam launch options, Proton prefixes or credentials were modified.\n'
} > "$log"
printf '\nWorkspace ready. No mod was installed and no game was launched.\n'
printf 'Environment: source %q\nLog: %s\n' "$env_file" "$log"
printf 'Read the SteamOS test guide before starting the AppImage or changing the game.\n'
