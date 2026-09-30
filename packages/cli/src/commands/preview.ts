import { Command } from 'commander';

import ora from 'ora';

import { ApiClient } from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { parsePreviewExpiry, renderPreview } from '../lib/preview.js';

type PreviewOptions = {
  appId?: string;
  server?: string;
  expires?: string;
  scheme?: string;
  json?: boolean;
  list?: boolean;
  revoke?: string;
};

export const previewCommand = new Command('preview')
  .description(
    'Create a private preview link and QR code that open a bundle in the installed app on one phone, without releasing it',
  )
  .argument('[bundleId]', 'Bundle to preview (default: the latest upload)')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .option('--expires <duration>', 'How long the link works: 1h, 24h, 7d (default) or 30d')
  .option('--scheme <scheme>', "The app's custom URL scheme (remembered for the app)")
  .option('--json', 'Print the preview as JSON')
  .option('--list', 'List active preview links')
  .option('--revoke <previewId>', 'Revoke a preview link')
  .action(async (bundleId: string | undefined, options: PreviewOptions) => {
    await runCommand(async () => {
      const config = await requireConfig({ appId: options.appId, serverUrl: options.server });
      const api = new ApiClient(config);

      if (options.revoke) {
        const result = await api.revokePreview(options.revoke);
        console.log(
          result.status === 'revoked'
            ? 'Revoked the preview link. Phones on it return to their release on the next check.'
            : 'The preview link had already ended.',
        );
        return;
      }

      if (options.list) {
        const { previews } = await api.listPreviews(bundleId);
        if (options.json) {
          console.log(JSON.stringify(previews, null, 2));
          return;
        }
        if (previews.length === 0) console.log('No active preview links.');
        for (const preview of previews) {
          console.log(
            `${preview.id}  ${preview.bundleVersion}  expires ${preview.expiresAt}  ${preview.url}`,
          );
        }
        return;
      }

      const expiresIn = parsePreviewExpiry(options.expires);
      let targetBundleId = bundleId;
      if (!targetBundleId) {
        const { bundles } = await api.listBundles({ limit: 1 });
        if (bundles.length === 0) throw new CliError('No bundles found to preview.');
        targetBundleId = bundles[0].id;
      }

      const spinner = options.json ? null : ora('Creating preview link...').start();
      let preview;
      try {
        ({ preview } = await api.createPreview(targetBundleId, {
          expiresIn,
          urlScheme: options.scheme,
        }));
      } catch (error) {
        spinner?.fail('Could not create the preview link.');
        throw error;
      }
      spinner?.stop();
      console.log(options.json ? JSON.stringify(preview, null, 2) : await renderPreview(preview));
    });
  });
