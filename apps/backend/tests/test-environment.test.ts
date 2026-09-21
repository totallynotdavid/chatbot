/** `bun test` selects the test adapter whatever NODE_ENV the shell or the env file carries. */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const BACKEND_ROOT = join(import.meta.dir, "..");

const PROBE = `
import { expect, it } from "bun:test";
import process from "node:process";

it("runs with NODE_ENV=test", () => {
  expect(process.env.NODE_ENV).toBe("test");
});
`;

describe("the test environment", () => {
  let dir: string;
  let probe: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "vendeya-test-env-"));
    probe = join(dir, "probe.test.ts");
    writeFileSync(probe, PROBE);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function runWith(nodeEnv: string, via: "shell" | "envFile") {
    const envFile = join(dir, `${nodeEnv}.env`);
    writeFileSync(envFile, `NODE_ENV=${nodeEnv}\n`);

    const child = Bun.spawn(["bun", "test", `--env-file=${envFile}`, probe], {
      cwd: BACKEND_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...(via === "shell" ? { NODE_ENV: nodeEnv } : {}),
      },
    });

    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    return { code, output: stdout + stderr };
  }

  for (const nodeEnv of ["development", "production"]) {
    for (const via of ["shell", "envFile"] as const) {
      it(`selects the test adapter when NODE_ENV=${nodeEnv} comes from the ${via === "shell" ? "shell" : "env file"}`, async () => {
        const { code, output } = await runWith(nodeEnv, via);

        expect(output).toContain("1 pass");
        expect(code).toBe(0);
      });
    }
  }
});
