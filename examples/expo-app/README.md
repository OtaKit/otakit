# Expo compatibility fixture

This private fixture exercises Expo export and preserves a Router/splash/DOM scaffold for native acceptance. Expo prebuild has run, but OtaKit native host integration and device scenarios have not been validated. It is not a working OTA integration example yet.

The fixture includes Router, splash, Constants and a DOM component for that later acceptance. Bare React Native testing lives in `../react-native-app` and does not require native Expo dependencies.

The CLI now has an adapter for Expo 57.0.17 / CLI 57.0.19's embed exporter. `export-entry.tsx` is the independent Expo/Constants/DOM export fixture. Its Android export contains real Hermes bytecode, an authenticated config snapshot and the complete DOM output; native and DOM source maps stay private. The adapter validates native asset destinations before copying and supplements native source evidence skipped by upstream CNG/pnpm fingerprint rules.

Run `pnpm --filter @otakit/cli build`, then `RUN_EXPO_EXPORT_TESTS=1 pnpm --filter @otakit/cli test -- src/lib/react-native/expo-export.integration.test.ts`. This exercises the built CLI, verifies the complete archive and checks rejection of the Router collision. It does not build or run an Expo native app.

Router export is currently blocked by an upstream asset collision. Published Router 57.0.17 and 57.0.21 contain both `clear-icon.png` (64×64) and `clear-icon@1x.png` (16×16), with different bytes but the same Android destination. `close-icon` has the same ambiguity. The shared mapping verifier rejects the export before writing its payload. Resolving this dependency issue is required before Router/splash/device acceptance can finish.
