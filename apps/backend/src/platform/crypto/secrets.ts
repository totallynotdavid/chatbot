/**
 * Access tokens and webhook verify tokens never touch a plaintext column.
 * `channel_secrets` stores AES-256-GCM ciphertext and the channel account keeps
 * only a reference to the row.
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
  // The key is read on each call, not at import. A deployment that never stores
  // a credential (dev, tests using the notifier adapter) needs no SECRETS_KEY.
  const raw = process.env.SECRETS_KEY;
  if (!raw) {
    throw new Error(
      "SECRETS_KEY is not set; channel credentials cannot be encrypted or read",
    );
  }
  return parseKey(raw);
}

/**
 * Whether a usable key is configured. Callers check it before storing a
 * credential, so they can skip or refuse the write instead of throwing.
 */
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
 * value encrypted under a retired key is reported as that instead of as a
 * generic authentication failure.
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
