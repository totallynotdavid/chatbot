import type { Kysely } from "kysely";
import { type MigrationProvider, Migrator } from "kysely/migration";
import * as baseline from "./migrations/0001_baseline.ts";

/**
 * Migrations run in name order and only forward. There is no `down`.
 * A deployed database is never rebuilt. Schema changes use a new file here,
 * and a migration that has run is never edited.
 */
const provider: MigrationProvider = {
  getMigrations: async () => ({
    "0001_baseline": baseline,
  }),
};

/**
 * Applies the migrations that have not run and returns their names. `Migrator`
 * holds a Postgres advisory lock for the whole run, so two processes started
 * together apply each migration once: the second waits, then finds nothing to
 * do.
 */
export async function migrateToLatest<Schema>(
  db: Kysely<Schema>,
): Promise<string[]> {
  const { error, results } = await new Migrator({
    db,
    provider,
  }).migrateToLatest();

  if (error) throw error;

  return (results ?? [])
    .filter((result) => result.status === "Success")
    .map((result) => result.migrationName);
}
