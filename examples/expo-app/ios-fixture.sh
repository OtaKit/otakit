#!/bin/sh
# Private simulator resources. This does not issue a completed native-build receipt.
set -eu
if [ "$CONFIGURATION" != "Release" ]; then exit 0; fi
: "${OTAKIT_FIXTURE_ASSETS:?Prepare the local Expo fixture first}"
: "${TARGET_BUILD_DIR:?Missing Xcode target directory}"
: "${UNLOCALIZED_RESOURCES_FOLDER_PATH:?Missing Xcode resources directory}"
test -f "$OTAKIT_FIXTURE_ASSETS/OtaKitFixture/configuration.json"
test -d "$OTAKIT_FIXTURE_ASSETS/www.bundle"
for name in OtaKitFixture www.bundle; do
  rsync -a --delete "$OTAKIT_FIXTURE_ASSETS/$name/" \
    "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/$name/"
done
