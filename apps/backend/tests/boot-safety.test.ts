/**
 * That a refused boot is actually refused.
 *
 * `seedUsers` throws on a BOOTSTRAP_ADMIN_PASSWORD under 12 characters, and
 * seeding.test.ts states the contract that throw depends on: "the seeds run on
 * every boot, and a throw here takes the process with it." It did not. `index.ts`
 * called the async `seedDatabase(db)` without awaiting it, so the rejection
 * surfaced only after the rest of the module had run and Bun had taken the
 * default export and bound the port - the process died a moment later, but it
 * had already started serving. A deployment with a weak bootstrap password came
 * up instead of refusing to.
 *
 * Nothing here can be checked in-process: the failure is in what module
 * evaluation does with a rejected promise, so these boot the real entrypoint as
 * a subprocess and watch what it does. The strong-password case is run first and
 * is the control - it proves this harness can see a server that does come up, so
 * "never served" in the weak-password case means something.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const ENTRYPOINT = join(import.meta.dir, "..", "src", "index.ts");
const BACKEND_ROOT = join(import.meta.dir, "..");

/** A port well away from the development default, per boot under test. */
function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response("probe") });
  const port = server.port ?? 0;
  server.stop(true);

  if (port === 0) throw new Error("Could not reserve a port for the boot test");

  return port;
}

type BootResult = {
  exitCode: number | null;
  output: string;
  /** Whether the app ever answered a request while the process was alive. */
  served: boolean;
};

/**
 * Boot the real entrypoint and poll it until it either serves a request or
 * exits. `stopWhenServing` is the control's path: a server that comes up stays
 * up, so it has to be killed rather than waited on.
 */
async function boot(
  env: Record<string, string>,
  { stopWhenServing }: { stopWhenServing: boolean },
): Promise<BootResult> {
  const dir = mkdtempSync(join(tmpdir(), "totem-boot-"));
  const port = freePort();

  const child = Bun.spawn(["bun", "run", ENTRYPOINT], {
    cwd: BACKEND_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_ENV: "test",
      PORT: String(port),
      DB_PATH: join(dir, "boot.sqlite"),
      UPLOAD_DIR: join(dir, "uploads"),
      PRIVATE_DIR: join(dir, "private"),
      ...env,
    },
  });

  let served = false;
  let exited = false;

  // Tight poll: without the fix the window between the port being bound and the
  // unhandled rejection killing the process is short, so it is watched for
  // rather than sampled once.
  //
  // `/api/conversations` rather than `/health`, which spends seconds waiting on
  // the notifier and the eligibility providers: an unauthenticated 401 comes
  // straight back from the middleware and is all the evidence needed that the
  // port is bound and the app is answering.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      exited = true;
      break;
    }

    try {
      const response = await fetch(
        `http://localhost:${port}/api/conversations`,
        {
          signal: AbortSignal.timeout(2_000),
        },
      );
      await response.arrayBuffer();
      served = true;
      break;
    } catch {
      // Nothing listening yet, or not any more.
    }

    await Bun.sleep(20);
  }

  // A server that came up stays up, and so does one that outlasted the deadline.
  if (!exited && (served ? stopWhenServing : true)) child.kill();

  await child.exited;

  const output =
    (await new Response(child.stdout).text()) +
    (await new Response(child.stderr).text());

  rmSync(dir, { recursive: true, force: true });

  return { exitCode: child.exitCode, output, served };
}

describe("booting the server", () => {
  let strong: BootResult;
  let weak: BootResult;

  beforeAll(async () => {
    strong = await boot(
      {
        BOOTSTRAP_ADMIN_USERNAME: "boot-admin",
        BOOTSTRAP_ADMIN_PASSWORD: "a-long-enough-password",
      },
      { stopWhenServing: true },
    );

    weak = await boot(
      {
        BOOTSTRAP_ADMIN_USERNAME: "boot-admin",
        BOOTSTRAP_ADMIN_PASSWORD: "short",
      },
      { stopWhenServing: false },
    );
  }, 90_000);

  describe("with a bootstrap password the seed accepts", () => {
    it("comes up and serves", () => {
      expect(strong.served).toBe(true);
    });
  });

  describe("with a bootstrap password under the minimum", () => {
    it("never serves a request", () => {
      // The control above proves a booting server is visible to this poll, so
      // this is the server not being there rather than the poll missing it.
      expect(weak.served).toBe(false);
    });

    it("exits non-zero", () => {
      expect(weak.exitCode).not.toBe(0);
      expect(weak.exitCode).not.toBeNull();
    });

    it("says why", () => {
      expect(weak.output).toContain(
        "BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters",
      );
    });

    /**
     * Bun prints this banner when it takes a module's default export and binds
     * the port. Its absence is the direct evidence that module evaluation was
     * abandoned at the seed - the poll above could in principle race a very
     * short-lived server, but the port is never bound at all.
     */
    it("never gets as far as binding the port", () => {
      expect(weak.output).not.toContain("Started development server");
      expect(strong.output).toContain("Started development server");
    });
  });
});
