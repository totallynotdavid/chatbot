import { Database } from "bun:sqlite";
import fs from "node:fs";
import process from "node:process";

const DB_PATH = process.env.DB_PATH || "./data/database.sqlite";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/uploads";

fs.mkdirSync(DB_PATH.substring(0, DB_PATH.lastIndexOf("/")), {
  recursive: true,
});
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA synchronous = NORMAL;");
db.run("PRAGMA cache_size = 10000;");
db.run("PRAGMA temp_store = MEMORY;");
