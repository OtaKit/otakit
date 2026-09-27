import {
  previewCampaign,
  createCampaign,
  listCampaigns,
  getCampaign,
  cancelCampaign,
} from './campaigns';
import {
  deletePushCredential,
  listPushCredentials,
  saveApnsCredential,
  saveFcmCredential,
  testPushCredential,
} from './credentials';
import { deliverDueBatches } from './deliver';
import { deleteDevice, getDeviceOverview, getPushUsage, listDevices } from './device-admin';
import { deleteAppData, registerDevice, unregisterDevice, updateDeviceTopics } from './devices';
import type { PushHost } from './host';

type Rest<T> = T extends (host: PushHost, ...rest: infer R) => infer Out
  ? (...args: R) => Out
  : never;

/**
 * The push add-on as one object. Functions that need the host (plan limits,
 * billing period) get it bound here, so callers only pass plain input.
 */
export function createPushService(host: PushHost) {
  return {
    // Devices, called by apps through the host's public endpoint.
    registerDevice: ((...args) => registerDevice(host, ...args)) as Rest<typeof registerDevice>,
    unregisterDevice,
    updateDeviceTopics,

    // Credentials.
    listCredentials: listPushCredentials,
    saveApnsCredential,
    saveFcmCredential,
    deleteCredential: deletePushCredential,
    testCredential: testPushCredential,

    // Campaigns and delivery.
    previewCampaign,
    createCampaign: ((...args) => createCampaign(host, ...args)) as Rest<typeof createCampaign>,
    listCampaigns,
    getCampaign,
    cancelCampaign,
    deliverDueBatches: ((...args) => deliverDueBatches(host, ...args)) as Rest<
      typeof deliverDueBatches
    >,

    // Devices, for the dashboard.
    getDeviceOverview,
    listDevices,
    deleteDevice,
    getUsage: ((...args) => getPushUsage(host, ...args)) as Rest<typeof getPushUsage>,

    // Lifecycle.
    deleteAppData,
  };
}

export type PushService = ReturnType<typeof createPushService>;
