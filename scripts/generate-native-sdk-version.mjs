import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../packages/capacitor-plugin/', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version)) {
  throw new Error('Invalid native SDK package version');
}
const outputs = [
  [
    'android/src/main/java/com/otakit/updater/SDKVersion.java',
    `package com.otakit.updater;\n\n// Generated from package.json by scripts/generate-native-sdk-version.mjs.\nfinal class SDKVersion {\n\n  static final String VALUE = "${version}";\n\n  private SDKVersion() {}\n}\n`,
  ],
  [
    'ios/Sources/UpdaterPlugin/SDKVersion.swift',
    `// Generated from package.json by scripts/generate-native-sdk-version.mjs.\nenum SDKVersion {\n  static let value = "${version}"\n}\n`,
  ],
];
for (const [path, content] of outputs) {
  const url = new URL(path, root);
  if (process.argv.includes('--write')) {
    writeFileSync(url, content);
  } else if (readFileSync(url, 'utf8') !== content) {
    throw new Error(
      `Stale native SDK version in ${fileURLToPath(url)}. Run node scripts/generate-native-sdk-version.mjs --write.`,
    );
  }
}
