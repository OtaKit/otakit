import { Polar } from '@polar-sh/sdk';

let _polar: Polar | null = null;
let _warnedMissing = false;

export function isPolarConfigured(): boolean {
  return !!process.env.POLAR_ACCESS_TOKEN?.trim();
}

export function getPolar(): Polar {
  if (!_polar) {
    const token = process.env.POLAR_ACCESS_TOKEN;
    if (!token) {
      throw new Error('POLAR_ACCESS_TOKEN must be set');
    }
    _polar = new Polar({
      accessToken: token,
      server: (process.env.POLAR_SERVER as 'sandbox' | 'production') || 'production',
    });
  }
  return _polar;
}

export function warnPolarNotConfigured(context: string): void {
  if (!_warnedMissing) {
    console.warn(
      '[OtaKit] Polar is not configured — billing features are disabled. Set POLAR_ACCESS_TOKEN to enable.',
    );
    _warnedMissing = true;
  }
  console.warn(`[OtaKit] Skipping ${context}: Polar not configured`);
}
