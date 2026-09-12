import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Use the same environment before native capture, public config and Metro evaluation. */
export function prepareExpoEnvironment(project: string): string[] {
  const require = createRequire(join(project, 'package.json'));
  const manifest = require('./package.json');
  if (!manifest.dependencies?.expo && !manifest.devDependencies?.expo) return [];
  const expoRequire = createRequire(require.resolve('expo/package.json'));
  const cliRoot = dirname(expoRequire.resolve('@expo/cli/package.json'));
  const cliRequire = createRequire(join(cliRoot, 'package.json'));
  if (
    require('expo/package.json').version !== '57.0.17' ||
    cliRequire('./package.json').version !== '57.0.19'
  )
    throw new Error('Expo export adapter requires the accepted Expo 57.0.17 / CLI 57.0.19 pair');
  for (const key of ['NODE_ENV', 'BABEL_ENV']) {
    if (process.env[key] && process.env[key] !== 'production')
      throw new Error(
        `Expo native build/export requires ${key}=production; unset it or select production explicitly`,
      );
  }
  const { setNodeEnv, loadEnvFiles, getEnvFiles } = cliRequire('./build/src/utils/nodeEnv.js');
  setNodeEnv('production');
  loadEnvFiles(project, { silent: true });
  return (getEnvFiles(project) as string[]).filter((file) => {
    const info = statSync(file, { throwIfNoEntry: false });
    if (info && !info.isFile())
      throw new Error(`Expo environment input must be a regular file: ${file}`);
    return Boolean(info);
  });
}
