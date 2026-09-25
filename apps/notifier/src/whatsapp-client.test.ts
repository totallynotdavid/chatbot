import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("reports how to configure Chrome when no browser is available", async () => {
  const root = mkdtempSync(join(tmpdir(), "vendeya-notifier-browser-"));
  const child = Bun.spawn(
    ["bun", "--no-env-file", "--install=disable", "run", "src/index.ts"],
    {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NOTIFIER_DATA_PATH: join(root, "notifier"),
        PUPPETEER_CACHE_DIR: join(root, "puppeteer"),
      },
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  rmSync(root, { recursive: true, force: true });

  expect(exitCode).toBe(1);
  expect(stdout + stderr).toContain("CHROME_PATH");
  expect(stdout + stderr).toContain("bunx puppeteer browsers install chrome");
});
