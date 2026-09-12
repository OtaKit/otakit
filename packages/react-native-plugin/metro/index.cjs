const path = require('node:path');

function withOtaKitMetro(config, { enabled = true } = {}) {
  if (!enabled) return config;
  const previousModules = config.serializer?.getModulesRunBeforeMainModule;
  const previousResolve = config.resolver?.resolveRequest;
  const bootstrap = path.resolve(__dirname, '../src/bootstrap.ts');
  const constants = path.resolve(__dirname, '../src/expo/constants.ts');
  const dom = path.resolve(__dirname, '../src/expo/dom.ts');
  const originals = new Map();
  return {
    ...config,
    serializer: {
      ...config.serializer,
      getModulesRunBeforeMainModule(entry) {
        // Expo DOM runs in a WebView and has no RN TurboModule registry.
        if (/[/\\]expo[/\\]dom[/\\]entry\.js$/.test(entry)) return previousModules?.(entry) ?? [];
        // Preserve upstream initializer order, then bind before the original app main.
        return [...new Set([...(previousModules?.(entry) ?? []), bootstrap])];
      },
    },
    resolver: {
      ...config.resolver,
      resolveRequest(context, name, platform) {
        const resolve = (target) =>
          previousResolve
            ? previousResolve(context, target, platform)
            : context.resolveRequest(context, target, platform);
        if (name.startsWith('otakit:original-expo-')) {
          const original = originals.get(`${platform}:${name}`);
          if (!original)
            throw new Error(`OtaKit facade was imported without its original module: ${name}`);
          return original;
        }
        const result = resolve(name);
        if (platform === 'web') return result;
        if (result.type !== 'sourceFile') return result;
        if (name === 'expo-constants' && context.originModulePath !== constants) {
          originals.set(`${platform}:otakit:original-expo-constants`, result);
          return { type: 'sourceFile', filePath: constants };
        }
        if (
          /[/\\]expo[/\\](src|build)[/\\]dom[/\\]base\.(ts|js)$/.test(result.filePath) &&
          context.originModulePath !== dom
        ) {
          originals.set(`${platform}:otakit:original-expo-dom`, result);
          return { type: 'sourceFile', filePath: dom };
        }
        return result;
      },
    },
  };
}
module.exports = { withOtaKitMetro };
