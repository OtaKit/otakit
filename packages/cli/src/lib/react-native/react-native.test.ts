import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashInventory, type EmbeddedReceipt } from '@otakit/rn-protocol';
import { encryptFile } from '../crypto.js';
import { archiveRNDirectory, collectRNFiles, copyRNMapping, verifyRNArchive } from './artifacts.js';
import { adoptBaseline, type BaselineAdoption } from './baseline-adoption.js';
import { newPublicationReceipt, resumePublication, writeReceipt } from './receipts.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'otakit-rn-tooling-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('RN artifacts and verified baseline adoption', () => {
  async function archive() {
    await writeFile(join(root, 'index.bundle'), 'test-bytecode');
    await writeFile(join(root, 'otakit-bundle.json'), '{}');
    const files = await collectRNFiles(root);
    const zipPath = join(root, 'payload.zip');
    await archiveRNDirectory(root, zipPath, files);
    return { files, zipPath, bytes: await readFile(zipPath) };
  }
  it('rejects colliding source mappings before copying the first file', async () => {
    const a = join(root, 'a');
    const b = join(root, 'b');
    await writeFile(a, 'a');
    await writeFile(b, 'b');
    await expect(
      copyRNMapping(
        [
          { source: a, destination: 'drawable-mdpi/icons_login.png' },
          { source: b, destination: 'drawable-mdpi/icons_login.png' },
        ],
        join(root, 'output'),
      ),
    ).rejects.toThrow('collides');
    await expect(readFile(join(root, 'output/drawable-mdpi/icons_login.png'))).rejects.toThrow();
    await expect(
      copyRNMapping(
        [
          { source: a, destination: 'Icons/a.png' },
          { source: b, destination: 'icons/b.png' },
        ],
        join(root, 'output'),
      ),
    ).rejects.toThrow('Conflicting');
  });
  it('verifies archive bytes against every declared hash and rejects extra entries', async () => {
    const value = await archive();
    await verifyRNArchive(value.bytes, value.files);
    await expect(
      verifyRNArchive(
        value.bytes,
        value.files.map((file, index) =>
          index === 0 ? { ...file, sha256: '0'.repeat(64) } : file,
        ),
      ),
    ).rejects.toThrow('mismatch');
    await expect(verifyRNArchive(Buffer.from('not a zip'), value.files)).rejects.toThrow();
  });
  it('adopts actual encrypted archive bytes under the permitted key and records their envelope', async () => {
    const value = await archive();
    const key = Buffer.alloc(32, 1);
    const ciphertextPath = join(root, 'stored.enc');
    const encryption = await encryptFile(key, value.zipPath, ciphertextPath);
    const bytes = await readFile(ciphertextPath);
    const receipt: EmbeddedReceipt = {
      appId: 'app',
      framework: 'react-native',
      platform: 'ios',
      runtimeVersion: 'A'.repeat(43),
      version: 'baseline',
      embeddedContentHash: hashInventory(value.files),
    };
    const stored: BaselineAdoption = {
      ...receipt,
      id: 'bundle',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      contentHash: receipt.embeddedContentHash,
      strategy: 'zip',
      encryption,
      embeddedReceipt: receipt,
      baselineBundleId: null,
      files: value.files,
      downloadUrl: 'https://cdn.example/stored.zip',
    };
    const receiptPath = join(root, 'adoption.json');
    const fetcher = vi.fn(async () => new Response(bytes)) as unknown as typeof fetch;
    const options = {
      stored,
      expected: receipt,
      files: value.files,
      strategy: 'zip' as const,
      encryptionKey: key,
      receiptPath,
      fetcher,
    };
    await adoptBaseline(options);
    const saved = JSON.parse(await readFile(receiptPath, 'utf8'));
    expect(saved.bundle.encryption).toEqual(encryption);
    expect(saved.bundle.sha256).toBe(stored.sha256);
    expect(JSON.stringify(saved)).not.toContain(key.toString('base64'));
    await expect(adoptBaseline({ ...options, encryptionKey: null })).rejects.toThrow('policy');
    await expect(adoptBaseline({ ...options, encryptionKey: Buffer.alloc(32, 2) })).rejects.toThrow(
      'policy',
    );
    const tampered = Buffer.from(bytes);
    tampered[0] ^= 1;
    await expect(
      adoptBaseline({ ...options, fetcher: (async () => new Response(tampered)) as typeof fetch }),
    ).rejects.toThrow('hash/size');
    await expect(
      adoptBaseline({
        ...options,
        stored: {
          ...stored,
          encryption: { ...encryption, nonce: Buffer.alloc(12, 4).toString('base64') },
        },
      }),
    ).rejects.toThrow();
  });
});

describe('durable RN publication receipts', () => {
  const now = new Date('2026-09-11T00:00:00.000Z');
  const intent = { version: 1 as const, actorKey: 'key:original', preparedAt: now.toISOString() };
  const args = {
    appId: 'app',
    platform: 'ios' as const,
    runtimeVersion: 'A'.repeat(43),
    bundleId: 'bundle',
    channel: null,
    expectedCurrentReleaseId: null,
    forceImmediate: false,
    autoRevert: false,
  };
  async function prepare() {
    const receiptPath = join(root, 'new-directory', 'nested', 'publication.json');
    const receipt = newPublicationReceipt(
      { serverUrl: 'https://console.example', organizationId: 'org', intent, arguments: args },
      now,
    );
    await writeReceipt(receiptPath, receipt);
    return {
      receiptPath,
      receipt,
      serverUrl: receipt.serverUrl,
      organizationId: 'org',
      actorKey: intent.actorKey,
      arguments: args,
      now,
    };
  }
  it('persists uncertainty before sending and retries a lost response with exactly the original operation', async () => {
    const options = await prepare();
    let sends = 0;
    const send = vi.fn(async (receipt) => {
      const saved = JSON.parse(await readFile(options.receiptPath, 'utf8'));
      expect(saved.state).toBe('outcome-unknown');
      expect(receipt.operationKey).toBe(options.receipt.operationKey);
      if (sends++ === 0) throw new Error('Response lost after server commit');
      return { release: 'original-committed-result' };
    });
    await expect(resumePublication({ ...options, send })).rejects.toThrow('Response lost');
    expect(await resumePublication({ ...options, send })).toEqual({
      release: 'original-committed-result',
    });
    await resumePublication({ ...options, send });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('stops actor rotation, changed arguments, missing receipts and unsafe clocks without sending', async () => {
    const options = await prepare();
    const send = vi.fn();
    await expect(resumePublication({ ...options, actorKey: 'key:rotated', send })).rejects.toThrow(
      'RN_REPLAY_SCOPE_LOST',
    );
    await expect(
      resumePublication({
        ...options,
        arguments: { ...args, expectedCurrentReleaseId: 'different' },
        send,
      }),
    ).rejects.toThrow('RN_REPLAY_SCOPE_LOST');
    await expect(
      resumePublication({ ...options, now: new Date(now.getTime() - 1), send }),
    ).rejects.toThrow('clock');
    await expect(
      resumePublication({ ...options, now: new Date(now.getTime() + 24 * 3600_000), send }),
    ).rejects.toThrow('clock');
    await expect(
      resumePublication({ ...options, receiptPath: join(root, 'missing.json'), send }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it('does not let overlapping processes send the same receipt concurrently', async () => {
    const options = await prepare();
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = resumePublication({
      ...options,
      send: async () => {
        started();
        await pending;
        return 'done';
      },
    });
    await ready;
    await expect(resumePublication({ ...options, send: vi.fn() })).rejects.toThrow('locked');
    release();
    expect(await first).toBe('done');
  });
  it('never treats a damaged committed receipt or an empty response as proof of completion', async () => {
    const options = await prepare();
    await expect(resumePublication({ ...options, send: async () => undefined })).rejects.toThrow(
      'outcome-unknown',
    );
    expect(JSON.parse(await readFile(options.receiptPath, 'utf8')).state).toBe('outcome-unknown');
    await writeReceipt(options.receiptPath, { ...options.receipt, state: 'committed' });
    const send = vi.fn();
    await expect(resumePublication({ ...options, send })).rejects.toThrow(
      'committed receipt has no result',
    );
    expect(send).not.toHaveBeenCalled();
  });
});
