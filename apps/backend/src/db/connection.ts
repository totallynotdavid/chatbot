import { Database } from "bun:sqlite";
import fs from "node:fs";
import process from "node:process";
import { UPLOAD_DIR } from "../lib/storage-paths.ts";

const DB_PATH = process.env.DB_PATH || "./data/database.sqlite";

fs.mkdirSync(DB_PATH.substring(0, DB_PATH.lastIndexOf("/")), {
  recursive: true,
});
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(DB_PATH, { create: true });
// Set first, so that a second process waits for a lock instead of failing, even while WAL is switched on.
db.run("PRAGMA busy_timeout = 10000;");
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA synchronous = NORMAL;");
db.run("PRAGMA cache_size = 10000;");
db.run("PRAGMA temp_store = MEMORY;");
// SQLite leaves foreign key enforcement off by default. Without this pragma,
// every REFERENCES and ON DELETE CASCADE in schema.sql would do nothing, and
// orphan rows or cross-tenant dangling references would insert without
// complaint.
db.run("PRAGMA foreign_keys = ON;");
