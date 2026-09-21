import type { Database } from "bun:sqlite";
import process from "node:process";
import { channelAccountsOn } from "../../domains/channels/accounts.ts";
import { tenantsOn } from "../../domains/tenants/index.ts";
import { isEncryptionAvailable } from "../../platform/crypto/secrets.ts";
import { createLogger } from "../../lib/logger.ts";
import type { ChannelAccount, Tenant } from "@vendeya/types";

const logger = createLogger("seed-tenants");

/**
 * The default tenant is Totem, the business this codebase was built for. Its
 * channel account is seeded from the WHATSAPP_* environment variables.
 */
export const DEFAULT_TENANT_SLUG = "totem";
export const DEFAULT_TENANT_NAME = "Totem";

/** `phone_number_id` is unique across tenants, so a placeholder names its tenant. */
export function unconfiguredPhoneNumberId(tenantId: string): string {
  return `unconfigured:${tenantId}`;
}

export function ensureDefaultTenant(db: Database): Tenant {
  const tenants = tenantsOn(db);

  return (
    tenants.getBySlug(DEFAULT_TENANT_SLUG) ??
    tenants.create({
      slug: DEFAULT_TENANT_SLUG,
      name: DEFAULT_TENANT_NAME,
    })
  );
}

/**
 * Creates the channel account for a tenant from the WHATSAPP_* environment
 * variables, or imports the credentials that an existing one is missing. A
 * fresh seed and the migration both come through here, and nothing else
 * imports those credentials.
 */
export function ensureChannelAccountFromEnv(
  db: Database,
  tenantId: string,
): ChannelAccount {
  const channelAccounts = channelAccountsOn(db);
  const phoneNumberId = seededPhoneNumberId(channelAccounts, tenantId);

  // The WHATSAPP_* credentials belong to the configured number, so they are
  // only imported onto that number and never onto a placeholder.
  const usesConfiguredNumber = phoneNumberId === process.env.WHATSAPP_PHONE_ID;
  const accessToken = usesConfiguredNumber
    ? process.env.WHATSAPP_TOKEN || null
    : null;
  const verifyToken = usesConfiguredNumber
    ? process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || null
    : null;
  const canEncrypt = isEncryptionAvailable();

  const existing = channelAccounts.getByPhoneNumberId(phoneNumberId);

  if (existing) {
    if (existing.tenant_id !== tenantId) {
      throw new Error(
        `Channel account ${existing.id} holds phone-number id ${phoneNumberId}, ` +
          `which is reserved for tenant ${tenantId}'s placeholder number`,
      );
    }

    // Seeding a number that already exists imports only the credentials it is
    // missing. Setting SECRETS_KEY and re-running the seed therefore turns a
    // pending account into one that can send.
    const needsAccessToken =
      accessToken !== null && existing.access_token_secret_id === null;
    const needsVerifyToken =
      verifyToken !== null && existing.verify_token_secret_id === null;

    // The environment variables are the initial import, not the source of
    // truth. A token rotated through PATCH /api/admin/channels/:id must
    // survive the next seed.
    if (!needsAccessToken && !needsVerifyToken) return existing;

    if (!canEncrypt) {
      warnAboutMissingKey();
      return existing;
    }

    const imported: string[] = [];

    if (accessToken && needsAccessToken) {
      channelAccounts.setAccessToken(existing.id, accessToken);
      imported.push("access_token");
    }
    if (verifyToken && needsVerifyToken) {
      channelAccounts.setVerifyToken(existing.id, verifyToken);
      imported.push("verify_token");
    }

    const updated = channelAccounts.getById(existing.id) ?? existing;

    logger.info(
      {
        channelAccountId: updated.id,
        tenantId,
        phoneNumberId,
        status: updated.status,
        imported,
      },
      "Imported channel account credentials",
    );

    return updated;
  }

  if ((accessToken || verifyToken) && !canEncrypt) {
    warnAboutMissingKey();
  }

  // Tokens are stored encrypted. Without a key the account is created without
  // them and left 'pending', which is the right state for a number that cannot
  // send yet.
  const storeCredentials = canEncrypt;

  const account = channelAccounts.create({
    tenantId,
    phoneNumberId,
    label: DEFAULT_TENANT_NAME,
    accessToken: storeCredentials ? accessToken : null,
    verifyToken: storeCredentials ? verifyToken : null,
    status: storeCredentials && accessToken ? "active" : "pending",
  });

  logger.info(
    {
      channelAccountId: account.id,
      tenantId,
      phoneNumberId,
      status: account.status,
    },
    "Seeded channel account",
  );

  return account;
}

/**
 * WHATSAPP_PHONE_ID when it is set and free for this tenant, otherwise this
 * tenant's placeholder.
 */
function seededPhoneNumberId(
  channelAccounts: ReturnType<typeof channelAccountsOn>,
  tenantId: string,
): string {
  const configured = process.env.WHATSAPP_PHONE_ID;
  if (!configured) return unconfiguredPhoneNumberId(tenantId);

  // A configured number registered to another tenant belongs to that tenant.
  // Handing it out would put this tenant's rows on another business's number.
  const owner = channelAccounts.getByPhoneNumberId(configured);
  if (!owner || owner.tenant_id === tenantId) return configured;

  logger.error(
    { phoneNumberId: configured, tenantId, ownerTenantId: owner.tenant_id },
    "WHATSAPP_PHONE_ID is registered to another tenant; seeding this tenant " +
      "a pending placeholder number instead",
  );
  return unconfiguredPhoneNumberId(tenantId);
}

function warnAboutMissingKey(): void {
  logger.warn(
    "SECRETS_KEY is not set: seeding the channel account without credentials. " +
      "Set SECRETS_KEY and re-run the seed, or add the token via " +
      "PATCH /api/admin/channels/:id, before sending on this number.",
  );
}

/** The default tenant and its one channel account, created if absent. */
export function seedTenants(db: Database): {
  tenant: Tenant;
  channelAccount: ChannelAccount;
} {
  const tenant = ensureDefaultTenant(db);
  const channelAccount = ensureChannelAccountFromEnv(db, tenant.id);

  return { tenant, channelAccount };
}
