import { Database } from "bun:sqlite";

/**
 * A file database a test creates for itself. Nothing in it needs to survive a
 * power cut, so it skips the fsync after every statement, which is what makes
 * a schema build take seconds on a slow disk.
 */
export function createTestDatabase(path: string): Database {
  const database = new Database(path, { create: true });
  database.run("PRAGMA synchronous = OFF;");
  return database;
}
