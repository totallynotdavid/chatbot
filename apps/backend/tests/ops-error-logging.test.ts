/**
 * `logger.error({ error }, ...)` is the shape of most error logs. An Error has
 * no enumerable properties, so JSON.stringify writes it as `{}` unless the
 * logger serializes it.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRootLogger } from "@vendeya/logger";

const dir = mkdtempSync(join(tmpdir(), "vendeya-logger-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Logs through the production destination and returns the parsed line. */
async function logLine(
  filename: string,
  log: (logger: ReturnType<typeof createRootLogger>) => void,
): Promise<Record<string, unknown>> {
  const logger = createRootLogger({
    name: "ops-test",
    logDir: dir,
    filename,
    isDevelopment: false,
    baseLevel: "info",
  });

  log(logger);

  // The production destination opens and writes asynchronously.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const text = readFileSync(join(dir, filename), "utf-8").trim();
      if (text) return JSON.parse(text.split("\n").pop() as string);
    } catch {
      // Not created yet.
    }
    await Bun.sleep(10);
  }

  throw new Error(`Nothing was written to ${filename}`);
}

describe("logging an error", () => {
  it("writes the message and stack of `error`", async () => {
    const line = await logLine("error-key.log", (logger) =>
      logger.error(
        {
          error: new Error("Unsupported state or unable to authenticate data"),
        },
        "Failed to decrypt channel secret",
      ),
    );

    expect(line.msg).toBe("Failed to decrypt channel secret");
    expect(line.error).toMatchObject({
      message: "Unsupported state or unable to authenticate data",
    });
    expect((line.error as { stack: string }).stack).toContain(
      "ops-error-logging.test.ts",
    );
  });

  it("writes the message and stack of `err`", async () => {
    const line = await logLine("err-key.log", (logger) =>
      logger.error({ err: new Error("boom") }, "Something failed"),
    );

    expect(line.err).toMatchObject({ message: "boom" });
    expect((line.err as { stack: string }).stack).toContain("boom");
  });

  it("keeps the cause and the code an error carries", async () => {
    const cause = new Error("disk full");
    const line = await logLine("cause.log", (logger) =>
      logger.error(
        {
          error: Object.assign(new Error("write failed", { cause }), {
            code: "ENOSPC",
          }),
        },
        "Upload failed",
      ),
    );

    expect(line.error).toMatchObject({ code: "ENOSPC" });
    expect((line.error as { message: string }).message).toContain(
      "write failed",
    );
    expect(JSON.stringify(line.error)).toContain("disk full");
  });

  it("leaves a value that is not an error as it was", async () => {
    const line = await logLine("plain.log", (logger) =>
      logger.error({ error: "provider said no" }, "Lookup failed"),
    );

    expect(line.error).toBe("provider said no");
  });
});
