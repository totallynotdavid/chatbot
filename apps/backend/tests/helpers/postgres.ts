/**
 * A migrated Postgres database per test, cloned from a template. The server is
 * TEST_DATABASE_URL or a throwaway initdb/pg_ctl server. Suites skip when
 * neither is available.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import pg from "pg";
import { createDb, type Db } from "../../src/db/client.ts";
import { migrateToLatest } from "../../src/db/migrate.ts";

export const postgresAvailable =
  Boolean(process.env.TEST_DATABASE_URL) || Boolean(Bun.which("initdb"));

type Server = {
  /** Connection string of a database to run `CREATE DATABASE` from. */
  adminUrl: string;
  admin: pg.Pool;
  template: string;
  /** Stops a server this module started and drops what it created on one it did not. */
  close(): Promise<void>;
};

export type TestDb = {
  db: Db;
  url: string;
  /** Closes the connections and drops the database. */
  destroy(): Promise<void>;
};

let server: Promise<Server> | undefined;
let counter = 0;

const run = (command: string[]) => {
  const result = Bun.spawnSync(command, { stderr: "pipe", stdout: "pipe" });
  if (!result.success) {
    throw new Error(
      `${command.join(" ")} failed: ${result.stderr.toString()}${result.stdout.toString()}`,
    );
  }
};

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** Starts a server that is cheap to run and loses its data on a crash. */
async function startThrowawayServer(): Promise<{
  url: string;
  stop(): void;
}> {
  const dir = mkdtempSync(join(tmpdir(), "vendeya-pg-"));
  const data = join(dir, "data");
  const port = await freePort();

  run([
    "initdb",
    "--pgdata",
    data,
    "--username",
    "postgres",
    "--auth",
    "trust",
    "--encoding",
    "UTF8",
    "--locale",
    "C",
    "--no-sync",
    "--no-instructions",
  ]);

  const options = [
    `-p ${port}`,
    "-c listen_addresses=127.0.0.1",
    `-c unix_socket_directories=${dir}`,
    "-c fsync=off",
    "-c synchronous_commit=off",
    "-c full_page_writes=off",
  ].join(" ");

  run([
    "pg_ctl",
    "--pgdata",
    data,
    "--wait",
    "--log",
    join(dir, "server.log"),
    "--options",
    options,
    "start",
  ]);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    Bun.spawnSync(["pg_ctl", "--pgdata", data, "--mode", "immediate", "stop"]);
    rmSync(dir, { recursive: true, force: true });
  };
  // The suite ends by exiting, and a server left running holds its port and
  // its memory until the machine restarts.
  process.on("exit", stop);

  return { url: `postgres://postgres@127.0.0.1:${port}/postgres`, stop };
}

async function startServer(): Promise<Server> {
  const external = process.env.TEST_DATABASE_URL;
  const throwaway = external ? undefined : await startThrowawayServer();
  const adminUrl = external ?? throwaway!.url;

  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const template = `vendeya_template_${process.pid}_${Date.now()}`;

  await admin.query(`CREATE DATABASE "${template}"`);

  const db = createDb(withDatabase(adminUrl, template));
  try {
    await migrateToLatest(db);
  } finally {
    // A template cannot be cloned while anyone is connected to it.
    await db.destroy();
  }

  return {
    adminUrl,
    admin,
    template,
    async close() {
      if (throwaway) {
        await admin.end();
        throwaway.stop();
        return;
      }
      await admin.query(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** Builds the template now, so the first test is not charged for it. */
export function prepareTestServer(): Promise<Server> {
  server ??= startServer();
  return server;
}

/** Drops the template, and stops the server if this module started it. */
export async function closeTestServer(): Promise<void> {
  if (!server) return;
  const running = await server;
  server = undefined;
  await running.close();
}

/**
 * A database no other test shares: migrated, or with `migrated: false` empty,
 * for a test that runs the migrations itself.
 */
export async function createTestDb({
  migrated = true,
}: {
  migrated?: boolean;
} = {}): Promise<TestDb> {
  const { adminUrl, admin, template } = await prepareTestServer();
  const name = `vendeya_test_${process.pid}_${++counter}_${Date.now()}`;

  await admin.query(
    migrated
      ? `CREATE DATABASE "${name}" TEMPLATE "${template}"`
      : `CREATE DATABASE "${name}" TEMPLATE template0`,
  );

  const url = withDatabase(adminUrl, name);
  const db = createDb(url);

  return {
    db,
    url,
    async destroy() {
      await db.destroy();
      // The pool has sent its goodbye, but the server may not have read it yet.
      // Dropping now would kill those sessions and log an error for each.
      for (let wait = 0; wait < 50; wait++) {
        const { rowCount } = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname = $1",
          [name],
        );
        if (!rowCount) break;
        await Bun.sleep(10);
      }
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}
