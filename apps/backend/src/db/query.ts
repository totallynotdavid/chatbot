import { db } from "./connection.ts";
import type { Database, SQLQueryBindings } from "bun:sqlite";

/**
 * `getOne` / `getAll` bound to one connection. Code that is handed a database -
 * the seeds and the migration, which in tests run against a temporary file -
 * binds its own; everything else uses the process-wide pair below.
 */
export function queriesOn(database: Database) {
  return {
    getOne: <T>(sql: string, params: SQLQueryBindings[] = []): T | undefined =>
      database.prepare(sql).get(...params) as T | undefined,

    getAll: <T>(sql: string, params: SQLQueryBindings[] = []): T[] =>
      database.prepare(sql).all(...params) as T[],
  };
}

const appQueries = queriesOn(db);

export const getOne = appQueries.getOne;
export const getAll = appQueries.getAll;

/**
 * The set a cross-tenant read is allowed to span.
 *
 * Suspension closes a business to everyone, platform operators included. An
 * operator's session drops its pin when the tenant it names is suspended
 * (platform/auth/session.ts), which for an ordinary member is a lockout - but
 * for an operator, no pin *is* the cross-tenant view, so dropping the pin would
 * hand back exactly the access it was meant to remove. The exclusion therefore
 * lives in the read itself.
 */
const OPEN_TENANTS = "(SELECT id FROM tenants WHERE status = 'active')";

/**
 * The tenant predicate for a read whose scope may be one tenant or all of them.
 *
 * A concrete `tenantId` is the ordinary case: one tenant, one bind parameter.
 * Null is the cross-tenant read only a platform operator can reach, and it
 * means "every tenant still open", never every row.
 *
 * The null branch binds nothing, so callers keep the parameter list they
 * already build: `tenantId ? [other, tenantId] : [other]`.
 */
export function tenantPredicate(
  tenantId: string | null,
  column = "tenant_id",
): string {
  return tenantId ? `${column} = ?` : openTenantsOnly(column);
}

/**
 * The same restriction for a query that has no tenant parameter at all: the
 * background workers, which sweep every tenant's queue by design. "Every
 * tenant" has to mean every tenant still open there too - a message queued
 * before suspension must not be answered after it, and a conversation in a
 * closed business must not go on being reassigned.
 */
export function openTenantsOnly(column = "tenant_id"): string {
  return `${column} IN ${OPEN_TENANTS}`;
}

/**
 * The channel accounts a background worker may send on.
 *
 * A tenant being open is not enough: the reply goes out on one of its numbers,
 * and a number that is `pending` or `disabled` cannot send at all - the webhook
 * already refuses inbound for one (routes/webhook.ts) and every adapter refuses
 * outbound. A message queued a minute before its number was switched off is
 * still sitting on the queue, though, and answering it means handing the send
 * to an account that will drop it on the floor while the worker marks the row
 * done. Restricting the dequeue leaves those rows where they are, so
 * re-enabling the number resumes them - the same promise `openTenantsOnly`
 * makes about a suspended business.
 */
export function activeChannelAccountsOnly(
  column = "channel_account_id",
): string {
  return `${column} IN (SELECT id FROM channel_accounts WHERE status = 'active')`;
}

/**
 * The same, for the two tables whose `tenant_id` is nullable - `audit_log` and
 * `notification_traces`. A null there is a platform-level row belonging to no
 * tenant, not a suspended business's data, so a cross-tenant read keeps it.
 */
export function tenantOrPlatformPredicate(
  tenantId: string | null,
  column = "tenant_id",
): string {
  return tenantId
    ? `${column} = ?`
    : `(${column} IS NULL OR ${column} IN ${OPEN_TENANTS})`;
}

/** Convert Unix timestamp (ms) to ISO string */
export function toISOString(timestamp: number | null): string | null {
  return timestamp ? new Date(timestamp).toISOString() : null;
}
