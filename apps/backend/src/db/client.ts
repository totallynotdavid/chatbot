import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import process from "node:process";
import { createLogger } from "../lib/logger.ts";
import type { DB } from "./types.ts";

const logger = createLogger("db");

export type Db = Kysely<DB>;

/**
 * Epoch-millisecond columns are `bigint`, which `pg` returns as a string by
 * default. Every value stored stays below Number.MAX_SAFE_INTEGER, and the
 * `numeric(12, 2)` money columns fit a double exactly enough for prices.
 */
const types = new pg.TypeOverrides();
types.setTypeParser(pg.types.builtins.INT8, Number);
types.setTypeParser(pg.types.builtins.NUMERIC, Number.parseFloat);

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the Postgres database, for example postgres://vendeya:password@localhost:5432/vendeya.",
    );
  }
  return url;
}

export function createDb(connectionString: string = databaseUrl()): Db {
  const pool = new pg.Pool({ connectionString, types });
  // A restart of the server ends idle pool connections. Without a listener,
  // `pg` rethrows that as an uncaught error and takes the process down. With a
  // listener, the pool drops the connection and opens another when needed.
  pool.on("error", (error) => {
    logger.warn({ error }, "An idle database connection ended");
  });
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });
}
