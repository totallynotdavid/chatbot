/**
 * Boots the real entrypoint as a subprocess: no account is created, the
 * no-operator warning shows, and a seed that throws stops the boot before the
 * port is bound. The first boot is the control that shows the poll can see a
 * server come up.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { initializeDatabase } from "../src/db/init.ts";
import {
  ensureDefaultTenant,
  unconfiguredPhoneNumberId,
} from "../src/db/seeds/tenants.ts";
import { accountsOn } from "../src/domains/accounts/index.ts";
import { channelAccountsOn } from "../src/domains/channels/accounts.ts";
import { tenantsOn } from "../src/domains/tenants/index.ts";
import { ACCOUNT_ENV } from "./helpers/account-env.ts";
import { createTestDatabase } from "./helpers/database.ts";

const ENTRYPOINT = join(import.meta.dir, "..", "src", "index.ts");
const BACKEND_ROOT = join(import.meta.dir, "..");
const NO_OPERATOR_WARNING = "No platform operator can log in";

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
  /** Rows in `users` once the process was gone, or null if it never got that far. */
  users: number | null;
};

function countUsers(path: string): number | null {
  try {
    const db = createTestDatabase(path);
    try {
      return (
        db.prepare("SELECT COUNT(*) as count FROM users").get() as {
          count: number;
        }
      ).count;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Boot the real entrypoint and poll it until it either serves a request or
 * exits. `stopWhenServing` is for a server that comes up and so stays up: it
 * has to be killed rather than waited on. `prepare` gets the database file
 * before the process starts.
 */
async function boot(
  env: Record<string, string>,
  {
    stopWhenServing,
    prepare,
  }: { stopWhenServing: boolean; prepare?: (db: Database) => void },
): Promise<BootResult> {
  const dir = mkdtempSync(join(tmpdir(), "totem-boot-"));
  const dbPath = join(dir, "boot.sqlite");
  const port = freePort();

  if (prepare) {
    const db = createTestDatabase(dbPath);
    prepare(db);
    db.close();
  }

  const child = Bun.spawn(["bun", "run", ENTRYPOINT], {
    cwd: BACKEND_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      // Development logging goes to stdout, which is where the warning is read.
      NODE_ENV: "development",
      PORT: String(port),
      DB_PATH: dbPath,
      UPLOAD_DIR: join(dir, "uploads"),
      PRIVATE_DIR: join(dir, "private"),
      ...env,
    },
  });

  let served = false;
  let exited = false;

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

  const users = countUsers(dbPath);

  rmSync(dir, { recursive: true, force: true });

  return { exitCode: child.exitCode, output, served, users };
}

/** A database whose default tenant's placeholder number belongs to another tenant. */
function occupyPlaceholderNumber(db: Database) {
  initializeDatabase(db);

  const totem = ensureDefaultTenant(db);
  const other = tenantsOn(db).create({ slug: "other", name: "Other" });

  channelAccountsOn(db).create({
    tenantId: other.id,
    phoneNumberId: unconfiguredPhoneNumberId(totem.id),
    label: "Occupied",
  });
}

describe("booting the server", () => {
  let unstaffed: BootResult;
  let staffed: BootResult;
  let refused: BootResult;

  beforeAll(async () => {
    unstaffed = await boot(ACCOUNT_ENV, { stopWhenServing: true });

    staffed = await boot(
      {},
      {
        stopWhenServing: true,
        prepare: (db) => {
          initializeDatabase(db);
          accountsOn(db).create({
            username: "vendeya-staff",
            password: "a-long-enough-password",
            platformOperator: true,
          });
        },
      },
    );

    refused = await boot(
      {},
      { stopWhenServing: false, prepare: occupyPlaceholderNumber },
    );
  }, 180_000);

  describe("on a database with no accounts, with the environment asking for one", () => {
    it("comes up and serves", () => {
      expect(unstaffed.served).toBe(true);
    });

    it("creates no account", () => {
      expect(unstaffed.users).toBe(0);
    });

    it("warns that no platform operator exists, and names the command to run", () => {
      expect(unstaffed.output).toContain(NO_OPERATOR_WARNING);
      expect(unstaffed.output).toContain("bun run account create <username>");
    });
  });

  describe("on a database that has a platform operator", () => {
    it("comes up and serves", () => {
      expect(staffed.served).toBe(true);
    });

    it("does not warn", () => {
      expect(staffed.output).not.toContain(NO_OPERATOR_WARNING);
    });

    it("creates no account of its own", () => {
      expect(staffed.users).toBe(1);
    });
  });

  describe("when a seed throws", () => {
    it("never serves a request", () => {
      // The control above proves a booting server is visible to this poll, so
      // this is the server not being there rather than the poll missing it.
      expect(refused.served).toBe(false);
    });

    it("exits non-zero", () => {
      expect(refused.exitCode).not.toBe(0);
      expect(refused.exitCode).not.toBeNull();
    });

    it("says why", () => {
      expect(refused.output).toContain("which is reserved for tenant");
    });

    /**
     * Bun prints this banner when it takes a module's default export and binds
     * the port. Its absence is the direct evidence that module evaluation was
     * abandoned at the seed - the poll above could in principle race a very
     * short-lived server, but the port is never bound at all.
     */
    it("never gets as far as binding the port", () => {
      expect(refused.output).not.toContain("Started development server");
      expect(unstaffed.output).toContain("Started development server");
    });
  });
});
