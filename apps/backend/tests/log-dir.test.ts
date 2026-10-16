/**
 * The backend writes `backend.log` under LOG_DIR. In production without
 * LOG_DIR it writes to stdout and creates no directory, which is where a
 * container runtime reads it. The suite sets LOG_DIR so its own output stays out
 * of `apps/backend/data/logs`.
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
    const stdout = await new Response(child.stdout).text();
    const stderr = await new Response(child.stderr).text();
    expect([await child.exited, stderr]).toEqual([0, ""]);

    return stdout;
  }

  it("writes backend.log under LOG_DIR", async () => {
    const logDir = join(dir, "elsewhere");

    const stdout = await logOnce({ LOG_DIR: logDir });

    expect(readFileSync(join(logDir, "backend.log"), "utf-8")).toContain(
      "hello from the log dir test",
    );
    expect(stdout).toBe("");
    expect(existsSync(join(dir, "data", "logs"))).toBe(false);
  });

  it("writes to stdout and no file when LOG_DIR is not set", async () => {
    const stdout = await logOnce({});

    expect(stdout).toContain("hello from the log dir test");
    expect(existsSync(join(dir, "data"))).toBe(false);
  });

  it("writes data/logs/backend.log in development", async () => {
    await logOnce({ NODE_ENV: "development" });

    expect(
      readFileSync(join(dir, "data", "logs", "backend.log"), "utf-8"),
    ).toContain("hello from the log dir test");
  });

  it("is set for this suite, outside the working tree", () => {
    expect(process.env.LOG_DIR).toBeTruthy();
    expect(process.env.LOG_DIR).toStartWith(tmpdir());
  });
});
