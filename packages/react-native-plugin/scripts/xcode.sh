#!/bin/bash
set -e

# The parent CLI seals only after xcodebuild (including signing) succeeds.
: "${OTAKIT_BUILD_REQUEST:?Run this phase through otakit rn build-ios}"
: "${OTAKIT_NODE_BINARY:?Missing OtaKit Node executable}"
: "${OTAKIT_CLI:?Missing OtaKit CLI}"
# Load the same project environment as RN's ordinary phase. The CLI checks relevant
# overrides against preflight; it still uses the wrapper's exact Node executable.
source "${REACT_NATIVE_PATH:?Missing React Native installation}/scripts/xcode/with-environment.sh" ""
set -u
exec "$OTAKIT_NODE_BINARY" "$OTAKIT_CLI" rn stage-ios-build --request "$OTAKIT_BUILD_REQUEST"
