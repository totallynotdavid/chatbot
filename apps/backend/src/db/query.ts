import { db } from "./connection.ts";
import type { SQLQueryBindings } from "bun:sqlite";

export function getOne<T>(
  sql: string,
  params: SQLQueryBindings[] = [],
): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function getAll<T>(sql: string, params: SQLQueryBindings[] = []): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(
  sql: string,
  params: SQLQueryBindings[] = [],
): { changes: number; lastInsertRowid: number } {
  const info = db.prepare(sql).run(...params);
  return {
    changes: info.changes,
    lastInsertRowid: Number(info.lastInsertRowid),
  };
}
