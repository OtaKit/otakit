import type { DeviceEventAction, Platform } from '@/app/components/dashboard-types';

/**
 * The demo's device events, stored column by column in typed arrays: a month of
 * a busy app is over half a million events, which this keeps to a few
 * megabytes. Events are appended in time order, so ranges are binary searches.
 */

export const EVENT_ACTIONS: DeviceEventAction[] = [
  'downloaded',
  'applied',
  'download_error',
  'check_error',
  'rollback',
];
export const ACTION_INDEX: Record<DeviceEventAction, number> = {
  downloaded: 0,
  applied: 1,
  download_error: 2,
  check_error: 3,
  rollback: 4,
};
export const EVENT_PLATFORMS: Platform[] = ['ios', 'android'];

/** One event before it is stored. */
export type PendingEvent = {
  time: number;
  action: number;
  bundle: number;
  lane: number;
  platform: number;
  /** Index of the release that delivered the bundle, or -1. */
  release: number;
  /** Index into the action's detail messages, for errors. */
  detail: number;
};

export class EventStore {
  time = new Float64Array(1 << 16);
  action = new Uint8Array(1 << 16);
  bundle = new Uint16Array(1 << 16);
  lane = new Uint8Array(1 << 16);
  platform = new Uint8Array(1 << 16);
  release = new Int16Array(1 << 16);
  detail = new Uint8Array(1 << 16);
  length = 0;

  private grow() {
    const size = this.time.length * 2;
    const resize = <T extends Float64Array | Uint8Array | Uint16Array | Int16Array>(
      array: T,
      make: (size: number) => T,
    ) => {
      const next = make(size);
      next.set(array);
      return next;
    };
    this.time = resize(this.time, (n) => new Float64Array(n));
    this.action = resize(this.action, (n) => new Uint8Array(n));
    this.bundle = resize(this.bundle, (n) => new Uint16Array(n));
    this.lane = resize(this.lane, (n) => new Uint8Array(n));
    this.platform = resize(this.platform, (n) => new Uint8Array(n));
    this.release = resize(this.release, (n) => new Int16Array(n));
    this.detail = resize(this.detail, (n) => new Uint8Array(n));
  }

  /** Appends a batch, which must not start before the last stored event. */
  append(batch: PendingEvent[]) {
    batch.sort((left, right) => left.time - right.time);
    for (const event of batch) {
      if (this.length === this.time.length) this.grow();
      const i = this.length;
      this.time[i] = event.time;
      this.action[i] = event.action;
      this.bundle[i] = event.bundle;
      this.lane[i] = event.lane;
      this.platform[i] = event.platform;
      this.release[i] = event.release;
      this.detail[i] = event.detail;
      this.length += 1;
    }
  }

  /** Index of the first event at or after `time`. */
  lowerBound(time: number): number {
    let low = 0;
    let high = this.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.time[middle] < time) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
