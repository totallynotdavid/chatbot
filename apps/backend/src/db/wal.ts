import type { Database } from "bun:sqlite";

function isBusy(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("SQLITE_BUSY");
}

/**
 * Switches the file to WAL, waiting up to `timeoutMs` for another process that
 * is switching it. A retry that runs after that process has committed finds WAL
 * already set. Throws the busy error when the time runs out.
 */
export function enableWal(db: Database, timeoutMs: number): void {
  // A monotonic clock, so a step in the wall clock cannot cut the wait short.
  const deadline = performance.now() + timeoutMs;

  for (let delayMs = 1; ; delayMs = Math.min(delayMs * 2, 50)) {
    try {
      db.run("PRAGMA journal_mode = WAL;");
      return;
    } catch (error) {
      // `busy_timeout` does not cover the switch. While another connection
      // holds the write lock, the pragma fails with SQLITE_BUSY at once.
      const remainingMs = deadline - performance.now();
      if (!isBusy(error) || remainingMs <= 0) throw error;
      Bun.sleepSync(Math.min(delayMs, remainingMs));
    }
  }
}
