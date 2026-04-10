import { Polar } from '@polar-sh/sdk';

let _polar: Polar | null = null;

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
