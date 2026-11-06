import type { Metadata } from 'next';

import { DemoApp } from './DemoApp';

export const metadata: Metadata = {
  title: 'OtaKit live demo',
  description:
    'Release, roll out and revert live updates on 72,000 simulated devices in the real OtaKit dashboard. No sign-up.',
};

/** The real dashboard on a simulated fleet, running entirely in the browser. */
export default function DemoPage() {
  return <DemoApp />;
}
