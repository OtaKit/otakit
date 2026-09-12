import { useEffect, useState } from 'react';
import { Button, ScrollView, Text } from 'react-native';
import {
  apply,
  check,
  download,
  getState,
  launchContext,
  notifyAppReady,
} from '@otakit/react-native-updater';
import { fixtureVersion, withholdReadiness } from './fixture-version';
import { backgroundWork } from './background-work';

async function applyWhenHostSettles() {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await apply();
      return;
    } catch (error) {
      if (!String(error).includes('ACTIVATION_DEFERRED') || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export default function App({ otaTestScenario }: { otaTestScenario?: string }) {
  const [status, setStatus] = useState('Starting');
  useEffect(() => {
    if (otaTestScenario) {
      void (async () => {
        const report = async (value: unknown) =>
          fetch('http://127.0.0.1:9042/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value),
          });
        try {
          const state = await getState();
          if (withholdReadiness) {
            if (otaTestScenario === 'crash-trial')
              await report({ scenario: otaTestScenario, fixtureVersion, state, launchContext });
            return; // Native timeout or the next process must recover this unconfirmed trial.
          }
          await notifyAppReady();
          if (
            otaTestScenario === 'boot' ||
            (otaTestScenario === 'rollback' && state.failed.length > 0)
          ) {
            await report({
              scenario: otaTestScenario,
              fixtureVersion,
              state: await getState(),
              launchContext,
            });
            return;
          }
          const manifest = await check();
          if (otaTestScenario === 'associate') {
            await download();
            await report({
              scenario: otaTestScenario,
              fixtureVersion,
              state: await getState(),
              launchContext,
            });
            return;
          }
          if (otaTestScenario === 'headless-guard') {
            const deadline = Date.now() + 10_000;
            while (!backgroundWork.started) {
              if (Date.now() >= deadline) throw new Error('Native headless task did not start');
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            await download();
            try {
              await apply();
              throw new Error('Activated while background work was running');
            } catch (error) {
              if (!String(error).includes('ACTIVATION_DEFERRED')) throw error;
              await report({
                scenario: otaTestScenario,
                fixtureVersion,
                state: await getState(),
                deferred: true,
              });
            }
            return;
          }
          if (manifest.contentHash !== launchContext.contentHash) {
            await download();
            await applyWhenHostSettles();
          } else
            await report({
              scenario: otaTestScenario,
              fixtureVersion,
              state: await getState(),
              launchContext,
            });
        } catch (error) {
          await report({ scenario: otaTestScenario, error: String(error) });
        }
      })();
      return;
    }
    if (!withholdReadiness)
      void notifyAppReady().then(
        () => setStatus('Ready'),
        (error) => setStatus(String(error)),
      );
    else setStatus('Readiness deliberately withheld');
  }, [otaTestScenario]);
  async function run(operation: () => Promise<unknown>) {
    try {
      setStatus(JSON.stringify(await operation(), null, 2) ?? 'Completed');
    } catch (error) {
      setStatus(String(error));
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 30, paddingTop: 80, gap: 16 }}>
      <Text accessibilityLabel="fixture-version" style={{ fontSize: 24 }}>
        OtaKit RN fixture: {fixtureVersion}
      </Text>
      <Text>{JSON.stringify(launchContext, null, 2)}</Text>
      <Button title="Check" onPress={() => void run(check)} />
      <Button title="Download" onPress={() => void run(download)} />
      <Button title="Apply" onPress={() => void run(apply)} />
      <Button title="Inspect state" onPress={() => void run(getState)} />
      <Text accessibilityLabel="fixture-status">{status}</Text>
    </ScrollView>
  );
}
