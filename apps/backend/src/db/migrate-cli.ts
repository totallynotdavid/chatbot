import process from "node:process";
import { createDb } from "./client.ts";
import { migrateToLatest } from "./migrate.ts";

const db = createDb();

try {
  const applied = await migrateToLatest(db);
  console.log(
    applied.length > 0
      ? `Applied ${applied.join(", ")}.`
      : "The schema is up to date.",
  );
} catch (error) {
  console.error(
    `error: migration failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
} finally {
  await db.destroy();
}
