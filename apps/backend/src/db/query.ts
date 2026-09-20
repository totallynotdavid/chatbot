import { db } from "./connection.ts";
import type { Database, SQLQueryBindings } from "bun:sqlite";

/**
 * Binds the query helpers to a database passed in, so tests can run the seeds,
 * the account command and the tenant and channel services on a temporary file.
 * The exports below use the application database.
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
 * Cross-tenant reads of a tenant's rows span only active tenants. An operator's
 * session drops its pin when the tenant is suspended (platform/auth/session.ts),
 * but an unpinned operator already reads every tenant, so the exclusion has to
 * live in the read.
 */
const OPEN_TENANTS = "(SELECT id FROM tenants WHERE status = 'active')";

/**
 * A concrete `tenantId` filters to that tenant. Null is the cross-tenant read.
 * An unpinned platform operator reaches it, and so does a background worker that
 * passes null on purpose. It spans open tenants, never every row.
 */
export function tenantPredicate(
  tenantId: string | null,
  column = "tenant_id",
): string {
  // The null branch binds nothing, so callers build their params as
  // `tenantId ? [other, tenantId] : [other]`.
  return tenantId ? `${column} = ?` : openTenantsOnly(column);
}

/**
 * Limits a query with no tenant parameter to open tenants. The background
 * workers that sweep every tenant's queue use it, so a message queued before a
 * suspension is not answered after it and a suspended tenant's conversations
 * are not reassigned.
 */
export function openTenantsOnly(column = "tenant_id"): string {
  return `${column} IN ${OPEN_TENANTS}`;
}

/**
 * Accounts a background worker may send on. A send on a `pending` or `disabled`
 * number is refused, so a query that dequeues work leaves those accounts out.
 * The row stays queued, and re-enabling the number resumes it.
 */
export function activeChannelAccountsOnly(
  column = "channel_account_id",
): string {
  return `${column} IN (SELECT id FROM channel_accounts WHERE status = 'active')`;
}

/**
 * For `audit_log` and `notification_traces`, whose `tenant_id` is nullable. A
 * null row belongs to the platform, not to a suspended business, so a
 * cross-tenant read keeps it.
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

/**
 * A date query parameter that is not a real calendar date or timestamp.
 * `middleware/error.ts` answers it as 400.
 */
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
 * One end of a query range in ms. A `YYYY-MM-DD` value opens or closes that Lima
 * day. An ISO timestamp with a zone is taken as the exact instant.
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
