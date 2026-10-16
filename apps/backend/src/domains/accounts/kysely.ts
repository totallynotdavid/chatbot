import bcrypt from "bcryptjs";
import { MIN_PASSWORD_LENGTH } from "@vendeya/types";
import type { Db } from "../../db/client.ts";
import type { CliOperator } from "../../platform/audit/logger.ts";
import { Err, Ok, type Result } from "../../shared/result/index.ts";
import {
  AccountError,
  type CreatedAccount,
  type NewAccount,
  type PromotedAccount,
} from "./errors.ts";

const UNIQUE_VIOLATION = "23505";

/**
 * Account creation and promotion on a Postgres connection. Only the operator
 * command calls `create` and `promote`: not boot, the seeds or the migration.
 * Each change writes its audit row in the same transaction, naming the
 * operator who ran the command. Promoting an existing operator writes no row.
 */
export function accountsIn(db: Db) {
  async function listTenants(executor: Db): Promise<string> {
    const tenants = await executor
      .selectFrom("tenants")
      .select(["id", "slug"])
      .orderBy("name")
      .execute();

    return tenants.map((tenant) => `${tenant.id} (${tenant.slug})`).join(", ");
  }

  /** The tenant id a new account joins, or null for a platform operator. */
  async function resolveTenant(
    executor: Db,
    input: NewAccount,
  ): Promise<Result<string | null, AccountError>> {
    if (input.platformOperator) {
      return input.tenantId === undefined
        ? Ok(null)
        : Err(
            new AccountError(
              "conflicting_scope",
              "A platform operator belongs to no tenant, so a tenant cannot be given as well.",
            ),
          );
    }

    if (input.tenantId !== undefined) {
      const tenant = await executor
        .selectFrom("tenants")
        .select("id")
        .where("id", "=", input.tenantId)
        .executeTakeFirst();

      return tenant
        ? Ok(tenant.id)
        : Err(
            new AccountError(
              "unknown_tenant",
              `No tenant has that id. Tenants: ${(await listTenants(executor)) || "none"}.`,
            ),
          );
    }

    const tenants = await executor.selectFrom("tenants").select("id").execute();

    if (tenants.length === 0) {
      return Err(
        new AccountError(
          "no_tenant",
          "This database has no tenant to add the account to. Run `bun run seed` to create one, or create a platform operator.",
        ),
      );
    }

    if (tenants.length > 1) {
      return Err(
        new AccountError(
          "tenant_required",
          `This database has ${tenants.length} tenants, so one must be named. Tenants: ${await listTenants(executor)}.`,
        ),
      );
    }

    return Ok(tenants[0]!.id);
  }

  /** Everything `create` refuses except the password, so a caller can ask first. */
  async function checkNew(
    executor: Db,
    input: NewAccount,
  ): Promise<Result<string | null, AccountError>> {
    if (input.username === "" || input.username !== input.username.trim()) {
      return Err(
        new AccountError(
          "invalid_username",
          "The username must not be empty or start or end with whitespace.",
        ),
      );
    }

    const tenantId = await resolveTenant(executor, input);
    if (!tenantId.ok) return tenantId;

    const taken = await executor
      .selectFrom("users")
      .select("id")
      .where("username", "=", input.username)
      .executeTakeFirst();

    return taken
      ? Err(new AccountError("username_taken", "That username is taken."))
      : tenantId;
  }

  return {
    checkNew: (input: NewAccount) => checkNew(db, input),

    /** A disabled operator does not count: nobody can use their powers. */
    hasPlatformOperator: async (): Promise<boolean> =>
      Boolean(
        await db
          .selectFrom("users")
          .select("id")
          .where("is_platform_operator", "=", true)
          .where("is_active", "=", true)
          .executeTakeFirst(),
      ),

    /** A platform operator gets no membership. Anyone else administers one tenant. */
    create: async (
      input: NewAccount & { password: string },
      operator: CliOperator,
    ): Promise<Result<CreatedAccount, AccountError>> => {
      if (input.password.length < MIN_PASSWORD_LENGTH) {
        return Err(
          new AccountError(
            "password_too_short",
            `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
          ),
        );
      }

      const passwordHash = await bcrypt.hash(input.password, 10);

      try {
        return await db.transaction().execute(async (trx) => {
          const checked = await checkNew(trx, input);
          if (!checked.ok) return checked;

          const tenantId = checked.value;
          const id = crypto.randomUUID();

          const user = await trx
            .insertInto("users")
            .values({
              id,
              username: input.username,
              password_hash: passwordHash,
              role: "admin",
              name: input.name?.trim() || input.username,
              is_platform_operator: tenantId === null,
              created_by: null,
            })
            .returning(["id", "username", "name", "is_platform_operator"])
            .executeTakeFirstOrThrow();

          let tenant: CreatedAccount["tenant"] = null;

          if (tenantId !== null) {
            await trx
              .insertInto("tenant_memberships")
              .values({
                id: crypto.randomUUID(),
                tenant_id: tenantId,
                user_id: id,
                role: "admin",
                created_by: null,
              })
              .execute();

            tenant = await trx
              .selectFrom("tenants")
              .select(["id", "slug"])
              .where("id", "=", tenantId)
              .executeTakeFirstOrThrow();
          }

          await trx
            .insertInto("audit_log")
            .values({
              id: crypto.randomUUID(),
              tenant_id: tenantId,
              user_id: null,
              actor: `cli:${operator.name}`,
              action: "create_user",
              resource_type: "user",
              resource_id: id,
              metadata: JSON.stringify({
                username: user.username,
                ...(tenantId !== null && { role: "admin" }),
                platformOperator: user.is_platform_operator,
                uid: operator.uid,
              }),
            })
            .execute();

          return Ok({
            id: user.id,
            username: user.username,
            name: user.name,
            isPlatformOperator: user.is_platform_operator,
            tenant,
          });
        });
      } catch (error) {
        // Two commands can both pass the check. The unique index decides.
        if (isUniqueViolation(error)) {
          return Err(
            new AccountError("username_taken", "That username is taken."),
          );
        }
        throw error;
      }
    },

    /** Memberships are kept. The cross-tenant powers are added to them. */
    promote: (
      username: string,
      operator: CliOperator,
    ): Promise<Result<PromotedAccount, AccountError>> =>
      db.transaction().execute(async (trx) => {
        const account = await trx
          .selectFrom("users")
          .select(["id", "username", "is_active"])
          .where("username", "=", username)
          .executeTakeFirst();

        if (!account) {
          return Err(
            new AccountError("not_found", "No account has that username."),
          );
        }

        if (!account.is_active) {
          return Err(
            new AccountError(
              "inactive",
              "That account is disabled, and a disabled account cannot use the platform operator's powers.",
            ),
          );
        }

        const changed = await trx
          .updateTable("users")
          .set({ is_platform_operator: true })
          .where("id", "=", account.id)
          .where("is_platform_operator", "=", false)
          .returning("id")
          .executeTakeFirst();

        if (changed) {
          await trx
            .insertInto("audit_log")
            .values({
              id: crypto.randomUUID(),
              tenant_id: null,
              user_id: null,
              actor: `cli:${operator.name}`,
              action: "promote_platform_operator",
              resource_type: "user",
              resource_id: account.id,
              metadata: JSON.stringify({
                username: account.username,
                platformOperator: true,
                uid: operator.uid,
              }),
            })
            .execute();
        }

        return Ok({
          id: account.id,
          username: account.username,
          changed: Boolean(changed),
        });
      }),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === UNIQUE_VIOLATION
  );
}
