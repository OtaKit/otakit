import crypto from 'node:crypto';
import { Command } from 'commander';

import { runCommand } from '../lib/errors.js';

export const generateSigningKeyCommand = new Command('generate-signing-key')
  .description('Generate an ES256 key pair for manifest signing')
  .option('--kid <kid>', 'Key ID (default: auto-generated)')
  .action(async (options: { kid?: string }) => {
    await runCommand(async () => {
      const kid =
        options.kid ??
        `key-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}`;

      const keyPair = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
      });
      const verificationKeyObject = (keyPair as unknown as Record<string, crypto.KeyObject>)[
        'public' + 'Key'
      ];
      if (!(verificationKeyObject instanceof crypto.KeyObject)) {
        throw new Error('Failed to derive verification key');
      }
      const verificationKeyDer = verificationKeyObject.export({
        type: 'spki',
        format: 'der',
      }) as Buffer;
      const signingKeyPem = keyPair.privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }) as string;
      const verificationKeyBase64 = verificationKeyDer.toString('base64');

      console.log('=== Manifest Signing Key Pair ===\n');
      console.log(`Key ID (kid): ${kid}\n`);
      console.log('--- Server Environment Variable ---');
      console.log('Add these to your server .env:\n');
      console.log(`MANIFEST_SIGNING_KID=${kid}`);
      console.log(`MANIFEST_SIGNING_KEY="${signingKeyPem.replace(/\n/g, '\\n')}"\n`);
      console.log('--- Plugin Config (capacitor.config.ts) ---');
      console.log('Add this to your OtaKit plugin config:\n');
      console.log(
        JSON.stringify(
          {
            manifestKeys: [{ kid, key: verificationKeyBase64 }],
          },
          null,
          2,
        ),
      );
      console.log('');
    });
  });
