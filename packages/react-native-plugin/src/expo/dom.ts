import { getBaseURL as originalGetBaseURL } from 'otakit:original-expo-dom';
import { launchContext } from '../bootstrap';
export * from 'otakit:original-expo-dom';

export function getBaseURL(): string | null {
  if (!launchContext.artifactRoot) return originalGetBaseURL();
  if (!launchContext.expoDomRoot) return null;
  // Native supplies a verified absolute file URI. Encode original path spelling once.
  return `${launchContext.artifactRoot.replace(/\/$/, '')}/${launchContext.expoDomRoot}`;
}
