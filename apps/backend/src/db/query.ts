import { db } from "./connection.ts";

export function getOne<T>(sql: string, params: unknown[] = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function getAll<T>(sql: string, params: unknown[] = []): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(
  sql: string,
  params: unknown[] = [],
): { changes: number; lastInsertRowid: number } {
  const info = db.prepare(sql).run(...params);
  return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
}
