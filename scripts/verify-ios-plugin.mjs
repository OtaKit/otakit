import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = fileURLToPath(new URL('../packages/capacitor-plugin/', import.meta.url));
const projectDirectory = resolve(packageDirectory, 'ios/TestsHost');
const projectPath = resolve(projectDirectory, 'UpdaterTests.xcodeproj');
const project = JSON.parse(
  execFileSync('plutil', ['-convert', 'json', '-o', '-', `${projectPath}/project.pbxproj`]),
);
const filePaths = new Map();
function collectFilePaths(id, parentDirectory) {
  const object = project.objects[id];
  const directory = resolve(
    object.sourceTree === 'SOURCE_ROOT' ? projectDirectory : parentDirectory,
    object.path ?? '',
  );
  if (object.isa === 'PBXFileReference') filePaths.set(id, directory);
  for (const child of object.children ?? []) collectFilePaths(child, directory);
}
collectFilePaths(project.objects[project.rootObject].mainGroup, projectDirectory);
const testTarget = Object.values(project.objects).find(
  (object) => object.isa === 'PBXNativeTarget' && object.name === 'UpdaterPluginTests',
);
const compiledSources = (testTarget?.buildPhases ?? [])
  .map((id) => project.objects[id])
  .filter((phase) => phase.isa === 'PBXSourcesBuildPhase')
  .flatMap((phase) => phase.files.map((id) => filePaths.get(project.objects[id].fileRef)))
  .sort();
const testDirectory = resolve(packageDirectory, 'ios/Tests/UpdaterPluginTests');
const shippedSources = readdirSync(testDirectory, { recursive: true })
  .filter((path) => path.endsWith('.swift'))
  .map((path) => resolve(testDirectory, path))
  .sort();
if (JSON.stringify(compiledSources) !== JSON.stringify(shippedSources)) {
  throw new Error(
    'Native test host sources differ from the shipped tests. Regenerate the Xcode project from ios/TestsHost/project.yml; see ios/TestsHost/README.md.',
  );
}
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
    '-project',
    projectPath,
    '-scheme',
    'UpdaterTests',
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
