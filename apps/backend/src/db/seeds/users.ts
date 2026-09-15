import type { Database } from "bun:sqlite";
import process from "node:process";
import bcrypt from "bcryptjs";
import { membershipsOn } from "../../domains/tenants/index.ts";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("seed-users");

/**
 * Bootstrap account.
 *
 * This seed deliberately ships no credentials. It creates an account only when
 * BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD are both set in the
 * environment, and it never invents a password: a database seeded without them
 * simply has no users, and the operator creates the first one by setting those
 * variables once and running `bun run seed`.
 *
 * Set BOOTSTRAP_ADMIN_PLATFORM_OPERATOR=true to make that first account
 * VendeYa staff (able to act across tenants) instead of an admin of the default
 * tenant. That flag is also the way a deployment that has users but no platform
 * operator gains one - a database migrated from the single-business schema by a
 * build that predates the promotion in `migrations.ts` - because the guard
 * below asks whether the account being requested is missing, not whether the
 * table is empty.
 */
const MIN_PASSWORD_LENGTH = 12;

function count(db: Database, sql: string): number {
  return (db.prepare(sql).get() as { count: number }).count;
}

/**
 * Whether the account this seed would create is already there.
 *
 * "Any user exists" is the right question only for the ordinary bootstrap: the
 * first account of a fresh database, which is a tenant admin. It is the wrong
 * question when BOOTSTRAP_ADMIN_PLATFORM_OPERATOR=true, and wrong in the one
 * situation that matters most - a database that has just been migrated from the
 * single-business schema is full of users and has no platform operator among
 * them, so the guard refused to create the account that was actually missing
 * and the deployment had no way to onboard a second tenant.
 *
 * The invariant is therefore the one the flag asks for: a platform operator
 * when it is set, any account at all when it is not.
 */
function alreadySatisfied(db: Database, wantsPlatformOperator: boolean) {
  return wantsPlatformOperator
    ? count(
        db,
        "SELECT count(*) as count FROM users WHERE is_platform_operator = 1",
      ) > 0
    : count(db, "SELECT count(*) as count FROM users") > 0;
}

export async function seedUsers(db: Database, tenantId: string) {
  const isPlatformOperator =
    process.env.BOOTSTRAP_ADMIN_PLATFORM_OPERATOR === "true";

  if (alreadySatisfied(db, isPlatformOperator)) {
    return;
  }

  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!username || !password) {
    logger.warn(
      `No ${isPlatformOperator ? "platform operator" : "user"} exists and ` +
        "BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD are not set, so " +
        "no account was created. Set both and run `bun run seed` to create it.",
    );
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `BOOTSTRAP_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  // Reachable now that the guard above is about platform operators rather than
  // about the table being empty: a migrated database may well already hold the
  // username being asked for. `username` is UNIQUE, so inserting would take the
  // boot down with a constraint failure instead of saying what is wrong.
  const taken = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(username);

  if (taken) {
    logger.warn(
      { username },
      "BOOTSTRAP_ADMIN_USERNAME is already taken by an existing account, so " +
        "no account was created. Choose a username that is free.",
    );
    return;
  }

  const id = crypto.randomUUID();
  const name = process.env.BOOTSTRAP_ADMIN_NAME || username;

  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, name, is_platform_operator, created_by)
     VALUES (?, ?, ?, 'admin', ?, ?, NULL)`,
  ).run(
    id,
    username,
    bcrypt.hashSync(password, 10),
    name,
    isPlatformOperator ? 1 : 0,
  );

  if (!isPlatformOperator) {
    // Tenant-side accounts need a membership; platform operators have none by
    // design and select a tenant when they need one.
    membershipsOn(db).upsert({
      tenantId,
      userId: id,
      role: "admin",
      createdBy: null,
    });
  }

  logger.info(
    { username, isPlatformOperator },
    "Created bootstrap account from environment",
  );
}
