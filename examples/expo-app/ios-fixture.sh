#!/bin/sh
# Private simulator resources, or the public CLI's completed-build staging phase.
set -eu
if [ "$CONFIGURATION" != "Release" ]; then exit 0; fi
if [ -n "${OTAKIT_BUILD_REQUEST:-}" ]; then
  : "${OTAKIT_NODE_BINARY:?Missing build request Node binary}"
  hook=$("$OTAKIT_NODE_BINARY" -p 'require.resolve("@otakit/react-native-updater/scripts/xcode.sh", {paths: [process.argv[1]]})' "$PROJECT_DIR/..")
  exec /bin/bash "$hook"
fi
: "${OTAKIT_FIXTURE_ASSETS:?Prepare the local Expo fixture first}"
: "${TARGET_BUILD_DIR:?Missing Xcode target directory}"
: "${UNLOCALIZED_RESOURCES_FOLDER_PATH:?Missing Xcode resources directory}"
test -f "$OTAKIT_FIXTURE_ASSETS/OtaKitFixture/configuration.json"
test -d "$OTAKIT_FIXTURE_ASSETS/www.bundle"
for name in OtaKitFixture www.bundle; do
  rsync -a --delete "$OTAKIT_FIXTURE_ASSETS/$name/" \
    "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/$name/"
done
