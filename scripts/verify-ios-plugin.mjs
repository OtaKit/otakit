import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageDirectory = fileURLToPath(new URL('../packages/capacitor-plugin/', import.meta.url));
const resultsDirectory = fileURLToPath(
  new URL('../packages/capacitor-plugin/.build/verification-results/', import.meta.url),
);
mkdirSync(resultsDirectory, { recursive: true });
const resultBundlePath = `${resultsDirectory}tests-${Date.now()}-${process.pid}.xcresult`;

const devices = JSON.parse(
  execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json']),
);
const simulator = Object.entries(devices.devices)
  .filter(([runtime]) => runtime.includes('.iOS-'))
  .flatMap(([, values]) => values)
  .find((device) => device.isAvailable && device.name.startsWith('iPhone'));
if (!simulator) throw new Error('Install an iOS simulator runtime before running native tests');

const result = spawnSync(
  'xcodebuild',
  [
    'test',
    '-scheme',
    'OtakitCapacitorUpdater',
    '-destination',
    `platform=iOS Simulator,id=${simulator.udid}`,
    '-derivedDataPath',
    '.build/verification',
    '-resultBundlePath',
    resultBundlePath,
    '-parallel-testing-enabled',
    'NO',
    '-quiet',
    'CODE_SIGNING_ALLOWED=NO',
  ],
  {
    cwd: packageDirectory,
    stdio: 'inherit',
  },
);
if (existsSync(resultBundlePath)) {
  console.log(`Native test results: ${resultBundlePath}`);
  const summary = spawnSync(
    'xcrun',
    ['xcresulttool', 'get', 'test-results', 'summary', '--path', resultBundlePath],
    { stdio: 'inherit' },
  );
  if (summary.error || summary.status !== 0) {
    console.warn('Could not summarize the result bundle; inspect the .xcresult for details.');
  }
}
if (result.error) throw result.error;
process.exit(result.status ?? 1);
