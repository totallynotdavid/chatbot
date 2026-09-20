/**
 * Boots the database named by DB_PATH, then gives it two conversations whose
 * `last_activity_at` SQLite cannot parse and runs the backfill. The log lines
 * land in `data/logs` under the working directory.
 */

import { db } from "../../src/db/connection.ts";
import { initializeDatabase } from "../../src/db/init.ts";
import { backfillTextActivityTimestamps } from "../../src/db/migrations.ts";

initializeDatabase(db);
// The rows name a tenant and a channel account that do not exist.
db.run("PRAGMA foreign_keys = OFF;");
for (const phone of ["51900000001", "51900000002"]) {
  db.prepare(
    `INSERT INTO conversations
       (tenant_id, channel_account_id, phone_number, context_data, last_activity_at)
     VALUES ('tn-1', 'ch-1', ?, '{}', 'yesterday afternoon')`,
  ).run(phone);
}
backfillTextActivityTimestamps(db);
db.close();
