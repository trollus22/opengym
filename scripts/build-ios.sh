#!/usr/bin/env bash
set -euo pipefail

# Script to build openGym iOS .ipa for SideStore / AltStore on macOS
# Usage: ./scripts/build-ios.sh [SERVER_URL]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_URL="${1:-https://harris-excess-respect-shops.trycloudflare.com}"

echo "==> Target Server URL: ${SERVER_URL}"
echo "==> Working directory: ${ROOT_DIR}"

# 1. Update capacitor.config.json if SERVER_URL is provided
if [ -n "${SERVER_URL}" ]; then
  echo "==> Configuring capacitor.config.json with server URL..."
  node -e "
    const fs = require('fs');
    const path = '${ROOT_DIR}/frontend/capacitor.config.json';
    const config = JSON.parse(fs.readFileSync(path, 'utf8'));
    config.server = {
      url: '${SERVER_URL}',
      cleartext: true,
      allowNavigation: ['*']
    };
    fs.writeFileSync(path, JSON.stringify(config, null, 2));
  "
fi

# 2. Build web frontend
echo "==> Building web frontend..."
cd "${ROOT_DIR}/frontend"
npm install
npm run build

# 3. Sync with Capacitor iOS
echo "==> Syncing Capacitor iOS..."
npx cap sync ios

# 4. CocoaPods
echo "==> Installing CocoaPods..."
cd "${ROOT_DIR}/frontend/ios/App"
pod install

# 5. Build Xcode Archive
echo "==> Archiving iOS App..."
rm -rf build
xcodebuild archive \
  -workspace App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/App.xcarchive \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=""

# 6. Package into .ipa
echo "==> Packaging .ipa..."
mkdir -p build/Payload
cp -R build/App.xcarchive/Products/Applications/App.app build/Payload/
codesign --force --deep --sign - build/Payload/App.app
cd build
zip -r -q openGym.ipa Payload

echo "==> SUCCESS! IPA created at: ${ROOT_DIR}/frontend/ios/App/build/openGym.ipa"
