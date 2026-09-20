import type { Database } from "bun:sqlite";
import bcrypt from "bcryptjs";
import { MIN_PASSWORD_LENGTH } from "@totem/types";
import { queriesOn } from "../../db/query.ts";
import { auditOn, type CliOperator } from "../../platform/audit/logger.ts";
import { Err, Ok, type Result } from "../../shared/result/index.ts";
import { membershipsOn, tenantsOn } from "../tenants/index.ts";

export { MIN_PASSWORD_LENGTH };

export type AccountErrorReason =
  | "invalid_username"
  | "password_too_short"
  | "username_taken"
  | "conflicting_scope"
  | "no_tenant"
  | "tenant_required"
  | "unknown_tenant"
  | "not_found"
  | "inactive";

export class AccountError extends Error {
  constructor(
    public readonly reason: AccountErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

export type NewAccount = {
  username: string;
  name?: string;
  platformOperator?: boolean;
  tenantId?: string;
};

export type CreatedAccount = {
  id: string;
  username: string;
  name: string;
  isPlatformOperator: boolean;
  tenant: { id: string; slug: string } | null;
};

export type PromotedAccount = {
  id: string;
  username: string;
  changed: boolean;
};

type UserRow = {
  id: string;
  username: string;
  name: string;
  is_platform_operator: number;
  is_active: number;
};

const USER_COLUMNS =
  "id, username, name, is_platform_operator, COALESCE(is_active, 1) AS is_active";

/**
 * Account creation and promotion bound to one connection. Only the operator
 * command calls `create` and `promote`: not boot, the seeds or the migration.
 * Each change writes its audit row in the same transaction, naming the
 * operator who ran the command. Promoting an existing operator writes no row.
 */
export function accountsOn(database: Database) {
  const { getOne } = queriesOn(database);
  const tenants = tenantsOn(database);
  const audit = auditOn(database);

  function listTenants(): string {
    return tenants
      .getAll()
      .map((tenant) => `${tenant.id} (${tenant.slug})`)
      .join(", ");
  }

  /** The tenant id a new account joins, or null for a platform operator. */
  function resolveTenant(
    input: NewAccount,
  ): Result<string | null, AccountError> {
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
      return tenants.getById(input.tenantId)
        ? Ok(input.tenantId)
        : Err(
            new AccountError(
              "unknown_tenant",
              `No tenant has that id. Tenants: ${listTenants() || "none"}.`,
            ),
          );
    }

    const all = tenants.getAll();

    if (all.length === 0) {
      return Err(
        new AccountError(
          "no_tenant",
          "This database has no tenant to add the account to. Run `bun run seed` to create one, or create a platform operator.",
        ),
      );
    }

    if (all.length > 1) {
      return Err(
        new AccountError(
          "tenant_required",
          `This database has ${all.length} tenants, so one must be named. Tenants: ${listTenants()}.`,
        ),
      );
    }

    return Ok(all[0]!.id);
  }

  /** Everything `create` refuses except the password, so a caller can ask first. */
  function checkNew(input: NewAccount): Result<string | null, AccountError> {
    if (input.username === "" || input.username !== input.username.trim()) {
      return Err(
        new AccountError(
          "invalid_username",
          "The username must not be empty or start or end with whitespace.",
        ),
      );
    }

    const tenantId = resolveTenant(input);
    if (!tenantId.ok) return tenantId;

    const taken = getOne<{ id: string }>(
      "SELECT id FROM users WHERE username = ?",
      [input.username],
    );

    return taken
      ? Err(new AccountError("username_taken", "That username is taken."))
      : tenantId;
  }

  return {
    checkNew,

    /** A disabled operator does not count: nobody can use their powers. */
    hasPlatformOperator: (): boolean =>
      Boolean(
        getOne(
          `SELECT 1 FROM users
           WHERE is_platform_operator = 1 AND COALESCE(is_active, 1) = 1
           LIMIT 1`,
        ),
      ),

    /** A platform operator gets no membership. Anyone else administers one tenant. */
    create: (
      input: NewAccount & { password: string },
      operator: CliOperator,
    ): Result<CreatedAccount, AccountError> => {
      if (input.password.length < MIN_PASSWORD_LENGTH) {
        return Err(
          new AccountError(
            "password_too_short",
            `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
          ),
        );
      }

      const passwordHash = bcrypt.hashSync(input.password, 10);

      return database
        .transaction((): Result<CreatedAccount, AccountError> => {
          const tenantId = checkNew(input);
          if (!tenantId.ok) return tenantId;

          const id = crypto.randomUUID();

          database
            .prepare(
              `INSERT INTO users (id, username, password_hash, role, name, is_platform_operator, created_by)
             VALUES (?, ?, ?, 'admin', ?, ?, NULL)`,
            )
            .run(
              id,
              input.username,
              passwordHash,
              input.name?.trim() || input.username,
              tenantId.value === null ? 1 : 0,
            );

          if (tenantId.value !== null) {
            membershipsOn(database).upsert({
              tenantId: tenantId.value,
              userId: id,
              role: "admin",
              createdBy: null,
            });
          }

          const created = getOne<UserRow>(
            `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
            [id],
          )!;

          audit.logCliAction(
            operator,
            tenantId.value,
            "create_user",
            "user",
            id,
            {
              username: created.username,
              ...(tenantId.value !== null && { role: "admin" }),
              platformOperator: created.is_platform_operator === 1,
            },
          );

          return Ok({
            id: created.id,
            username: created.username,
            name: created.name,
            isPlatformOperator: created.is_platform_operator === 1,
            tenant:
              tenantId.value === null
                ? null
                : {
                    id: tenantId.value,
                    slug: tenants.getById(tenantId.value)!.slug,
                  },
          });
        })
        .immediate();
    },

    /** Memberships are kept. The cross-tenant powers are added to them. */
    promote: (
      username: string,
      operator: CliOperator,
    ): Result<PromotedAccount, AccountError> =>
      database
        .transaction((): Result<PromotedAccount, AccountError> => {
          const account = getOne<UserRow>(
            `SELECT ${USER_COLUMNS} FROM users WHERE username = ?`,
            [username],
          );

          if (!account) {
            return Err(
              new AccountError("not_found", "No account has that username."),
            );
          }

          if (account.is_active !== 1) {
            return Err(
              new AccountError(
                "inactive",
                "That account is disabled, and a disabled account cannot use the platform operator's powers.",
              ),
            );
          }

          const { changes } = database
            .prepare(
              "UPDATE users SET is_platform_operator = 1 WHERE id = ? AND is_platform_operator = 0",
            )
            .run(account.id);

          if (changes > 0) {
            audit.logCliAction(
              operator,
              null,
              "promote_platform_operator",
              "user",
              account.id,
              { username: account.username, platformOperator: true },
            );
          }

          return Ok({
            id: account.id,
            username: account.username,
            changed: changes > 0,
          });
        })
        .immediate(),
  };
}
