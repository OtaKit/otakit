import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const event = {
  eventId: 'cd7b94bb-074a-4a4c-830c-5f4c0c103f68',
  sentAt: '2026-09-20T10:00:00Z',
  platform: 'android',
  action: 'download_error',
  bundleVersion: '1.2.3',
  releaseId: 'release-a',
  nativeBuild: '123',
  detail: 'hash mismatch',
};

function fixture() {
  const send = vi.fn().mockResolvedValue(undefined);
  const env = {
    EVENTS_QUEUE: { send },
    TINYBIRD_API_HOST: 'https://api.tinybird.co',
    TINYBIRD_EVENTS_DATASOURCE: 'device_events_raw',
    TINYBIRD_EVENTS_TOKEN: 'test-token',
  };
  const post = (body: object) =>
    worker.fetch(
      new Request('https://ingest.example/v1/events', {
        method: 'POST',
        headers: { 'X-App-Id': 'app-a', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
    );
  return { send, post };
}

describe('device event context', () => {
  it('accepts check failures before a release or bundle is known', async () => {
    const { post, send } = fixture();
    expect(
      (
        await post({
          ...event,
          action: 'check_error',
          bundleVersion: null,
          releaseId: null,
          phase: 'signature',
          detail: 'signature_expired',
        })
      ).status,
    ).toBe(202);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'check_error',
        bundle_version: '',
        release_id: null,
        phase: 'signature',
        detail: 'signature_expired',
      }),
    );
  });
  it('retains required release identity for download and lifecycle events', async () => {
    const { post, send } = fixture();
    for (const action of ['downloaded', 'applied', 'download_error', 'rollback']) {
      expect((await post({ ...event, action, releaseId: null })).status).toBe(400);
      expect((await post({ ...event, action, bundleVersion: null })).status).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps old native clients valid with null context', async () => {
    const { post, send } = fixture();
    expect((await post(event)).status).toBe(202);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: event.eventId,
        attempt_id: null,
        native_sdk_version: null,
        phase: null,
        lifecycle: null,
      }),
    );
  });
  it('preserves attempt identity and native SDK context through normalization', async () => {
    const { post, send } = fixture();
    const attemptId = 'bundle-cd7b94bb-074a-4a4c-830c-5f4c0c103f68';
    expect(
      (
        await post({
          ...event,
          attemptId,
          nativeSdkVersion: '2.3.3',
          phase: 'integrity',
          lifecycle: 'background',
        })
      ).status,
    ).toBe(202);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_id: attemptId,
        native_sdk_version: '2.3.3',
        phase: 'integrity',
        lifecycle: 'background',
      }),
    );
  });
  it('does not truncate attempt IDs into collisions or reject the event for unknown context', async () => {
    const { post, send } = fixture();
    expect(
      (
        await post({
          ...event,
          attemptId: 'x'.repeat(65),
          phase: 'future-phase',
          lifecycle: 'invalid',
          nativeSdkVersion: 'x'.repeat(100),
        })
      ).status,
    ).toBe(202);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_id: null,
        phase: null,
        lifecycle: null,
        native_sdk_version: 'x'.repeat(32),
      }),
    );
  });
});
