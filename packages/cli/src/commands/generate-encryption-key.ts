import { Command } from 'commander';

import { runCommand } from '../lib/errors.js';
import { generateEncryptionKey } from '../lib/crypto.js';

export const generateEncryptionKeyCommand = new Command('generate-encryption-key')
  .description('Generate an AES-256 key for end-to-end bundle encryption')
  .action(async () => {
    await runCommand(async () => {
      const { kid, key } = generateEncryptionKey();
      const keyBase64 = key.toString('base64');

      console.log('=== Bundle Encryption Key ===\n');
      console.log(`Key ID (kid): ${kid}\n`);
      console.log('--- CI Environment Variable ---');
      console.log('Add this to your CI secrets (used by `otakit upload --encrypt`):\n');
      console.log(`OTAKIT_ENCRYPTION_KEY=${keyBase64}\n`);
      console.log('--- Plugin Config (capacitor.config.ts) ---');
      console.log('Add this to your OtaKit plugin config:\n');
      console.log(
        JSON.stringify(
          {
            bundleKeys: [{ kid, key: keyBase64 }],
          },
          null,
          2,
        ),
      );
      console.log('');
      console.log('IMPORTANT:');
      console.log(
        '- Do NOT commit this key. Inject it into capacitor.config.ts from an env var at build time.',
      );
      console.log(
        '- Ship a store build that contains bundleKeys BEFORE releasing encrypted bundles,',
      );
      console.log('  or installed apps will be unable to decrypt updates.');
      console.log(
        '- Back the key up. Losing it means installed apps cannot receive updates until a',
      );
      console.log('  store build ships a new key.');
      console.log(
        '- bundleKeys is an array: during rotation, ship old + new keys together so both',
      );
      console.log('  old and new bundles decrypt.');
    });
  });
