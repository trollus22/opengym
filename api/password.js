/* Password hashing — scrypt from node:crypto, so the image ships no native dependency and
   still never stores a password it could hand back.
 *
 * Why scrypt and not argon2/bcrypt: both of those are native modules that have to be compiled
 * for musl as well as glibc, and this container is built from a pinned lockfile. node:crypto's
 * scrypt is memory-hard, is in the standard library, and at these parameters costs ~60-120ms
 * and 16 MB per attempt on the box this runs on — which is the point. A self-hosted instance
 * has no rate limiter in front of it, so the hash is what has to make guessing expensive.
 *
 * The stored value carries its own parameters, so raising the cost later is a matter of
 * verifying old hashes with the parameters they were written with and re-hashing on next
 * sign-in. Nothing here needs a migration to change its mind.
 */
import crypto from 'node:crypto';

const SCHEME = 'scrypt';
const N = 16384;                 // CPU/memory cost (2^14)
const R = 8;                     // block size
const P = 1;                     // parallelisation
const KEYLEN = 64;
const SALT_BYTES = 16;
// scrypt needs maxmem >= 128 * N * r (~16 MB here). Node's default is 32 MB, which is enough,
// but passing it explicitly means the day someone lowers N this does not start failing on a
// different Node build's default.
const MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

/** Returns a human-readable reason the password is unacceptable, or null if it is fine. */
export function passwordProblem(password) {
  const pw = String(password ?? '');
  if (pw.length < MIN_PASSWORD) return `password must be at least ${MIN_PASSWORD} characters`;
  if (pw.length > MAX_PASSWORD) return `password must be at most ${MAX_PASSWORD} characters`;
  return null;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = crypto.scryptSync(String(password), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return [SCHEME, N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** Constant-time check against a stored hash. Any malformed input is simply "wrong". */
export function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, salt, hash] = String(stored || '').split('$');
    if (scheme !== SCHEME) return false;
    const expected = Buffer.from(hash, 'base64url');
    if (!expected.length) return false;
    const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64url'), expected.length, {
      N: +n, r: +r, p: +p, maxmem: MAXMEM
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

// A hash of an unguessable random string, used to burn the same ~100ms when the username does
// not exist. Without it, "no such user" returns in a fraction of the time a wrong password
// takes, and the login endpoint becomes a free directory of who has an account.
export const DUMMY_HASH = hashPassword(crypto.randomBytes(32).toString('hex'));
