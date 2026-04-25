/**
 * Password hashing using node:crypto's scrypt — no native deps, no extra
 * package. Format: `scrypt$N$<hex-salt>$<hex-hash>`. The cost factor is
 * encoded so we can rotate it later without invalidating old hashes.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Use the 3-arg signature (Node's default scrypt cost N=16384 is fine here).
// Custom cost would require fighting the promisify type — not worth the
// complexity for a self-hosted single-tenant app.
const scryptAsync: (password: string, salt: string, keylen: number) => Promise<Buffer> =
  promisify(scrypt) as never;

const N = 16384; // recorded for forward compatibility if we ever rotate cost
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const salt = randomBytes(16).toString('hex');
  const buf = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${N}$${salt}$${buf.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const [, , salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const buf = await scryptAsync(password, salt, KEY_LEN);
    const expected = Buffer.from(hashHex, 'hex');
    if (buf.length !== expected.length) return false;
    return timingSafeEqual(buf, expected);
  } catch {
    return false;
  }
}
