import { db } from "./connection.ts";
import type { Database, SQLQueryBindings } from "bun:sqlite";

/**
 * `getOne` / `getAll` bound to one connection. Code that is handed a database -
 * the seeds and the migration, which in tests run against a temporary file -
 * binds its own; everything else uses the process-wide pair below.
 */
export function queriesOn(database: Database) {
  return {
    /** A query that matches no row gives `undefined`, not bun:sqlite's `null`. */
    getOne: <T>(sql: string, params: SQLQueryBindings[] = []): T | undefined =>
      (database.prepare(sql).get(...params) ?? undefined) as T | undefined,

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

/** A date query parameter that is not a real calendar date or timestamp; answered as 400. */
export class InvalidDateError extends Error {
  constructor(
    readonly field: string,
    expected: string,
  ) {
    super(`${field} must be ${expected}`);
  }
}

// America/Lima is UTC-5 with no daylight saving, so a Lima day is a fixed 24h window.
const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Lima midnight that opens the calendar day `YYYY-MM-DD`, or undefined if it is not a real date. */
function limaMidnight(date: string): number | undefined {
  const match = DATE_ONLY.exec(date);
  if (!match) return undefined;

  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const utc = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day;

  return isRealDate ? utc.getTime() + LIMA_OFFSET_MS : undefined;
}

/** `[start, end]` ms of the Lima calendar day `YYYY-MM-DD`, or of the day containing `now`. */
export function limaDayBounds(
  date?: string,
  now: number = Date.now(),
): [number, number] {
  let start: number | undefined;
  if (date === undefined) {
    start =
      Math.floor((now - LIMA_OFFSET_MS) / DAY_MS) * DAY_MS + LIMA_OFFSET_MS;
  } else {
    start = limaMidnight(date);
    if (start === undefined) throw new InvalidDateError("date", "YYYY-MM-DD");
  }
  return [start, start + DAY_MS - 1];
}

/** The Lima calendar date `YYYY-MM-DD` of a ms timestamp. */
export function limaDateString(timestamp: number): string {
  return new Date(timestamp - LIMA_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * One end of a query range in ms: `YYYY-MM-DD` opens or closes that Lima day,
 * an ISO timestamp with a zone is taken as the exact instant.
 */
export function limaRangeEdge(
  value: string,
  edge: "start" | "end",
  field: string,
): number {
  if (DATE_ONLY.test(value)) {
    const start = limaMidnight(value);
    if (start !== undefined)
      return edge === "start" ? start : start + DAY_MS - 1;
  } else if (
    ISO_WITH_ZONE.test(value) &&
    limaMidnight(value.slice(0, 10)) !== undefined
  ) {
    const instant = Date.parse(value);
    if (!Number.isNaN(instant)) return instant;
  }
  throw new InvalidDateError(
    field,
    "YYYY-MM-DD or an ISO timestamp with a zone",
  );
}
