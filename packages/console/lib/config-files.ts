import { purgeCdnUrls } from '@/lib/cdn-purge';
import { signConfig, type ManifestSignature } from '@/lib/manifest-signing';
import { configChannelKey } from '@/lib/remote-config';
import { buildPublicObjectUrl, putTextObject } from '@/lib/storage';

/**
 * The signed remote config file of one channel, read by plugin 3.4+:
 * `config/{appId}/{channelKey}/config.json`. A named channel without a file,
 * or whose file is a signed deletion, makes devices use the base channel's
 * file.
 */

const CONFIG_PREFIX = 'config';
/** Like manifests: devices see a change within minutes; every write purges the CDN. */
const CONFIG_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';

export type ConfigFile = {
  appId: string;
  channel: string | null;
  version: number;
  /** A signed deletion: no values of its own. */
  deleted: boolean;
  /** Exactly the signed text: a JSON object ("{}" when deleted). */
  valuesJson: string;
  /** Exactly the signed text: a JSON array, or null without experiments. */
  experimentsJson: string | null;
  updatedAt: string;
  signature: ManifestSignature | null;
};

/**
 * Devices ignore config files over 64 KiB. Values (16 KiB) and A/B tests are
 * each limited, but the file escapes both texts again, so the whole file is
 * checked, with room left for the signature.
 */
export const MAX_CONFIG_FILE_BYTES = 63 * 1024;

/** Size of the file as written, without its signature (a few hundred bytes). */
export function configFileBytes(input: Omit<ConfigFile, 'signature'>): number {
  return new TextEncoder().encode(JSON.stringify({ ...input, signature: null })).length;
}

export function buildConfigStorageKey(appId: string, channel: string | null): string {
  return `${CONFIG_PREFIX}/${appId}/${configChannelKey(channel)}/config.json`;
}

export function buildConfigUrl(appId: string, channel: string | null): string {
  return buildPublicObjectUrl(buildConfigStorageKey(appId, channel));
}

/** The file as written: every field the signature covers carries the signed value. */
export function buildConfigFile(input: Omit<ConfigFile, 'signature'>): ConfigFile {
  return {
    ...input,
    signature: signConfig({
      appId: input.appId,
      channel: input.channel,
      version: input.version,
      deleted: input.deleted,
      valuesJson: input.valuesJson,
      experimentsJson: input.experimentsJson,
    }),
  };
}

export async function writeConfigFile(input: Omit<ConfigFile, 'signature'>): Promise<void> {
  const storageKey = buildConfigStorageKey(input.appId, input.channel);
  await putTextObject({
    storageKey,
    body: JSON.stringify(buildConfigFile(input)),
    contentType: 'application/json; charset=utf-8',
    cacheControl: CONFIG_CACHE_CONTROL,
  });
  // Also clears a cached 404 when a channel gets its first config.
  await purgeCdnUrls([buildPublicObjectUrl(storageKey)]);
}
