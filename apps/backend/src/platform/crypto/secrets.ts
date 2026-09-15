/**
 * Envelope encryption for channel credentials.
 *
 * Access tokens and webhook verify tokens never touch a plaintext column: the
 * `channel_secrets` table stores AES-256-GCM ciphertext and the channel account
 * keeps only a reference to the row.
 *
 * The key comes from SECRETS_KEY (32 bytes, hex or base64). It is read lazily so
 * that a deployment which never stores a credential (dev, tests using the
 * notifier adapter) does not have to configure one.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import process from "node:process";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export type EncryptedValue = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
};

function parseKey(raw: string): Buffer {
  const hex = /^[0-9a-fA-F]{64}$/;
  if (hex.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) {
    return decoded;
  }

  throw new Error(
    "SECRETS_KEY must be 32 bytes encoded as hex (64 chars) or base64",
  );
}

function readKey(): Buffer {
  const raw = process.env.SECRETS_KEY;
  if (!raw) {
    throw new Error(
      "SECRETS_KEY is not set; channel credentials cannot be encrypted or read",
    );
  }
  return parseKey(raw);
}

/** Whether a usable key is configured. Callers use this to degrade politely. */
export function isEncryptionAvailable(): boolean {
  try {
    readKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Short fingerprint of the key in use, stored alongside the ciphertext so a
 * value encrypted under a retired key can be recognised instead of silently
 * failing to decrypt.
 */
function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function encryptSecret(plaintext: string): EncryptedValue {
  const key = readKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyId: keyId(key),
  };
}

export function decryptSecret(value: EncryptedValue): string {
  const key = readKey();

  if (value.keyId !== keyId(key)) {
    throw new Error(
      "Stored secret was encrypted with a different SECRETS_KEY than the one configured",
    );
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
