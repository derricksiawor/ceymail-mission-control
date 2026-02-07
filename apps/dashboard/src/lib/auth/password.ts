import crypto from "crypto";

// SSHA512: Salted SHA-512, same scheme used for mail users (Dovecot-compatible)
// Format: {SSHA512}<base64(sha512(password + salt) + salt)>

const SALT_LENGTH = 16;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const hash = crypto
    .createHash("sha512")
    .update(Buffer.concat([Buffer.from(password, "utf8"), salt]))
    .digest();
  return "{SSHA512}" + Buffer.concat([hash, salt]).toString("base64");
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash.startsWith("{SSHA512}")) return false;

  const encoded = storedHash.slice("{SSHA512}".length);
  const decoded = Buffer.from(encoded, "base64");

  // SHA-512 produces 64 bytes, rest is the salt
  const hashBytes = decoded.subarray(0, 64);
  const salt = decoded.subarray(64);

  const computed = crypto
    .createHash("sha512")
    .update(Buffer.concat([Buffer.from(password, "utf8"), salt]))
    .digest();

  // Constant-time comparison
  if (hashBytes.length !== computed.length) return false;
  return crypto.timingSafeEqual(hashBytes, computed);
}
