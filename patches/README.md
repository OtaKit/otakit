# Expo Router fixture patch

`expo-router@57.0.17.patch` removes the unscaled `clear-icon.png` and `close-icon.png` from Router's vendored navigation assets. Each was byte-for-byte identical to its `@4x` file, while colliding with a different `@1x` file at Metro's scale 1. The patch retains all four explicit density variants for both icons. It affects the pinned Expo fixture dependency only.

The exporter still rejects ambiguous destinations. The Expo export integration tests verify complete Router archives and the expected icon dimensions at each platform's supported scales. Reassess and remove this patch when changing the Router version; do not apply it to another version without inspecting its assets.
