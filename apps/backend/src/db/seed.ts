import process from "node:process";
import { periodId, tenantScopedId } from "../domains/catalog/ids.ts";
import { createLogger } from "../lib/logger.ts";
import {
  encryptSecret,
  isEncryptionAvailable,
} from "../platform/crypto/secrets.ts";
import type { BundleComposition, SnapshotProduct } from "@vendeya/types";
import { createDb, type Db } from "./client.ts";
import { BUNDLES_SEED } from "./seed-data/bundles.ts";
import { FNB_BUNDLES_SEED } from "./seed-data/fnb-bundles.ts";
import { BASE_PRODUCTS } from "./seed-data/products.ts";
import { seedCatalogImages } from "./seeds/images.ts";
import { getCurrentPeriod } from "./seeds/periods.ts";
import {
  DEFAULT_TENANT_NAME,
  DEFAULT_TENANT_SLUG,
  unconfiguredPhoneNumberId,
} from "./seeds/tenant-defaults.ts";
import { TEST_CONVERSATIONS, testContextData } from "./seeds/test-data.ts";

const logger = createLogger("seed");

const BUNDLE_NOTES =
  "01 año de garantía, delivery gratuito, cero cuota inicial";

type Purpose = "access_token" | "verify_token";

async function ensureDefaultTenant(db: Db) {
  await db
    .insertInto("tenants")
    .values({
      id: crypto.randomUUID(),
      slug: DEFAULT_TENANT_SLUG,
      name: DEFAULT_TENANT_NAME,
    })
    .onConflict((conflict) => conflict.column("slug").doNothing())
    .execute();

  return db
    .selectFrom("tenants")
    .selectAll()
    .where("slug", "=", DEFAULT_TENANT_SLUG)
    .executeTakeFirstOrThrow();
}

async function storeSecret(
  db: Db,
  tenantId: string,
  purpose: Purpose,
  plaintext: string,
): Promise<string> {
  const encrypted = encryptSecret(plaintext);
  const id = crypto.randomUUID();

  await db
    .insertInto("channel_secrets")
    .values({
      id,
      tenant_id: tenantId,
      purpose,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      key_id: encrypted.keyId,
    })
    .execute();

  return id;
}

/**
 * WHATSAPP_PHONE_ID when it is set and free for this tenant, otherwise this
 * tenant's placeholder.
 */
async function seededPhoneNumberId(db: Db, tenantId: string): Promise<string> {
  const configured = process.env.WHATSAPP_PHONE_ID;
  if (!configured) return unconfiguredPhoneNumberId(tenantId);

  // A configured number registered to another tenant belongs to that tenant.
  // Handing it out would put this tenant's rows on another business's number.
  const owner = await db
    .selectFrom("channel_accounts")
    .select("tenant_id")
    .where("channel_type", "=", "whatsapp")
    .where("phone_number_id", "=", configured)
    .executeTakeFirst();

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

/**
 * Creates the channel account for a tenant from the WHATSAPP_* environment
 * variables, or imports the credentials that an existing one is missing. The
 * variables are the initial import, not the source of truth: a token rotated
 * through PATCH /api/admin/channels/:id survives the next seed.
 */
async function ensureChannelAccountFromEnv(db: Db, tenantId: string) {
  const phoneNumberId = await seededPhoneNumberId(db, tenantId);

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

  const existing = await db
    .selectFrom("channel_accounts")
    .selectAll()
    .where("channel_type", "=", "whatsapp")
    .where("phone_number_id", "=", phoneNumberId)
    .executeTakeFirst();

  if (existing) {
    if (existing.tenant_id !== tenantId) {
      throw new Error(
        `Channel account ${existing.id} holds phone-number id ${phoneNumberId}, ` +
          `which is reserved for tenant ${tenantId}'s placeholder number`,
      );
    }

    const needsAccessToken =
      accessToken !== null && existing.access_token_secret_id === null;
    const needsVerifyToken =
      verifyToken !== null && existing.verify_token_secret_id === null;

    if (!needsAccessToken && !needsVerifyToken) return existing;

    if (!canEncrypt) {
      warnAboutMissingKey();
      return existing;
    }

    const imported: string[] = [];
    const update: {
      access_token_secret_id?: string;
      verify_token_secret_id?: string;
      status?: "active";
      updated_at?: number;
    } = {};

    if (accessToken && needsAccessToken) {
      update.access_token_secret_id = await storeSecret(
        db,
        tenantId,
        "access_token",
        accessToken,
      );
      // A pending number is waiting for its token, so storing one activates it.
      // A disabled account stays disabled because disabling is a deliberate
      // decision, not a missing credential.
      if (existing.status === "pending") update.status = "active";
      imported.push("access_token");
    }
    if (verifyToken && needsVerifyToken) {
      update.verify_token_secret_id = await storeSecret(
        db,
        tenantId,
        "verify_token",
        verifyToken,
      );
      imported.push("verify_token");
    }

    const updated = await db
      .updateTable("channel_accounts")
      .set({ ...update, updated_at: Date.now() })
      .where("id", "=", existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();

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
  const accessTokenId =
    storeCredentials && accessToken
      ? await storeSecret(db, tenantId, "access_token", accessToken)
      : null;
  const verifyTokenId =
    storeCredentials && verifyToken
      ? await storeSecret(db, tenantId, "verify_token", verifyToken)
      : null;

  const account = await db
    .insertInto("channel_accounts")
    .values({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      phone_number_id: phoneNumberId,
      label: DEFAULT_TENANT_NAME,
      access_token_secret_id: accessTokenId,
      verify_token_secret_id: verifyTokenId,
      status: accessTokenId ? "active" : "pending",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

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
 * Ensures the tenant has a period for the current month, because the catalog
 * seed inserts its bundles into that period. A tenant that already has a period
 * keeps its live catalog: the new month is a draft to publish, not a second
 * active period.
 */
async function seedPeriods(db: Db, tenantId: string) {
  const period = getCurrentPeriod(tenantId);

  const existing = await db
    .selectFrom("catalog_periods")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();

  await db
    .insertInto("catalog_periods")
    .values({
      id: period.id,
      tenant_id: tenantId,
      name: period.name,
      year_month: period.yearMonth,
      status: existing ? "draft" : "active",
    })
    .onConflict((conflict) =>
      conflict.columns(["tenant_id", "year_month"]).doNothing(),
    )
    .execute();
}

async function seedProducts(db: Db, tenantId: string) {
  const existing = await db
    .selectFrom("products")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();

  if (existing) return;

  await db
    .insertInto("products")
    .values(
      BASE_PRODUCTS.map((product) => ({
        // The base catalog's ids are shared by every tenant seeded from it, so
        // they are scoped to this one before they reach the global primary key.
        id: tenantScopedId(tenantId, product.id),
        tenant_id: tenantId,
        name: product.name,
        category: product.category,
        brand: product.brand,
        model: product.model,
        specs_json: JSON.stringify(product.specs),
      })),
    )
    .execute();
}

/**
 * A bundle's composition snapshots the products it is made of by id, and those
 * ids are scoped to the tenant when the product rows are seeded. The snapshots
 * have to name the same rows, or the catalog queries that join composition back
 * to `products` find nothing.
 */
function scopeComposition(
  tenantId: string,
  composition: BundleComposition,
): BundleComposition {
  const scope = (product: SnapshotProduct): SnapshotProduct => ({
    ...product,
    id: tenantScopedId(tenantId, product.id),
  });

  return {
    fixed: composition.fixed.map(scope),
    choices: composition.choices.map((choice) => ({
      ...choice,
      options: choice.options.map(scope),
    })),
  };
}

/**
 * The base catalog, as one tenant's starting point. It is bootstrap data, so a
 * tenant that already has bundles keeps them: re-seeding per period would push
 * the sample catalog into every new month on top of the tenant's real one.
 */
async function seedBundles(db: Db, tenantId: string) {
  const existing = await db
    .selectFrom("catalog_bundles")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();

  if (existing) return;

  const period = periodId(tenantId, getCurrentPeriod(tenantId).yearMonth);
  const seeds = [
    { segment: "gaso" as const, bundles: BUNDLES_SEED, prefix: "bundle" },
    { segment: "fnb" as const, bundles: FNB_BUNDLES_SEED, prefix: "fnb" },
  ];

  await db
    .insertInto("catalog_bundles")
    .values(
      seeds.flatMap(({ segment, bundles, prefix }) =>
        bundles.map((bundle) => ({
          id: tenantScopedId(tenantId, `${prefix}-${bundle.image_id}`),
          tenant_id: tenantId,
          period_id: period,
          segment,
          name: bundle.name,
          price: bundle.price,
          primary_category: bundle.primary_category,
          categories_json: JSON.stringify(bundle.categories),
          image_id: bundle.image_id,
          composition_json: JSON.stringify(
            scopeComposition(tenantId, bundle.composition),
          ),
          installments_json: JSON.stringify(bundle.installments),
          notes: BUNDLE_NOTES,
        })),
      ),
    )
    .execute();
}

async function seedTestData(
  db: Db,
  tenantId: string,
  channelAccountId: string,
) {
  const existing = await db
    .selectFrom("conversations")
    .select("phone_number")
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();

  if (existing) return;

  const now = Date.now();

  for (const conversation of TEST_CONVERSATIONS) {
    const lastActivityAt =
      now + conversation.messages[conversation.messages.length - 1]!.offsetMs;

    // The fixture names an agent by id. The seeds create no user accounts, so
    // link the agent only when that user exists.
    const agent = conversation.assignedAgent
      ? await db
          .selectFrom("users")
          .select("id")
          .where("id", "=", conversation.assignedAgent)
          .executeTakeFirst()
      : undefined;

    await db
      .insertInto("conversations")
      .values({
        tenant_id: tenantId,
        channel_account_id: channelAccountId,
        phone_number: conversation.phoneNumber,
        client_name: conversation.clientName,
        dni: conversation.dni,
        segment: conversation.segment,
        credit_line: conversation.creditLine,
        status: conversation.status,
        assigned_agent: agent?.id ?? null,
        assignment_notified_at: conversation.assignmentNotifiedAt
          ? now + conversation.assignmentNotifiedAt
          : null,
        last_activity_at: lastActivityAt,
        context_data: JSON.stringify(
          testContextData(conversation, now, lastActivityAt),
        ),
        sale_status: conversation.saleStatus ?? "pending",
      })
      .execute();

    await db
      .insertInto("messages")
      .values(
        conversation.messages.map((message) => ({
          id: `msg-${crypto.randomUUID()}`,
          tenant_id: tenantId,
          channel_account_id: channelAccountId,
          phone_number: conversation.phoneNumber,
          direction: message.role === "incoming" ? "inbound" : "outbound",
          type: "text",
          content: message.text,
          created_at: now + message.offsetMs,
        })),
      )
      .execute();
  }
}

/**
 * Seeds the default tenant, its catalog and, outside production, two sample
 * conversations. It leaves rows that exist alone, so running it again changes
 * nothing.
 */
export async function seedDatabase(db: Db) {
  await db.transaction().execute(async (trx) => {
    // Tenancy first: every other seed needs a tenant to belong to.
    const tenant = await ensureDefaultTenant(trx);
    const channelAccount = await ensureChannelAccountFromEnv(trx, tenant.id);

    await seedPeriods(trx, tenant.id);
    await seedProducts(trx, tenant.id);
    await seedBundles(trx, tenant.id);

    if (process.env.NODE_ENV !== "production") {
      await seedTestData(trx, tenant.id, channelAccount.id);
    }
  });

  // Not part of the transaction: it copies files. It runs unconditionally, not
  // only when bundles were just seeded, because a tenant seeded earlier still
  // names these images and the volume they are served from may be new.
  seedCatalogImages();
}

if (import.meta.main) {
  const db = createDb();

  try {
    await seedDatabase(db);
  } finally {
    // No process.exit(): the seed logs, and in production the logger writes to
    // an async file destination that an immediate exit would truncate. Closing
    // the pool lets the process end on its own once that flush completes.
    await db.destroy();
  }
}
