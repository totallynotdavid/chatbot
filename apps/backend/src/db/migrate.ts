import { db } from "./connection.ts";
import { initializeDatabase } from "./init.ts";

// Deploys run this before the backend starts. Seeding remains part of backend
// boot so this command only applies schema changes.
initializeDatabase(db);
// Close the handle so the migration process can exit.
db.close();
