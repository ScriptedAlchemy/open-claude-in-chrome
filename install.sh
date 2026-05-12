#!/bin/bash
set -e

# Install script for Open Claude in Chrome extension.
# Registers the native messaging host for Chrome, Edge, and Brave.
#
# Usage: ./install.sh [extension-id] [extension-id-2] [extension-id-3] ...
#
# If no extension IDs are provided, the script auto-detects unpacked
# Open Claude in Chrome installations from local Chromium profile data.

print_usage() {
  echo "Usage (repo root): pnpm run chrome:install:host -- [extension-id] [extension-id-2] ..."
  echo "Manual alternative: cd packages/open-claude-in-chrome && ./install.sh [extension-id] [extension-id-2] ..."
  echo ""
  echo "If no IDs are passed, the script auto-detects unpacked installs"
  echo "from Chrome-family browser profiles."
  echo ""
  echo "Steps:"
  echo "  1. From the repo root, run: pnpm install"
  echo "  2. Open chrome://extensions (and/or brave://extensions)"
  echo "  3. Enable Developer Mode"
  echo "  4. Click 'Load unpacked' and select the packages/open-claude-in-chrome/extension/ directory"
  echo "  5. From the repo root, run: pnpm run chrome:install:host"
  echo "  6. If auto-detection misses your browser, rerun with explicit IDs"
  echo "     pnpm run chrome:install:host -- <chrome-id> <brave-id>"
}

if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  print_usage
  exit 1
fi

EXTENSION_IDS=("$@")
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_DIR="$SCRIPT_DIR/host"
EXTENSION_DIR="$SCRIPT_DIR/extension"
NATIVE_HOST_PATH="$HOST_DIR/native-host-wrapper.sh"
HOST_NAME="com.openclaude.chrome"

# Verify node is available
if ! command -v node &> /dev/null; then
  echo "Error: node is not installed. Install Node.js first."
  exit 1
fi

# Workspace install owns dependency setup. Fail loudly if the workspace has not
# been installed yet.
if ! node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(() => process.exit(0)).catch(() => process.exit(1))" >/dev/null 2>&1; then
  echo "Error: workspace dependencies are missing. Run 'pnpm install' from the repo root first."
  exit 1
fi

detect_extension_ids() {
  node - "$EXTENSION_DIR" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');

const extensionDir = path.resolve(process.argv[2]);
const home = os.homedir();

const browserDataPaths =
  process.platform === 'darwin'
    ? [
        path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
        path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
        path.join(home, 'Library', 'Application Support', 'Arc', 'User Data'),
        path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
        path.join(home, 'Library', 'Application Support', 'Chromium'),
        path.join(home, 'Library', 'Application Support', 'Vivaldi'),
        path.join(home, 'Library', 'Application Support', 'com.operasoftware.Opera'),
      ]
    : [
        path.join(home, '.config', 'google-chrome'),
        path.join(home, '.config', 'BraveSoftware', 'Brave-Browser'),
        path.join(home, '.config', 'microsoft-edge'),
        path.join(home, '.config', 'chromium'),
        path.join(home, '.config', 'vivaldi'),
        path.join(home, '.config', 'opera'),
      ];

const preferenceFiles = ['Secure Preferences', 'Preferences'];
const ids = new Set();

function isOpenClaudeInChromeExtension(entryPath) {
  try {
    const manifestPath = path.join(path.resolve(entryPath), 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return manifest && manifest.name === 'Open Claude in Chrome';
  } catch {
    return false;
  }
}

for (const browserPath of browserDataPaths) {
  let profileEntries = [];
  try {
    profileEntries = fs.readdirSync(browserPath, { withFileTypes: true });
  } catch {
    continue;
  }

  const profiles = profileEntries
    .filter(entry => entry.isDirectory() && (entry.name === 'Default' || entry.name.startsWith('Profile ')))
    .map(entry => entry.name);

  for (const profile of profiles) {
    const profilePath = path.join(browserPath, profile);

    for (const fileName of preferenceFiles) {
      const preferencesPath = path.join(profilePath, fileName);
      let settings;
      try {
        const parsed = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
        settings = parsed && parsed.extensions && parsed.extensions.settings;
      } catch {
        continue;
      }

      if (!settings || typeof settings !== 'object') {
        continue;
      }

      for (const [extensionId, value] of Object.entries(settings)) {
        if (!value || typeof value !== 'object') {
          continue;
        }
        if (value.location !== 4 || typeof value.path !== 'string') {
          continue;
        }

        const installedPath = path.resolve(value.path);
        if (installedPath !== extensionDir) {
          continue;
        }
        if (!isOpenClaudeInChromeExtension(installedPath)) {
          continue;
        }

        ids.add(extensionId);
      }
    }
  }
}

for (const id of ids) {
  process.stdout.write(`${id}\n`);
}
NODE
}

if [ ${#EXTENSION_IDS[@]} -eq 0 ]; then
  while IFS= read -r detected_id; do
    if [ -n "$detected_id" ]; then
      EXTENSION_IDS+=("$detected_id")
    fi
  done < <(detect_extension_ids)
fi

if [ ${#EXTENSION_IDS[@]} -eq 0 ]; then
  echo "Error: could not auto-detect any installed Open Claude in Chrome extension IDs."
  echo ""
  print_usage
  exit 1
fi

# Create the native host wrapper script
# Chrome launches this via native messaging — it needs to find node and the script.
cat > "$NATIVE_HOST_PATH" << WRAPPER
#!/bin/sh
exec "$(which node)" "$HOST_DIR/native-host.js"
WRAPPER
chmod +x "$NATIVE_HOST_PATH"

echo "Created native host wrapper: $NATIVE_HOST_PATH"
echo "Using extension ID(s): ${EXTENSION_IDS[*]}"

# Build allowed_origins array from all extension IDs
ORIGINS=""
for i in "${!EXTENSION_IDS[@]}"; do
  if [ $i -gt 0 ]; then ORIGINS="$ORIGINS,"; fi
  ORIGINS="$ORIGINS
    \"chrome-extension://${EXTENSION_IDS[$i]}/\""
done

# Native messaging host manifest
generate_manifest() {
  cat << EOF
{
  "name": "$HOST_NAME",
  "description": "Open Claude in Chrome Native Messaging Host",
  "path": "$NATIVE_HOST_PATH",
  "type": "stdio",
  "allowed_origins": [$ORIGINS
  ]
}
EOF
}

# Platform-specific installation
install_host() {
  local browser_name="$1"
  local host_dir="$2"

  if [ ! -d "$(dirname "$host_dir")" ]; then
    echo "  Skipping $browser_name (not installed)"
    return
  fi

  mkdir -p "$host_dir"
  generate_manifest > "$host_dir/$HOST_NAME.json"
  echo "  Installed for $browser_name: $host_dir/$HOST_NAME.json"
}

echo ""
echo "Installing native messaging host for extension(s): ${EXTENSION_IDS[*]}"
echo ""

case "$(uname)" in
  Darwin)
    install_host "Google Chrome" \
      "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    install_host "Arc" \
      "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts"
    install_host "Chromium" \
      "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    install_host "Microsoft Edge" \
      "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    install_host "Brave Browser" \
      "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    install_host "Vivaldi" \
      "$HOME/Library/Application Support/Vivaldi/NativeMessagingHosts"
    install_host "Opera" \
      "$HOME/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts"
    ;;
  Linux)
    install_host "Google Chrome" \
      "$HOME/.config/google-chrome/NativeMessagingHosts"
    install_host "Chromium" \
      "$HOME/.config/chromium/NativeMessagingHosts"
    install_host "Microsoft Edge" \
      "$HOME/.config/microsoft-edge/NativeMessagingHosts"
    install_host "Brave Browser" \
      "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    install_host "Vivaldi" \
      "$HOME/.config/vivaldi/NativeMessagingHosts"
    install_host "Opera" \
      "$HOME/.config/opera/NativeMessagingHosts"
    ;;
  *)
    echo "Error: Unsupported platform $(uname). This script supports macOS and Linux."
    echo "For Windows, manually create the registry entries and host manifest."
    exit 1
    ;;
esac

echo ""
echo "Done! Next steps:"
echo ""
echo "  1. Restart your browser (close all windows and reopen)"
echo "  2. Ensure OpenClaude has Chrome integration enabled from Settings or /chrome"
echo "  3. Optional global OpenCode user setup: pnpm run chrome:install:opencode"
echo "  4. Start or restart OpenClaude or OpenCode and test:"
echo ""
echo '     Ask Claude: "Navigate to reddit.com and take a screenshot"'
echo ""
