import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import { assertRuntime } from '@otakit/rn-protocol';
import { ApiClient } from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { normalizeChannel } from '../lib/validate.js';
import { prepareRNPublication, publishRNReceipt } from '../lib/react-native/publication.js';
import type { PublicationReceipt } from '../lib/react-native/receipts.js';
import { captureNativeBuild, type NativeBuildInputs } from '../lib/react-native/build-record.js';
import { sealNativeBuild, type CompletedNativeBuild } from '../lib/react-native/completed-build.js';
import { exportRN } from '../lib/react-native/export.js';
import { stageEmbedded } from '../lib/react-native/stage-embedded.js';
import { buildIOS, stageIOSBuild, type IOSBuildOptions } from '../lib/react-native/ios-build.js';
import { resolveEncryptionKey } from '../lib/upload-workflow.js';
import { readOTAUploadExport } from '../lib/react-native/upload-artifact.js';
import {
  collectionSummary,
  prepareRNCollection,
  publishRNCollection,
  type PublicationCollection,
} from '../lib/react-native/collection.js';
import {
  adoptRNUploadBaseline,
  prepareRNUpload,
  uploadRNReceipt,
  type RNUploadReceipt,
} from '../lib/react-native/upload.js';
import {
  prepareRNUploadCollection,
  uploadRNCollection,
  type UploadCollection,
} from '../lib/react-native/upload-collection.js';

type Context = {
  organization: { id: string };
  app: { id: string } | null;
  actor: { type: string; id: string };
};
async function context(api: ApiClient, appId: string): Promise<Context> {
  const value = await api.request<Context>(`/api/v1/context?appId=${encodeURIComponent(appId)}`);
  if (
    value.app?.id !== appId ||
    !value.organization?.id ||
    !['user', 'key'].includes(value.actor?.type) ||
    !value.actor.id
  )
    throw new CliError('The server did not return a complete authenticated RN scope.');
  return value;
}

export const reactNativeCommand = new Command('rn').description(
  'Export, verify native builds, and resume React Native uploads and publications',
);

reactNativeCommand.addCommand(
  new Command('build-ios')
    .description('Build an iOS app through Xcode, archive it, and verify its embedded baseline')
    .option('--project <directory>', 'React Native project', '.')
    .requiredOption('--workspace <path>', 'Xcode workspace, relative to the React Native project')
    .requiredOption('--scheme <name>', 'Xcode scheme')
    .option('--configuration <name>', 'Non-Debug build configuration', 'Release')
    .option('--sdk <name>', 'Xcode SDK, such as iphonesimulator')
    .option('--destination <specifier>', 'Xcode destination')
    .requiredOption('--derived-data <directory>', 'Dedicated Xcode build directory')
    .option('--app-target <name>', 'App target when the scheme contains multiple apps')
    .requiredOption('--native-inputs <path>', 'Recorded iOS native input configuration')
    .requiredOption('--version <version>', 'Embedded bundle version')
    .requiredOption(
      '--output <directory>',
      'New private archive directory outside the project/build',
    )
    .option('--entry <path>', 'JS entry; defaults to the Xcode/RN entry selection')
    .option('--no-code-signing', 'Explicitly disable Xcode signing for local simulator acceptance')
    .action(async (options: Omit<IOSBuildOptions, 'cli'>) => {
      await runCommand(async () => {
        console.log(JSON.stringify(await buildIOS({ ...options, cli: process.argv[1] }), null, 2));
      });
    }),
);

reactNativeCommand.addCommand(
  new Command('stage-ios-build')
    .description('Internal Xcode phase invoked by the installed OtaKit hook')
    .requiredOption('--request <path>', 'Fresh build request created by build-ios')
    .action(async (options: { request: string }) => {
      await runCommand(() => stageIOSBuild(options.request));
    }),
);

reactNativeCommand.addCommand(
  new Command('stage-embedded')
    .description(
      'Verify and stage an embedded export and recorded host settings for native packaging',
    )
    .requiredOption('--embedded-export <directory>', 'Archived platform/runtime embedded export')
    .requiredOption(
      '--configuration <path>',
      'Host settings recorded by otakitHostConfigurationFile',
    )
    .requiredOption('--output <directory>', 'Resource folder matching otakitResourceDirectory')
    .action(async (options: { embeddedExport: string; configuration: string; output: string }) => {
      await runCommand(async () => {
        console.log(JSON.stringify(await stageEmbedded(options), null, 2));
      });
    }),
);

reactNativeCommand.addCommand(
  new Command('prepare-collection')
    .description(
      'Preflight uploaded variants of one version and save every publication intent without publishing',
    )
    .argument('<bundle-ids...>', 'Uploaded RN variant IDs')
    .requiredOption('--app-id <id>', 'RN app ID')
    .requiredOption('--receipt <path>', 'New durable collection receipt')
    .option('--server <url>', 'Server URL')
    .option('--channel <channel>', 'Channel (omit for base)')
    .option('--force-immediate', 'Request immediate activation when the native host permits it')
    .action(
      async (
        bundleIds: string[],
        options: {
          appId: string;
          receipt: string;
          server?: string;
          channel?: string;
          forceImmediate?: boolean;
        },
      ) => {
        await runCommand(async () => {
          const config = await requireConfig({ appId: options.appId, serverUrl: options.server });
          const api = new ApiClient(config);
          const selected = await context(api, config.appId);
          const receipt = await prepareRNCollection({
            api,
            appId: config.appId,
            serverUrl: config.serverUrl,
            organizationId: selected.organization.id,
            actorKey: `${selected.actor.type}:${selected.actor.id}`,
            receiptPath: options.receipt,
            bundleIds,
            channel: options.channel ? normalizeChannel(options.channel) : null,
            forceImmediate: options.forceImmediate === true,
          });
          console.log(
            JSON.stringify(
              { receiptPath: options.receipt, ...collectionSummary(receipt) },
              null,
              2,
            ),
          );
        });
      },
    ),
);

reactNativeCommand.addCommand(
  new Command('publish-collection')
    .description(
      'Publish or resume the saved collection; preserve partial results and original operation keys',
    )
    .argument('<receipt>', 'Previously reviewed collection receipt')
    .option('--server <url>', 'Server URL (must match the saved scope)')
    .action(async (receiptPath: string, options: { server?: string }) => {
      await runCommand(async () => {
        const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as PublicationCollection;
        if (
          receipt?.format !== 'otakit-rn-publication-collection' ||
          receipt.version !== 1 ||
          typeof receipt.appId !== 'string'
        )
          throw new CliError('Invalid RN collection receipt.');
        const config = await requireConfig({ appId: receipt.appId, serverUrl: options.server });
        if (config.serverUrl !== receipt.serverUrl)
          throw new CliError(
            'RN_REPLAY_SCOPE_LOST: selected server differs from the saved collection.',
          );
        const api = new ApiClient(config);
        const selected = await context(api, config.appId);
        const result = await publishRNCollection({
          api,
          appId: config.appId,
          serverUrl: config.serverUrl,
          organizationId: selected.organization.id,
          actorKey: `${selected.actor.type}:${selected.actor.id}`,
          receiptPath,
        });
        console.log(JSON.stringify(collectionSummary(result), null, 2));
      });
    }),
);

reactNativeCommand.addCommand(
  new Command('prepare-upload')
    .description(
      'Verify an archived OTA export and save both exact ZIP transports before uploading',
    )
    .argument('<export-directory>', 'Archived platform/runtime OTA export')
    .requiredOption('--receipt-dir <directory>', 'New private directory for durable upload files')
    .option('--server <url>', 'Server URL')
    .option(
      '--encrypt',
      'Require OTAKIT_ENCRYPTION_KEY; a configured key always enables encryption',
    )
    .action(
      async (
        exportDirectory: string,
        options: { receiptDir: string; server?: string; encrypt?: boolean },
      ) => {
        await runCommand(async () => {
          const exported = await readOTAUploadExport(exportDirectory);
          const encryptionKey = resolveEncryptionKey(options.encrypt);
          const config = await requireConfig({
            appId: exported.receipt.appId,
            serverUrl: options.server,
          });
          const selected = await context(new ApiClient(config), config.appId);
          await prepareRNUpload({
            exportDirectory,
            directory: options.receiptDir,
            encryptionKey,
            scope: {
              serverUrl: config.serverUrl,
              organizationId: selected.organization.id,
              actorKey: `${selected.actor.type}:${selected.actor.id}`,
            },
          });
          console.log(
            JSON.stringify({ receiptDirectory: options.receiptDir, state: 'prepared' }, null, 2),
          );
        });
      },
    ),
);

for (const name of ['upload', 'adopt-baseline'] as const) {
  reactNativeCommand.addCommand(
    new Command(name)
      .description(
        name === 'upload'
          ? 'Upload or resume the saved baseline and OTA ZIPs without publishing'
          : 'Explicitly verify and adopt the stored baseline before uploading the OTA',
      )
      .argument('<receipt-directory>', 'Previously prepared private upload directory')
      .option('--server <url>', 'Server URL (must match the saved scope)')
      .option('--encrypt', 'Require the original OTAKIT_ENCRYPTION_KEY')
      .action(async (directory: string, options: { server?: string; encrypt?: boolean }) => {
        await runCommand(async () => {
          const receipt = JSON.parse(
            await readFile(join(directory, 'upload.json'), 'utf8'),
          ) as RNUploadReceipt;
          if (
            receipt?.format !== 'otakit-rn-upload' ||
            receipt.version !== 1 ||
            typeof receipt.exported?.appId !== 'string'
          )
            throw new CliError('Invalid RN upload receipt.');
          const config = await requireConfig({
            appId: receipt.exported.appId,
            serverUrl: options.server,
          });
          if (new URL(config.serverUrl).toString().replace(/\/$/, '') !== receipt.scope?.serverUrl)
            throw new CliError(
              'RN_UPLOAD_SCOPE_LOST: selected server differs from the saved upload.',
            );
          const encryptionKey = resolveEncryptionKey(options.encrypt);
          const api = new ApiClient(config);
          const selected = await context(api, config.appId);
          const result = await (name === 'upload' ? uploadRNReceipt : adoptRNUploadBaseline)({
            directory,
            encryptionKey,
            api,
            scope: {
              serverUrl: config.serverUrl,
              organizationId: selected.organization.id,
              actorKey: `${selected.actor.type}:${selected.actor.id}`,
            },
          });
          console.log(
            JSON.stringify(
              {
                receiptDirectory: directory,
                baselineBundleId: result.baseline.bundle?.id,
                otaBundleId: result.ota.bundle?.id,
                baselineState: result.baseline.state,
                otaState: result.ota.state,
              },
              null,
              2,
            ),
          );
        });
      }),
  );
}

reactNativeCommand.addCommand(
  new Command('prepare-upload-collection')
    .description('Bind prepared RN variants of one version without uploading or publishing')
    .argument('<receipt-directories...>', 'Previously prepared per-variant upload directories')
    .requiredOption('--receipt <path>', 'New durable upload collection receipt')
    .option('--server <url>', 'Server URL (must match every saved scope)')
    .option('--encrypt', 'Require the original OTAKIT_ENCRYPTION_KEY')
    .action(
      async (
        directories: string[],
        options: { receipt: string; server?: string; encrypt?: boolean },
      ) => {
        await runCommand(async () => {
          const first = JSON.parse(
            await readFile(join(directories[0], 'upload.json'), 'utf8'),
          ) as RNUploadReceipt;
          if (
            first?.format !== 'otakit-rn-upload' ||
            first.version !== 1 ||
            typeof first.exported?.appId !== 'string'
          )
            throw new CliError('Invalid RN upload receipt.');
          const config = await requireConfig({
            appId: first.exported.appId,
            serverUrl: options.server,
          });
          if (new URL(config.serverUrl).toString().replace(/\/$/, '') !== first.scope?.serverUrl)
            throw new CliError(
              'RN_UPLOAD_SCOPE_LOST: selected server differs from the saved upload.',
            );
          const selected = await context(new ApiClient(config), config.appId);
          const result = await prepareRNUploadCollection({
            directories,
            receiptPath: options.receipt,
            encryptionKey: resolveEncryptionKey(options.encrypt),
            scope: {
              serverUrl: config.serverUrl,
              organizationId: selected.organization.id,
              actorKey: `${selected.actor.type}:${selected.actor.id}`,
            },
          });
          console.log(
            JSON.stringify(
              {
                receipt: options.receipt,
                appId: result.appId,
                version: result.displayVersion,
                targets: result.targets.length,
                state: 'prepared',
              },
              null,
              2,
            ),
          );
        });
      },
    ),
);

reactNativeCommand.addCommand(
  new Command('upload-collection')
    .description(
      'Resume prepared RN variants using their original upload receipts without publishing',
    )
    .argument('<receipt>', 'Prepared upload collection receipt')
    .option('--server <url>', 'Server URL (must match the saved scope)')
    .option('--encrypt', 'Require the original OTAKIT_ENCRYPTION_KEY')
    .action(async (receiptPath: string, options: { server?: string; encrypt?: boolean }) => {
      await runCommand(async () => {
        const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as UploadCollection;
        if (
          receipt?.format !== 'otakit-rn-upload-collection' ||
          receipt.version !== 1 ||
          typeof receipt.appId !== 'string'
        )
          throw new CliError('Invalid RN upload collection.');
        const config = await requireConfig({ appId: receipt.appId, serverUrl: options.server });
        if (new URL(config.serverUrl).toString().replace(/\/$/, '') !== receipt.scope?.serverUrl)
          throw new CliError(
            'RN_UPLOAD_SCOPE_LOST: selected server differs from the saved collection.',
          );
        const api = new ApiClient(config);
        const selected = await context(api, config.appId);
        const result = await uploadRNCollection({
          receiptPath,
          api,
          encryptionKey: resolveEncryptionKey(options.encrypt),
          scope: {
            serverUrl: config.serverUrl,
            organizationId: selected.organization.id,
            actorKey: `${selected.actor.type}:${selected.actor.id}`,
          },
        });
        console.log(JSON.stringify(result, null, 2));
      });
    }),
);

reactNativeCommand.addCommand(
  new Command('export-embedded')
    .description('Archive the embedded Hermes payload before building the native application')
    .requiredOption('--native-inputs <path>', 'Resolved native build input JSON')
    .requiredOption('--version <version>', 'Embedded version')
    .requiredOption('--output <directory>', 'New export output directory')
    .option('--project <directory>', 'React Native project', '.')
    .option('--entry <file>', 'Metro entry point', 'index.js')
    .action(
      async (options: {
        nativeInputs: string;
        version: string;
        output: string;
        project: string;
        entry: string;
      }) => {
        await runCommand(async () => {
          const nativeInputs = JSON.parse(
            await readFile(options.nativeInputs, 'utf8'),
          ) as NativeBuildInputs;
          const nativeBuild = await captureNativeBuild(options.project, nativeInputs);
          const receipt = await exportRN({
            ...options,
            nativeInputs,
            nativeBuild,
            purpose: 'embedded',
          });
          console.log(JSON.stringify(receipt, null, 2));
        });
      },
    ),
);

reactNativeCommand.addCommand(
  new Command('seal-build')
    .description(
      'Verify a built APK or iOS .app against its archived embedded export and save a completed receipt',
    )
    .requiredOption('--native-inputs <path>', 'Resolved native build input JSON')
    .requiredOption('--embedded-export <directory>', 'Archived platform/runtime embedded export')
    .requiredOption('--binary <path>', 'Completed APK or iOS .app')
    .requiredOption('--receipt <path>', 'Immutable completed build receipt')
    .option('--project <directory>', 'React Native project', '.')
    .option('--aapt2 <path>', 'Installed Android build-tools aapt2 (required for APKs)')
    .action(
      async (options: {
        nativeInputs: string;
        embeddedExport: string;
        binary: string;
        receipt: string;
        project: string;
        aapt2?: string;
      }) => {
        await runCommand(async () => {
          const nativeInputs = JSON.parse(
            await readFile(options.nativeInputs, 'utf8'),
          ) as NativeBuildInputs;
          const receipt = await sealNativeBuild({
            ...options,
            nativeInputs,
            receiptPath: options.receipt,
          });
          console.log(JSON.stringify(receipt, null, 2));
        });
      },
    ),
);

reactNativeCommand.addCommand(
  new Command('export')
    .description(
      'Export an OTA variant for a verified completed native build and its archived baseline',
    )
    .requiredOption('--native-inputs <path>', 'Matching resolved native build input JSON')
    .requiredOption('--native-build <path>', 'Verified completed build receipt')
    .requiredOption(
      '--baseline-export <directory>',
      'Archived embedded export from that native build',
    )
    .requiredOption('--version <version>', 'OTA display version')
    .requiredOption('--output <directory>', 'New export output directory')
    .option('--project <directory>', 'React Native project', '.')
    .option('--entry <file>', 'Metro entry point', 'index.js')
    .action(
      async (options: {
        nativeInputs: string;
        nativeBuild: string;
        baselineExport: string;
        version: string;
        output: string;
        project: string;
        entry: string;
      }) => {
        await runCommand(async () => {
          const nativeInputs = JSON.parse(
            await readFile(options.nativeInputs, 'utf8'),
          ) as NativeBuildInputs;
          const completedBuild = JSON.parse(
            await readFile(options.nativeBuild, 'utf8'),
          ) as CompletedNativeBuild;
          const receipt = await exportRN({
            ...options,
            nativeInputs,
            completedBuild,
            purpose: 'ota',
          });
          console.log(JSON.stringify(receipt, null, 2));
        });
      },
    ),
);
reactNativeCommand.addCommand(
  new Command('prepare-publication')
    .description(
      'Review one uploaded RN target and save its original publication intent without publishing',
    )
    .argument('<bundleId>', 'Uploaded RN bundle ID')
    .requiredOption('--app-id <id>', 'RN app ID')
    .requiredOption('--platform <platform>', 'ios or android')
    .requiredOption('--runtime <digest>', 'Runtime from the native build receipt')
    .requiredOption('--receipt <path>', 'New durable publication receipt')
    .option('--server <url>', 'Server URL')
    .option('--channel <channel>', 'Channel (omit for base)')
    .option('--force-immediate', 'Request immediate activation when the native host permits it')
    .action(
      async (
        bundleId: string,
        options: {
          appId: string;
          platform: string;
          runtime: string;
          receipt: string;
          server?: string;
          channel?: string;
          forceImmediate?: boolean;
        },
      ) => {
        await runCommand(async () => {
          if (options.platform !== 'ios' && options.platform !== 'android')
            throw new CliError('RN platform must be ios or android.');
          assertRuntime(options.runtime);
          const config = await requireConfig({ appId: options.appId, serverUrl: options.server });
          const api = new ApiClient(config);
          const scope = await context(api, config.appId);
          const receipt = await prepareRNPublication({
            api,
            serverUrl: config.serverUrl,
            organizationId: scope.organization.id,
            receiptPath: options.receipt,
            arguments: {
              appId: config.appId,
              bundleId,
              platform: options.platform,
              runtimeVersion: options.runtime,
              channel: options.channel ? normalizeChannel(options.channel) : null,
              forceImmediate: options.forceImmediate === true,
              autoRevert: false,
            },
          });
          console.log(JSON.stringify({ receiptPath: options.receipt, ...receipt }, null, 2));
        });
      },
    ),
);

reactNativeCommand.addCommand(
  new Command('publish')
    .description(
      'Send or retry the exact operation in a saved receipt; never prepares a replacement intent',
    )
    .argument('<receipt>', 'Previously reviewed publication receipt')
    .option('--server <url>', 'Server URL (must match the saved scope)')
    .action(async (receiptPath: string, options: { server?: string }) => {
      await runCommand(async () => {
        const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as PublicationReceipt;
        if (
          receipt?.format !== 'otakit-rn-publication' ||
          typeof receipt.arguments?.appId !== 'string'
        )
          throw new CliError('Invalid RN publication receipt.');
        const config = await requireConfig({
          appId: receipt.arguments.appId,
          serverUrl: options.server,
        });
        // Validate the selected server before making even an authenticated read.
        if (config.serverUrl !== receipt.serverUrl)
          throw new CliError(
            'RN_REPLAY_SCOPE_LOST: selected server differs from the saved operation.',
          );
        const api = new ApiClient(config);
        const scope = await context(api, config.appId);
        const result = await publishRNReceipt({
          api,
          serverUrl: config.serverUrl,
          organizationId: scope.organization.id,
          actorKey: `${scope.actor.type}:${scope.actor.id}`,
          arguments: receipt.arguments,
          receiptPath,
        });
        console.log(JSON.stringify(result, null, 2));
      });
    }),
);
