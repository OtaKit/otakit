'use dom';
import { useEffect } from 'react';
import type { DOMProps } from 'expo/dom';

export default function DOMFixture({
  label,
  onReady,
}: {
  label: string;
  onReady?: () => Promise<void>;
  dom?: DOMProps;
}) {
  useEffect(() => {
    void onReady?.();
  }, [onReady]);
  return (
    <main>
      <h1>OtaKit DOM: {label}</h1>
      <button onClick={() => (document.body.dataset.clicked = 'yes')}>Test DOM action</button>
    </main>
  );
}
