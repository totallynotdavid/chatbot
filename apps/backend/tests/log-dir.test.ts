/**
 * The backend writes `backend.log` under LOG_DIR, and under `./data/logs` in
 * the working directory when LOG_DIR is not set. The suite sets LOG_DIR so its
 * own output stays out of `apps/backend/data/logs`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const LOGGER = join(import.meta.dir, "..", "src", "lib", "logger.ts");

describe("log directory", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendeya-log-dir-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function logOnce(env: Record<string, string>) {
    const script = `
      import { createLogger } from ${JSON.stringify(LOGGER)};
      createLogger("log-dir-test").info("hello from the log dir test");
      await new Promise((resolve) => setTimeout(resolve, 300));
    `;
    const child = Bun.spawn(["bun", "-e", script], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "production",
        ...env,
      },
    });
    const stderr = await new Response(child.stderr).text();
    expect([await child.exited, stderr]).toEqual([0, ""]);
  }

  it("writes backend.log under LOG_DIR", async () => {
    const logDir = join(dir, "elsewhere");

    await logOnce({ LOG_DIR: logDir });

    expect(readFileSync(join(logDir, "backend.log"), "utf-8")).toContain(
      "hello from the log dir test",
    );
    expect(existsSync(join(dir, "data", "logs"))).toBe(false);
  });

  it("writes backend.log under data/logs when LOG_DIR is not set", async () => {
    await logOnce({});

    expect(
      readFileSync(join(dir, "data", "logs", "backend.log"), "utf-8"),
    ).toContain("hello from the log dir test");
  });

  it("is set for this suite, outside the working tree", () => {
    expect(process.env.LOG_DIR).toBeTruthy();
    expect(process.env.LOG_DIR).toStartWith(tmpdir());
  });
});
