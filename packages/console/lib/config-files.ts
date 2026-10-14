import { purgeCdnUrls } from '@/lib/cdn-purge';
import { signConfig, type ManifestSignature } from '@/lib/manifest-signing';
import { configChannelKey } from '@/lib/remote-config';
import { buildPublicObjectUrl, deleteStorageObject, putTextObject } from '@/lib/storage';

/**
 * The signed remote config file of one channel, read by plugin 3.4+:
 * `config/{appId}/{channelKey}/config.json`. A channel without a file makes
 * devices fall back to the base channel's file.
 */

const CONFIG_PREFIX = 'config';
/** Like manifests: devices see a change within minutes; every write purges the CDN. */
const CONFIG_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';

export type ConfigFile = {
  appId: string;
  channel: string | null;
  version: number;
  /** Exactly the signed text: a JSON object. */
  valuesJson: string;
  /** Exactly the signed text: a JSON array, or null without experiments. */
  experimentsJson: string | null;
  updatedAt: string;
  signature: ManifestSignature | null;
};

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

export async function deleteConfigFile(appId: string, channel: string | null): Promise<void> {
  const storageKey = buildConfigStorageKey(appId, channel);
  await deleteStorageObject(storageKey);
  await purgeCdnUrls([buildPublicObjectUrl(storageKey)]);
}
