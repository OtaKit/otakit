import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
    '-parallel-testing-enabled',
    'NO',
    '-quiet',
    'CODE_SIGNING_ALLOWED=NO',
  ],
  {
    cwd: fileURLToPath(new URL('../packages/capacitor-plugin/', import.meta.url)),
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
