import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY || process.env.AUTH_SECRET || "ascentra-erp-dev-mfa-aes256-key-32b-secret-2026!";

// Derive 32-byte key for AES-256-GCM
function getEncryptionKey(): Buffer {
  return createHash("sha256").update(MFA_ENCRYPTION_KEY).digest();
}

/**
 * Encode buffer into RFC 4648 Base32 string (without padding)
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decode Base32 string into Buffer
 */
export function base32Decode(input: string): Buffer {
  const cleanInput = input.toUpperCase().replace(/=+$/, "").replace(/[\s-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleanInput.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleanInput[i]);
    if (idx === -1) {
      throw new Error(`Invalid base32 character: ${cleanInput[i]}`);
    }

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generate a new random Base32 TOTP secret (20 bytes = 160 bits)
 */
export function generateTotpSecret(byteLength = 20): string {
  const bytes = randomBytes(byteLength);
  return base32Encode(bytes);
}

/**
 * Generate standard otpauth:// URI for QR code generation
 */
export function generateTotpUri(params: {
  email: string;
  secret: string;
  issuer?: string;
}): string {
  const issuer = params.issuer || "Ascentra ERP";
  const label = encodeURIComponent(`${issuer}:${params.email}`);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${params.secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Calculate TOTP code for a given secret at specific counter / epoch
 */
export function calculateTotpCode(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = (binary % 1000000).toString().padStart(6, "0");
  return otp;
}

/**
 * Verify 6-digit TOTP code with time-step tolerance window (default +- 1 step = 30s)
 */
export function verifyTotpCode(
  secretBase32: string,
  token: string,
  window = 1,
  currentTimeMs = Date.now()
): boolean {
  if (!token || typeof token !== "string") return false;
  const cleanToken = token.trim().replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(cleanToken)) return false;

  const timeStep = 30;
  const currentStep = Math.floor(currentTimeMs / 1000 / timeStep);

  for (let i = -window; i <= window; i++) {
    const step = currentStep + i;
    const expected = calculateTotpCode(secretBase32, step);
    if (timingSafeEqual(Buffer.from(cleanToken), Buffer.from(expected))) {
      return true;
    }
  }

  return false;
}

/**
 * Encrypt TOTP secret at rest using AES-256-GCM
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt encrypted TOTP secret at rest
 */
export function decryptSecret(encryptedPayload: string): string {
  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const [ivHex, tagHex, dataHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(dataHex, "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString("utf8");
}

export interface RecoveryCodeSet {
  plaincodes: string[];
  hashes: string[];
}

/**
 * Generate 8 readable recovery codes (e.g. 4D9B-8F12)
 * Returns plaincodes for one-time user download and sha256 hashes for database storage
 */
export function generateRecoveryCodes(count = 8): RecoveryCodeSet {
  const plaincodes: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < count; i++) {
    const raw = randomBytes(4).toString("hex").toUpperCase();
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plaincodes.push(formatted);
    hashes.push(createHash("sha256").update(formatted).digest("hex"));
  }

  return { plaincodes, hashes };
}

/**
 * Check and burn recovery code from stored list of hashes
 */
export function verifyAndBurnRecoveryCode(
  enteredCode: string,
  storedHashes: string[]
): { valid: boolean; remainingHashes: string[] } {
  const clean = enteredCode.trim().toUpperCase().replace(/[\s]/g, "");
  const hash = createHash("sha256").update(clean).digest("hex");

  const index = storedHashes.findIndex((h) => h === hash);
  if (index === -1) {
    return { valid: false, remainingHashes: storedHashes };
  }

  const remainingHashes = storedHashes.filter((_, idx) => idx !== index);
  return { valid: true, remainingHashes };
}
