/**
 * Boots the real entrypoint as a subprocess to check what a deployment sees: the
 * CORS origin, a scheduled task that throws, and a DB_PATH with no directory.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const BACKEND_ROOT = join(import.meta.dir, "..");
const ENTRYPOINT = join(BACKEND_ROOT, "src", "index.ts");
const CONNECTION = join(BACKEND_ROOT, "src", "db", "connection.ts");
const PUBLIC_URL = "https://ventas.example.com";

const root = mkdtempSync(join(tmpdir(), "vendeya-ops-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Loaded before the entrypoint. The app's timers fire every minute and every
 * hour, so this shortens them, and it makes the queries named in OPS_FAIL_SQL
 * throw the way a busy or full database would.
 */
const PRELOAD = join(root, "preload.ts");
writeFileSync(
  PRELOAD,
  `
import { Database } from "bun:sqlite";

const failing = (process.env.OPS_FAIL_SQL ?? "").split("|").filter(Boolean);
const prepare = Database.prototype.prepare;
Database.prototype.prepare = function (sql, ...rest) {
  const hit = failing.find((fragment) => String(sql).includes(fragment));
  if (hit) throw new Error("injected failure: " + hit);
  return prepare.call(this, sql, ...rest);
};

const setInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms, ...args) =>
  setInterval(fn, ms === 60_000 || ms === 3_600_000 ? 50 : ms, ...args);
`,
);

function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response("probe") });
  const port = server.port ?? 0;
  server.stop(true);
  return port;
}

type Server = {
  port: number;
  output: () => string;
  exited: () => boolean;
  stop: () => Promise<void>;
};

/** Starts the entrypoint on a temporary database and waits until it answers. */
async function boot(env: Record<string, string>): Promise<Server> {
  const dir = mkdtempSync(join(root, "boot-"));
  const port = freePort();
  const child = Bun.spawn(["bun", "--preload", PRELOAD, ENTRYPOINT], {
    cwd: BACKEND_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PORT: String(port),
      DB_PATH: join(dir, "boot.sqlite"),
      UPLOAD_DIR: join(dir, "uploads"),
      PRIVATE_DIR: join(dir, "private"),
      ...env,
    },
  });

  let text = "";
  for (const stream of [child.stdout, child.stderr]) {
    (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of stream) text += decoder.decode(chunk);
    })();
  }

  const server: Server = {
    port,
    output: () => text,
    exited: () => child.exitCode !== null || child.signalCode !== null,
    stop: async () => {
      child.kill();
      await child.exited;
    },
  };

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !server.exited()) {
    try {
      const response = await fetch(
        `http://localhost:${port}/api/conversations`,
        {
          signal: AbortSignal.timeout(2_000),
        },
      );
      await response.arrayBuffer();
      return server;
    } catch {
      await Bun.sleep(20);
    }
  }

  await server.stop();
  throw new Error(`The server never answered:\n${text}`);
}

async function until(condition: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await Bun.sleep(20);
  }
  return condition();
}

describe("a production server with PUBLIC_URL set", () => {
  let server: Server;

  beforeAll(async () => {
    server = await boot({ NODE_ENV: "production", PUBLIC_URL });
  }, 60_000);

  afterAll(async () => {
    await server.stop();
  });

  it("lets the frontend's own origin call the API", async () => {
    const response = await fetch(
      `http://localhost:${server.port}/api/conversations`,
      {
        method: "OPTIONS",
        headers: {
          origin: PUBLIC_URL,
          "access-control-request-method": "GET",
        },
      },
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(
      PUBLIC_URL,
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });
});

describe("a scheduled task that throws", () => {
  let server: Server;

  beforeAll(async () => {
    server = await boot({
      NODE_ENV: "development",
      OPS_FAIL_SQL: "assignment_notified_at < ?|DELETE FROM message_inbox",
    });
  }, 60_000);

  afterAll(async () => {
    await server.stop();
  });

  it("is logged and leaves the server running", async () => {
    await until(
      () =>
        server.output().includes("injected failure: assignment_notified_at") &&
        server.output().includes("injected failure: DELETE FROM message_inbox"),
      10_000,
    );
    // Several more ticks, so a crash that follows the first failure shows.
    await Bun.sleep(500);

    expect(server.exited()).toBe(false);
    expect(server.output()).toContain(
      "injected failure: assignment_notified_at",
    );
    expect(server.output()).toContain(
      "injected failure: DELETE FROM message_inbox",
    );

    const response = await fetch(
      `http://localhost:${server.port}/api/conversations`,
    );
    expect(response.status).toBe(401);
  });
});

describe("DB_PATH without a directory", () => {
  it("opens the database in the working directory", async () => {
    const cwd = mkdtempSync(join(root, "cwd-"));
    const child = Bun.spawn(
      [
        "bun",
        "-e",
        `import ${JSON.stringify(CONNECTION)}; console.log("opened")`,
      ],
      {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          DB_PATH: "db.sqlite",
          UPLOAD_DIR: join(cwd, "uploads"),
          PRIVATE_DIR: join(cwd, "private"),
        },
      },
    );
    const stdout = await new Response(child.stdout).text();
    const stderr = await new Response(child.stderr).text();
    await child.exited;

    expect({ exitCode: child.exitCode, stdout, stderr }).toMatchObject({
      exitCode: 0,
      stdout: "opened\n",
    });
    expect(existsSync(join(cwd, "db.sqlite"))).toBe(true);
  });
});
