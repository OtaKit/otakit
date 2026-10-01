import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yazl from 'yazl';

const storage = vi.hoisted(() => ({ getObjectRange: vi.fn(), getTextObject: vi.fn() }));
vi.mock('@/lib/storage', () => storage);

import { getBundleFileList, readZipFileList } from './bundle-files';

type Entry = { name: string; data?: string; directory?: boolean; zip64?: boolean };

/** An archive written by yazl, the library the CLI zips bundles with. */
async function yazlZip(
  entries: Entry[],
  options: { comment?: string; zip64?: boolean } = {},
): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    if (entry.directory) zip.addEmptyDirectory(entry.name);
    else {
      zip.addBuffer(Buffer.from(entry.data ?? ''), entry.name, {
        compress: true,
        forceZip64Format: entry.zip64 === true,
      });
    }
  }
  // yazl supports `comment`; its type definitions lag behind.
  zip.end({
    comment: options.comment,
    forceZip64Format: options.zip64 === true,
  } as yazl.EndOptions);
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function reader(archive: Buffer) {
  return vi.fn(async (start: number, end: number) => archive.subarray(start, end + 1));
}

const crcHex = (data: string) => crc32(Buffer.from(data)).toString(16).padStart(8, '0');

describe('readZipFileList', () => {
  it('lists files with uncompressed sizes and CRC-32 in two reads', async () => {
    const archive = await yazlZip([
      { name: 'index.html', data: '<html>app</html>' },
      { name: 'assets/', directory: true },
      { name: 'assets/main.js', data: 'console.log(1);'.repeat(100) },
    ]);
    const read = reader(archive);

    await expect(readZipFileList(read, archive.length)).resolves.toEqual([
      { path: 'index.html', size: 16, hash: crcHex('<html>app</html>') },
      { path: 'assets/main.js', size: 1500, hash: crcHex('console.log(1);'.repeat(100)) },
    ]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('decodes UTF-8 names and skips an archive comment', async () => {
    const archive = await yazlZip(
      [
        { name: 'assets/ünïcode/日本.txt', data: 'x' },
        { name: 'a b/c.json', data: '{}' },
      ],
      { comment: 'built by CI' },
    );
    expect(archive.subarray(-11).toString()).toBe('built by CI');
    const files = await readZipFileList(reader(archive), archive.length);
    expect(files.map((file) => file.path)).toEqual(['assets/ünïcode/日本.txt', 'a b/c.json']);
  });

  it('reads ZIP64 entries and the ZIP64 end of central directory', async () => {
    const archive = await yazlZip(
      [
        { name: 'index.html', data: 'hello', zip64: true },
        { name: 'big.bin', data: 'y'.repeat(4096), zip64: true },
      ],
      { zip64: true },
    );
    const read = reader(archive);
    await expect(readZipFileList(read, archive.length)).resolves.toEqual([
      { path: 'index.html', size: 5, hash: crcHex('hello') },
      { path: 'big.bin', size: 4096, hash: crcHex('y'.repeat(4096)) },
    ]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('rejects data that is not a complete zip archive', async () => {
    const archive = await yazlZip([{ name: 'index.html', data: 'x' }]);
    const garbage = Buffer.from('not a zip archive at all, just text');
    await expect(readZipFileList(reader(garbage), garbage.length)).rejects.toThrow(
      /end of central/,
    );
    const truncated = archive.subarray(0, archive.length - 10);
    await expect(readZipFileList(reader(truncated), truncated.length)).rejects.toThrow();
    await expect(readZipFileList(reader(Buffer.alloc(4)), 4)).rejects.toThrow(/too small/);
  });

  describe('archives from the system zip tool', () => {
    let directory: string;
    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), 'otakit-zip-'));
    });
    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    const hasZip = (() => {
      try {
        execFileSync('zip', ['-v'], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();

    it.skipIf(!hasZip)('reads nested paths and skips directory entries', async () => {
      mkdirSync(join(directory, 'web', 'assets', 'img'), { recursive: true });
      writeFileSync(join(directory, 'web', 'index.html'), '<html></html>');
      writeFileSync(join(directory, 'web', 'assets', 'img', 'logo.svg'), '<svg/>');
      execFileSync('zip', ['-r', '-q', join(directory, 'out.zip'), '.'], {
        cwd: join(directory, 'web'),
      });
      const archive = readFileSync(join(directory, 'out.zip'));
      const files = await readZipFileList(reader(archive), archive.length);
      expect(files.map((file) => file.path).sort()).toEqual(['assets/img/logo.svg', 'index.html']);
      expect(files.find((file) => file.path === 'index.html')).toEqual({
        path: 'index.html',
        size: 13,
        hash: crcHex('<html></html>'),
      });
    });
  });
});

describe('getBundleFileList', () => {
  const bundle = { id: 'b', storageKey: 'bundles/app/1.zip', size: 0, encryption: null };

  beforeEach(() => {
    storage.getObjectRange.mockReset();
    storage.getTextObject.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('reads a zip bundle through range requests on its storage object', async () => {
    const archive = await yazlZip([{ name: 'index.html', data: 'x' }]);
    storage.getObjectRange.mockImplementation(async (_key: string, start: number, end: number) =>
      archive.subarray(start, end + 1),
    );
    await expect(
      getBundleFileList({ ...bundle, strategy: 'zip', size: archive.length }),
    ).resolves.toEqual({
      ok: true,
      list: { hashType: 'crc32', files: [{ path: 'index.html', size: 1, hash: crcHex('x') }] },
    });
    expect(storage.getObjectRange).toHaveBeenCalledWith('bundles/app/1.zip', 0, archive.length - 1);
  });

  it('reads the stored file list of a delta bundle', async () => {
    storage.getTextObject.mockResolvedValue(
      JSON.stringify({
        version: '1.0.0',
        filesHash: 'f',
        files: [{ path: 'index.html', sha256: 'AB'.repeat(32), size: 10 }],
      }),
    );
    await expect(getBundleFileList({ ...bundle, strategy: 'deltas' })).resolves.toEqual({
      ok: true,
      list: {
        hashType: 'sha256',
        files: [{ path: 'index.html', size: 10, hash: 'ab'.repeat(32) }],
      },
    });
  });

  it('cannot see inside encrypted bundles and reports unreadable archives', async () => {
    await expect(
      getBundleFileList({ ...bundle, strategy: 'zip', encryption: { alg: 'A256GCM' } }),
    ).resolves.toEqual({ ok: false, reason: 'encrypted' });
    expect(storage.getObjectRange).not.toHaveBeenCalled();

    storage.getObjectRange.mockResolvedValue(Buffer.from('garbage-garbage-garbage-garbage'));
    await expect(getBundleFileList({ ...bundle, strategy: 'zip', size: 31 })).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });
});
