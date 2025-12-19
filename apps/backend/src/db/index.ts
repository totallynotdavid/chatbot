import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

const DB_PATH = process.env.DB_PATH || "./data/database.sqlite";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/uploads";

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.run("PRAGMA journal_mode = WAL;");

// Initialize Schema
const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
const schema = fs.readFileSync(schemaPath, "utf-8");
db.run(schema);

// Seed Admin User if empty
const adminCheck = db.prepare("SELECT count(*) as count FROM users").get() as {
    count: number;
};
if (adminCheck.count === 0) {
    const hash = bcrypt.hashSync("admin123", 10);
    const stmt = db.prepare(
        "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
    );
    stmt.run(crypto.randomUUID(), "admin", hash, "admin");
    console.log("Admin user seeded: admin / admin123");
}

export type DbUser = {
    id: string;
    username: string;
    password_hash: string;
    role: string;
};
