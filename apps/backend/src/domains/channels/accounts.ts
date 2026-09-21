/**
 * Channel accounts: one row per business phone number a tenant messages from.
 * Inbound routing resolves Meta's `metadata.phone_number_id` to an account here.
 * Outbound sends read that account's stored credentials, not WHATSAPP_TOKEN.
 */

import type { Database } from "bun:sqlite";
import process from "node:process";
import { db } from "../../db/index.ts";
import { queriesOn } from "../../db/query.ts";
import { createLogger } from "../../lib/logger.ts";
import {
  decryptSecret,
  encryptSecret,
  type EncryptedValue,
} from "../../platform/crypto/secrets.ts";
import type { ChannelAccount, ChannelType } from "@vendeya/types";

const logger = createLogger("channel-accounts");

type SecretRow = {
  id: string;
  tenant_id: string;
  purpose: "access_token" | "verify_token";
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_id: string;
};

/**
 * Binds the channel-account queries to `database`. The seeds and the migration
 * pass their own connection. Everything else uses `ChannelAccountService`.
 */
export function channelAccountsOn(database: Database) {
  const { getAll, getOne } = queriesOn(database);

  function storeSecret(
    tenantId: string,
    purpose: SecretRow["purpose"],
    plaintext: string,
  ): string {
    const encrypted: EncryptedValue = encryptSecret(plaintext);
    const id = crypto.randomUUID();

    database
      .prepare(
        `INSERT INTO channel_secrets (id, tenant_id, purpose, ciphertext, iv, auth_tag, key_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        tenantId,
        purpose,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        encrypted.keyId,
      );

    return id;
  }

  function replaceSecret(
    secretId: string,
    tenantId: string,
    purpose: SecretRow["purpose"],
    plaintext: string,
  ): void {
    const encrypted = encryptSecret(plaintext);
    database
      .prepare(
        `UPDATE channel_secrets
         SET ciphertext = ?, iv = ?, auth_tag = ?, key_id = ?, purpose = ?, tenant_id = ?,
             updated_at = unixepoch('now', 'subsec') * 1000
         WHERE id = ?`,
      )
      .run(
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        encrypted.keyId,
        purpose,
        tenantId,
        secretId,
      );
  }

  /** Decrypt a stored secret, or null if it is missing or unreadable. */
  function readSecret(secretId: string | null): string | null {
    if (!secretId) return null;

    const row = getOne<SecretRow>(
      "SELECT * FROM channel_secrets WHERE id = ?",
      [secretId],
    );
    if (!row) return null;

    try {
      return decryptSecret({
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
        keyId: row.key_id,
      });
    } catch (error) {
      logger.error({ error, secretId }, "Failed to decrypt channel secret");
      return null;
    }
  }

  const service = {
    getById: (id: string): ChannelAccount | null =>
      getOne<ChannelAccount>("SELECT * FROM channel_accounts WHERE id = ?", [
        id,
      ]) ?? null,

    listForTenant: (tenantId: string): ChannelAccount[] =>
      getAll<ChannelAccount>(
        "SELECT * FROM channel_accounts WHERE tenant_id = ? ORDER BY created_at",
        [tenantId],
      ),

    /**
     * An account resolves whatever its status. The webhook logs and rejects
     * messages for an inactive one deliberately instead of treating the number
     * as unknown.
     */
    getByPhoneNumberId: (
      phoneNumberId: string,
      channelType: ChannelType = "whatsapp",
    ): ChannelAccount | null =>
      getOne<ChannelAccount>(
        "SELECT * FROM channel_accounts WHERE channel_type = ? AND phone_number_id = ?",
        [channelType, phoneNumberId],
      ) ?? null,

    /**
     * The account a tenant sends from when the caller names none. Active
     * accounts come first, then pending, then disabled, oldest first in each.
     */
    getDefaultForTenant: (tenantId: string): ChannelAccount | null =>
      getOne<ChannelAccount>(
        `SELECT * FROM channel_accounts
         WHERE tenant_id = ?
         ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, created_at
         LIMIT 1`,
        [tenantId],
      ) ?? null,

    /**
     * The account VendeYa's own operations alerts go out on. These alerts belong
     * to the platform, so the account comes from a platform setting or the
     * environment, not from `getDefaultForTenant`.
     */
    getPlatformOps: (): ChannelAccount | null => {
      // The setting is writable only by a platform operator and wins over the
      // environment.
      const designated =
        getOne<{ value: string }>(
          "SELECT value FROM system_settings WHERE key = 'platform_ops_channel_account_id'",
        )?.value ?? null;

      if (designated) {
        const account = service.getById(designated);
        if (account) return account;

        logger.error(
          { channelAccountId: designated },
          "platform_ops_channel_account_id names an account that does not exist",
        );
      }

      // WHATSAPP_PHONE_ID is the last fallback, so a deployment that already
      // alerts on that number needs no new configuration.
      for (const phoneNumberId of [
        process.env.PLATFORM_OPS_PHONE_NUMBER_ID,
        process.env.WHATSAPP_PHONE_ID,
      ]) {
        if (!phoneNumberId) continue;
        const account = service.getByPhoneNumberId(phoneNumberId);
        if (account) return account;
      }

      return null;
    },

    create: (data: {
      tenantId: string;
      phoneNumberId: string;
      wabaId?: string | null;
      displayPhoneNumber?: string | null;
      label?: string | null;
      accessToken?: string | null;
      verifyToken?: string | null;
      status?: ChannelAccount["status"];
      channelType?: ChannelType;
      id?: string;
    }): ChannelAccount => {
      const id = data.id ?? crypto.randomUUID();

      const accessTokenSecretId = data.accessToken
        ? storeSecret(data.tenantId, "access_token", data.accessToken)
        : null;
      const verifyTokenSecretId = data.verifyToken
        ? storeSecret(data.tenantId, "verify_token", data.verifyToken)
        : null;

      database
        .prepare(
          `INSERT INTO channel_accounts (
             id, tenant_id, channel_type, waba_id, phone_number_id, display_phone_number,
             label, access_token_secret_id, verify_token_secret_id, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          data.tenantId,
          data.channelType ?? "whatsapp",
          data.wabaId ?? null,
          data.phoneNumberId,
          data.displayPhoneNumber ?? null,
          data.label ?? null,
          accessTokenSecretId,
          verifyTokenSecretId,
          data.status ?? (data.accessToken ? "active" : "pending"),
        );

      return service.getById(id)!;
    },

    setAccessToken: (accountId: string, token: string): void => {
      const account = service.getById(accountId);
      if (!account) throw new Error(`Channel account not found: ${accountId}`);

      if (account.access_token_secret_id) {
        replaceSecret(
          account.access_token_secret_id,
          account.tenant_id,
          "access_token",
          token,
        );
      } else {
        const secretId = storeSecret(account.tenant_id, "access_token", token);
        database
          .prepare(
            `UPDATE channel_accounts
             SET access_token_secret_id = ?, updated_at = unixepoch('now', 'subsec') * 1000
             WHERE id = ?`,
          )
          .run(secretId, accountId);
      }

      // A pending number is waiting for its token, so storing one activates it.
      // A disabled account stays disabled because disabling is a deliberate
      // decision, not a missing credential.
      if (account.status === "pending")
        service.updateStatus(accountId, "active");
    },

    setVerifyToken: (accountId: string, token: string): void => {
      const account = service.getById(accountId);
      if (!account) throw new Error(`Channel account not found: ${accountId}`);

      if (account.verify_token_secret_id) {
        replaceSecret(
          account.verify_token_secret_id,
          account.tenant_id,
          "verify_token",
          token,
        );
      } else {
        const secretId = storeSecret(account.tenant_id, "verify_token", token);
        database
          .prepare(
            `UPDATE channel_accounts
             SET verify_token_secret_id = ?, updated_at = unixepoch('now', 'subsec') * 1000
             WHERE id = ?`,
          )
          .run(secretId, accountId);
      }
    },

    updateStatus: (
      accountId: string,
      status: ChannelAccount["status"],
    ): void => {
      database
        .prepare(
          `UPDATE channel_accounts
           SET status = ?, updated_at = unixepoch('now', 'subsec') * 1000
           WHERE id = ?`,
        )
        .run(status, accountId);
    },

    /** Plaintext access token for outbound sends. Never persisted or logged. */
    getAccessToken: (account: ChannelAccount): string | null =>
      readSecret(account.access_token_secret_id),

    getVerifyToken: (account: ChannelAccount): string | null =>
      readSecret(account.verify_token_secret_id),

    /**
     * Meta's GET verification handshake carries no phone-number id. The caller
     * matches the token against every account listed here.
     */
    listWithVerifyToken: (): ChannelAccount[] =>
      getAll<ChannelAccount>(
        "SELECT * FROM channel_accounts WHERE verify_token_secret_id IS NOT NULL",
      ),
  };

  return service;
}

export const ChannelAccountService = channelAccountsOn(db);
