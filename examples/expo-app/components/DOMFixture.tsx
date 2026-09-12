'use dom';
import { useEffect } from 'react';
import type { DOMProps } from 'expo/dom';

export default function DOMFixture({
  label,
  onReady,
}: {
  label: string;
  onReady?: (content: { version: string; htmlVersion: string }) => Promise<void>;
  dom?: DOMProps;
}) {
  useEffect(() => {
    void onReady?.({
      version: 'OTAKIT_EXPO_DOM_EMBEDDED',
      htmlVersion:
        document.querySelector<HTMLMetaElement>('meta[name="otakit-fixture-version"]')?.content ??
        'embedded',
    });
  }, [onReady]);
  return (
    <main>
      <h1>OtaKit DOM: {label}</h1>
      <button onClick={() => (document.body.dataset.clicked = 'yes')}>Test DOM action</button>
    </main>
  );
}
