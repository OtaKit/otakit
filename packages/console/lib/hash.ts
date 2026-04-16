import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const BCRYPT_ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);

export async function hashManagementKey(key: string): Promise<string> {
  return bcrypt.hash(key, BCRYPT_ROUNDS);
}

export async function verifyManagementKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

export function generateManagementKey(): string {
  return crypto.randomUUID();
}
