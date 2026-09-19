/** `bun run account` in a subprocess: where the password comes from, what it prints, its exit code. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import bcrypt from "bcryptjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { initializeDatabase } from "../src/db/init.ts";
import { ensureDefaultTenant } from "../src/db/seeds/tenants.ts";
import { membershipsOn, tenantsOn } from "../src/domains/tenants/index.ts";
import { ACCOUNT_ENV } from "./helpers/account-env.ts";
import { createTestDatabase } from "./helpers/database.ts";

const CLI = join(import.meta.dir, "..", "src", "cli", "account.ts");
const BACKEND_ROOT = join(import.meta.dir, "..");
const PASSWORD = "a-long-enough-password";

describe("the account command", () => {
  let dir: string;
  let dbPath: string;

  function open(): Database {
    return createTestDatabase(dbPath);
  }

  function childEnv(extra: Record<string, string> = {}) {
    return {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_ENV: "test",
      DB_PATH: dbPath,
      UPLOAD_DIR: join(dir, "uploads"),
      PRIVATE_DIR: join(dir, "private"),
      ...extra,
    };
  }

  async function run(
    args: string[],
    { stdin, env }: { stdin?: string; env?: Record<string, string> } = {},
  ) {
    const child = Bun.spawn(["bun", "run", CLI, ...args], {
      cwd: BACKEND_ROOT,
      stdin: stdin === undefined ? null : new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
      env: childEnv(env),
    });

    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    return { code, stdout, stderr };
  }

  /**
   * Runs it on a terminal, answering each prompt in turn. What the terminal
   * showed is returned, echo included, so a password that leaked is visible.
   */
  async function runOnTerminal(
    args: string[],
    replies: Array<[prompt: string, reply: string]>,
  ) {
    let screen = "";

    const child = Bun.spawn(["bun", "run", CLI, ...args], {
      cwd: BACKEND_ROOT,
      env: childEnv(),
      terminal: {
        cols: 80,
        rows: 24,
        data(_terminal, chunk) {
          screen += new TextDecoder().decode(chunk);
        },
      },
    });

    let from = 0;
    const deadline = Date.now() + 20_000;

    for (const [prompt, reply] of replies) {
      while (!screen.includes(prompt, from) && Date.now() < deadline) {
        await Bun.sleep(20);
      }
      if (!screen.includes(prompt, from)) {
        child.kill();
        throw new Error(
          `Never saw "${prompt}"; the terminal showed: ${screen}`,
        );
      }
      from = screen.indexOf(prompt, from) + prompt.length;
      child.terminal?.write(reply);
    }

    const code = await child.exited;
    child.terminal?.close();

    return { code, screen };
  }

  function user(username: string) {
    const db = open();
    try {
      return db
        .prepare("SELECT * FROM users WHERE username = ?")
        .get(username) as {
        id: string;
        password_hash: string;
        is_platform_operator: number;
      } | null;
    } finally {
      db.close();
    }
  }

  function userCount(): number {
    const db = open();
    try {
      return (
        db.prepare("SELECT COUNT(*) as count FROM users").get() as {
          count: number;
        }
      ).count;
    } finally {
      db.close();
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-account-cli-"));
    dbPath = join(dir, "cli.sqlite");

    const db = open();
    initializeDatabase(db);
    ensureDefaultTenant(db);
    db.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("makes a platform operator from a password piped in", async () => {
      const result = await run(
        ["create", "vendeya-staff", "--platform-operator"],
        { stdin: `${PASSWORD}\n` },
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        "Created platform operator vendeya-staff",
      );

      const row = user("vendeya-staff")!;
      expect(row.is_platform_operator).toBe(1);
      expect(bcrypt.compareSync(PASSWORD, row.password_hash)).toBe(true);
    });

    it("makes an admin of the only tenant, and says which", async () => {
      const result = await run(["create", "maria", "--name", "María"], {
        stdin: PASSWORD,
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("as admin of tenant totem");

      const db = open();
      const tenant = tenantsOn(db).getBySlug("totem")!;
      expect(membershipsOn(db).roleFor(tenant.id, user("maria")!.id)).toBe(
        "admin",
      );
      db.close();
    });

    it("takes the tenant it is named when there are several", async () => {
      const db = open();
      const other = tenantsOn(db).create({ slug: "other", name: "Other" });
      db.close();

      const result = await run(["create", "maria", "--tenant", other.id], {
        stdin: PASSWORD,
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("tenant other");
    });

    it("refuses without a tenant when there are several, and lists them", async () => {
      const db = open();
      tenantsOn(db).create({ slug: "other", name: "Other" });
      db.close();

      const result = await run(["create", "maria"], { stdin: PASSWORD });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("(totem)");
      expect(result.stderr).toContain("(other)");
      expect(userCount()).toBe(0);
    });

    it("refuses a platform operator that is also given a tenant", async () => {
      const result = await run(
        ["create", "maria", "--platform-operator", "--tenant", "tn-1"],
        { stdin: PASSWORD },
      );

      expect(result.code).toBe(1);
      expect(userCount()).toBe(0);
    });

    it("refuses a password under 12 characters", async () => {
      const result = await run(["create", "maria"], { stdin: "short\n" });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("at least 12 characters");
      expect(userCount()).toBe(0);
    });

    it("refuses a username that is taken", async () => {
      await run(["create", "maria"], { stdin: PASSWORD });

      const result = await run(["create", "maria"], { stdin: PASSWORD });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("taken");
      expect(userCount()).toBe(1);
    });

    it("refuses a password given as an argument, and does not repeat it", async () => {
      const result = await run(["create", "maria", "--password", PASSWORD], {
        stdin: PASSWORD,
      });

      expect(result.code).toBe(2);
      expect(result.stderr).toContain("Usage:");
      expect(result.stderr).not.toContain(PASSWORD);
      expect(userCount()).toBe(0);
    });

    it("does not read the password from the environment", async () => {
      const result = await run(["create", "maria"], {
        env: {
          ...ACCOUNT_ENV,
          PASSWORD,
          ACCOUNT_PASSWORD: PASSWORD,
        },
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("at least 12 characters");
      expect(userCount()).toBe(0);
    });

    it("refuses a password spread over several lines of stdin", async () => {
      const result = await run(["create", "maria"], {
        stdin: `${PASSWORD}\n${PASSWORD}\n`,
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("single line");
      expect(userCount()).toBe(0);
    });
  });

  describe("promote", () => {
    beforeEach(async () => {
      await run(["create", "maria"], { stdin: PASSWORD });
    });

    it("makes an existing account a platform operator, and says so", async () => {
      const result = await run(["promote", "maria"]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Promoted maria to platform operator");
      expect(user("maria")!.is_platform_operator).toBe(1);
    });

    it("says nothing changed the second time", async () => {
      await run(["promote", "maria"]);

      const again = await run(["promote", "maria"]);

      expect(again.code).toBe(0);
      expect(again.stdout).toContain("already a platform operator");
    });

    it("refuses a username nobody holds", async () => {
      const result = await run(["promote", "nobody"]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("No account has that username");
    });

    it("refuses a disabled account", async () => {
      const db = open();
      db.prepare("UPDATE users SET is_active = 0").run();
      db.close();

      const result = await run(["promote", "maria"]);

      expect(result.code).toBe(1);
      expect(user("maria")!.is_platform_operator).toBe(0);
    });

    it("takes no password and no options", async () => {
      const result = await run(["promote", "maria", "--platform-operator"]);

      expect(result.code).toBe(2);
      expect(user("maria")!.is_platform_operator).toBe(0);
    });
  });

  describe("asked for nothing it understands", () => {
    it("prints how to use it and exits 2", async () => {
      const result = await run([]);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain("bun run account create <username>");
    });

    it("prints how to use it on stdout, and exits 0, when asked to", async () => {
      const result = await run(["--help"]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("bun run account promote <username>");
    });

    it("refuses a command it does not have", async () => {
      const result = await run(["delete", "maria"]);

      expect(result.code).toBe(2);
    });
  });

  describe.skipIf(process.platform === "win32")("on a terminal", () => {
    it("asks for the password twice and never shows it", async () => {
      const { code, screen } = await runOnTerminal(
        ["create", "maria"],
        [
          ["Password:", `${PASSWORD}\r`],
          ["Confirm password:", `${PASSWORD}\r`],
        ],
      );

      expect(code).toBe(0);
      expect(screen).toContain("Created maria");
      expect(screen).not.toContain(PASSWORD);
      expect(bcrypt.compareSync(PASSWORD, user("maria")!.password_hash)).toBe(
        true,
      );
    });

    it("honours backspace", async () => {
      const { code } = await runOnTerminal(
        ["create", "maria"],
        [
          ["Password:", `${PASSWORD}xyz\x7f\x7f\x7f\r`],
          ["Confirm password:", `${PASSWORD}\r`],
        ],
      );

      expect(code).toBe(0);
      expect(bcrypt.compareSync(PASSWORD, user("maria")!.password_hash)).toBe(
        true,
      );
    });

    it("refuses two passwords that differ", async () => {
      const { code, screen } = await runOnTerminal(
        ["create", "maria"],
        [
          ["Password:", `${PASSWORD}\r`],
          ["Confirm password:", `${PASSWORD}-different\r`],
        ],
      );

      expect(code).toBe(1);
      expect(screen).toContain("do not match");
      expect(userCount()).toBe(0);
    });

    it("stops on Ctrl-C without creating anything", async () => {
      const { code } = await runOnTerminal(
        ["create", "maria"],
        [["Password:", "\x03"]],
      );

      expect(code).toBe(1);
      expect(userCount()).toBe(0);
    });

    it("does not ask for a password it would have to throw away", async () => {
      await run(["create", "maria"], { stdin: PASSWORD });

      const { code, screen } = await runOnTerminal(["create", "maria"], []);

      expect(code).toBe(1);
      expect(screen).not.toContain("Password:");
      expect(screen).toContain("taken");
    });
  });
});
