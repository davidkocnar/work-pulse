#!/bin/bash
set -euo pipefail

# ---- config ----------------------------------------------------------------
REPO_URL="https://github.com/davidkocnar/work-pulse.git"
INSTALL_DIR="$HOME/.workpulse"
APP_BUNDLE="/Applications/WorkPulse.app"
MIN_NODE=18
# ---------------------------------------------------------------------------

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "${RED}✗${NC}  $*" >&2; exit 1; }
step() { echo -e "\n${BOLD}$*${NC}"; }

echo -e "${BOLD}"
echo "  ⚡ WorkPulse Installer"
echo "  ─────────────────────${NC}"
echo

# ---- macOS check -----------------------------------------------------------
[[ "$(uname)" == "Darwin" ]] || die "This installer is for macOS only."

# ---- Xcode CLI tools (provides git) ----------------------------------------
step "1/5  Checking developer tools…"
if ! xcode-select -p &>/dev/null; then
  warn "Xcode Command Line Tools not found — installing…"
  xcode-select --install
  echo "   Re-run this script after the installation completes."
  exit 0
fi
ok "Developer tools present."

# ---- Node.js ---------------------------------------------------------------
step "2/5  Checking Node.js…"
need_node=false
if command -v node &>/dev/null; then
  node_ver=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
  if (( node_ver >= MIN_NODE )); then
    ok "Node.js $node_ver found."
  else
    warn "Node.js $node_ver is too old (need $MIN_NODE+)."
    need_node=true
  fi
else
  warn "Node.js not found."
  need_node=true
fi

if $need_node; then
  if ! command -v brew &>/dev/null; then
    echo "   Installing Homebrew first…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH for the rest of this script
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
  fi
  echo "   Installing Node.js via Homebrew…"
  brew install node
  ok "Node.js installed."
fi

# ---- Clone / update repo ---------------------------------------------------
step "3/5  Installing WorkPulse…"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "   Existing installation found — updating…"
  git -C "$INSTALL_DIR" pull --ff-only
  ok "Updated to latest version."
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Repository cloned."
fi

echo "   Installing dependencies…"
npm --prefix "$INSTALL_DIR" install --omit=dev --silent
ok "Dependencies ready."

# ---- macOS .app bundle -----------------------------------------------------
step "4/5  Creating WorkPulse.app in /Applications…"

MACOS_DIR="$APP_BUNDLE/Contents/MacOS"
RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

# Copy icon if available
ICON_SRC="$INSTALL_DIR/build/icon.icns"
[[ -f "$ICON_SRC" ]] && cp "$ICON_SRC" "$RESOURCES_DIR/icon.icns"

# Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>         <string>WorkPulse</string>
  <key>CFBundleIdentifier</key>   <string>app.futured.workpulse</string>
  <key>CFBundleVersion</key>      <string>1.0</string>
  <key>CFBundleExecutable</key>   <string>WorkPulse</string>
  <key>CFBundleIconFile</key>     <string>icon</string>
  <key>LSUIElement</key>          <false/>
</dict>
</plist>
PLIST

# Launcher script
cat > "$MACOS_DIR/WorkPulse" << LAUNCHER
#!/bin/bash
# Bring terminal output to /dev/null so no Terminal window appears
INSTALL_DIR="\$HOME/.workpulse"

# Resolve node from common locations
for p in /opt/homebrew/bin /usr/local/bin /usr/bin; do
  [[ -x "\$p/node" ]] && export PATH="\$p:\$PATH" && break
done

# Open browser after a short delay so the server has time to start
(sleep 2 && open "http://localhost:3333") &

cd "\$INSTALL_DIR"
exec node server/index.js
LAUNCHER
chmod +x "$MACOS_DIR/WorkPulse"

ok "WorkPulse.app created in /Applications."

# ---- Done ------------------------------------------------------------------
step "5/5  All done!"
echo
echo "   • Open WorkPulse from /Applications like any other app."
echo "   • On first launch, right-click → Open if macOS warns about an unknown developer."
echo "   • Set up your integrations via the onboarding wizard (the ? button)."
echo
echo -e "   ${BOLD}To update later:${NC} just run this script again."
echo

read -rp "   Launch WorkPulse now? [y/N] " launch
if [[ "$launch" =~ ^[Yy]$ ]]; then
  open "$APP_BUNDLE"
fi
