/** Creating and promoting accounts. Each refused create or promote also checks that nothing was written. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import bcrypt from "bcryptjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase } from "../src/db/init.ts";
import {
  accountsOn,
  type AccountErrorReason,
} from "../src/domains/accounts/index.ts";
import { membershipsOn, tenantsOn } from "../src/domains/tenants/index.ts";
import type { Result } from "../src/shared/result/index.ts";
import { createTestDatabase } from "./helpers/database.ts";

const PASSWORD = "a-long-enough-password";
const OPERATOR = { name: "operator", uid: 1000 };

describe("accounts", () => {
  let dir: string;
  let db: Database;
  let accounts: ReturnType<typeof accountsOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-accounts-"));
    db = createTestDatabase(join(dir, "accounts.sqlite"));
    db.run("PRAGMA foreign_keys = ON;");
    initializeDatabase(db);
    accounts = accountsOn(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function tenant(slug: string): string {
    return tenantsOn(db).create({ slug, name: slug }).id;
  }

  function userCount(): number {
    return (
      db.prepare("SELECT COUNT(*) as count FROM users").get() as {
        count: number;
      }
    ).count;
  }

  function user(username: string) {
    return (
      (db.prepare("SELECT * FROM users WHERE username = ?").get(username) as {
        id: string;
        role: string;
        name: string;
        password_hash: string;
        is_platform_operator: number;
        is_active: number | null;
        created_by: string | null;
      } | null) ?? undefined
    );
  }

  function operators(): string[] {
    return (
      db
        .prepare(
          "SELECT username FROM users WHERE is_platform_operator = 1 ORDER BY username",
        )
        .all() as Array<{ username: string }>
    ).map((row) => row.username);
  }

  function reasonOf<T>(result: Result<T, { reason: AccountErrorReason }>) {
    return result.ok ? null : result.error.reason;
  }

  describe("creating an account", () => {
    it("makes an admin of the only tenant, with a membership there", () => {
      const tenantId = tenant("totem");

      const result = accounts.create(
        { username: "maria", password: PASSWORD },
        OPERATOR,
      );

      expect(result.ok).toBe(true);
      const row = user("maria")!;
      expect(row.role).toBe("admin");
      expect(row.is_platform_operator).toBe(0);
      expect(row.created_by).toBeNull();
      expect(membershipsOn(db).roleFor(tenantId, row.id)).toBe("admin");
    });

    it("tells the caller which tenant it joined", () => {
      const tenantId = tenant("totem");

      const result = accounts.create(
        { username: "maria", password: PASSWORD },
        OPERATOR,
      );

      expect(result.ok && result.value.tenant).toEqual({
        id: tenantId,
        slug: "totem",
      });
    });

    it("stores a hash of the password, never the password", () => {
      tenant("totem");

      accounts.create({ username: "maria", password: PASSWORD }, OPERATOR);

      const { password_hash } = user("maria")!;
      expect(password_hash).not.toContain(PASSWORD);
      expect(bcrypt.compareSync(PASSWORD, password_hash)).toBe(true);
    });

    it("names the account after its username unless given a display name", () => {
      tenant("totem");

      accounts.create({ username: "maria", password: PASSWORD }, OPERATOR);
      accounts.create(
        {
          username: "juan",
          password: PASSWORD,
          name: "Juan Pérez",
        },
        OPERATOR,
      );

      expect(user("maria")!.name).toBe("maria");
      expect(user("juan")!.name).toBe("Juan Pérez");
    });

    it("makes a platform operator with no membership", () => {
      tenant("totem");

      const result = accounts.create(
        {
          username: "vendeya-staff",
          password: PASSWORD,
          platformOperator: true,
        },
        OPERATOR,
      );

      expect(result.ok && result.value.isPlatformOperator).toBe(true);
      expect(result.ok && result.value.tenant).toBeNull();
      expect(user("vendeya-staff")!.is_platform_operator).toBe(1);
      expect(
        db.prepare("SELECT COUNT(*) as count FROM tenant_memberships").get(),
      ).toEqual({ count: 0 });
    });

    it("makes a platform operator where there is no tenant at all", () => {
      const result = accounts.create(
        {
          username: "vendeya-staff",
          password: PASSWORD,
          platformOperator: true,
        },
        OPERATOR,
      );

      expect(result.ok).toBe(true);
      expect(operators()).toEqual(["vendeya-staff"]);
    });

    describe("with several tenants", () => {
      let alpha: string;
      let beta: string;

      beforeEach(() => {
        alpha = tenant("alpha");
        beta = tenant("beta");
      });

      it("joins the tenant it is told to", () => {
        const result = accounts.create(
          {
            username: "maria",
            password: PASSWORD,
            tenantId: beta,
          },
          OPERATOR,
        );

        expect(result.ok).toBe(true);
        const { id } = user("maria")!;
        expect(membershipsOn(db).roleFor(beta, id)).toBe("admin");
        expect(membershipsOn(db).roleFor(alpha, id)).toBeNull();
      });

      it("is refused without one, and the refusal lists them", () => {
        const request = { username: "maria", password: PASSWORD };
        const result = accounts.create(request, OPERATOR);

        expect(reasonOf(result)).toBe("tenant_required");
        expect(!result.ok && result.error.message).toContain(alpha);
        expect(!result.ok && result.error.message).toContain(beta);
        expect(user("maria")).toBeUndefined();
      });
    });

    it("refuses a tenant that does not exist", () => {
      tenant("totem");

      const result = accounts.create(
        {
          username: "maria",
          password: PASSWORD,
          tenantId: "tn-nowhere",
        },
        OPERATOR,
      );

      expect(reasonOf(result)).toBe("unknown_tenant");
      expect(userCount()).toBe(0);
    });

    it("refuses a database with no tenant to join", () => {
      const result = accounts.create(
        { username: "maria", password: PASSWORD },
        OPERATOR,
      );

      expect(reasonOf(result)).toBe("no_tenant");
      expect(userCount()).toBe(0);
    });

    it("refuses to be both a platform operator and a member of a tenant", () => {
      const tenantId = tenant("totem");

      const result = accounts.create(
        {
          username: "maria",
          password: PASSWORD,
          platformOperator: true,
          tenantId,
        },
        OPERATOR,
      );

      expect(reasonOf(result)).toBe("conflicting_scope");
      expect(userCount()).toBe(0);
    });

    describe("the password", () => {
      it("is refused under 12 characters, and nothing is written", () => {
        tenant("totem");

        const result = accounts.create(
          {
            username: "maria",
            password: "x".repeat(11),
          },
          OPERATOR,
        );

        expect(reasonOf(result)).toBe("password_too_short");
        expect(userCount()).toBe(0);
        expect(
          db.prepare("SELECT COUNT(*) as count FROM tenant_memberships").get(),
        ).toEqual({ count: 0 });
      });

      it("is accepted at exactly 12", () => {
        tenant("totem");

        const result = accounts.create(
          {
            username: "maria",
            password: "x".repeat(12),
          },
          OPERATOR,
        );

        expect(result.ok).toBe(true);
      });
    });

    describe("a username that is taken", () => {
      beforeEach(() => {
        tenant("totem");
        accounts.create({ username: "maria", password: PASSWORD }, OPERATOR);
      });

      it("is refused, and the account that holds it is untouched", () => {
        const before = user("maria")!;

        const result = accounts.create(
          {
            username: "maria",
            password: "a-different-password",
            platformOperator: true,
          },
          OPERATOR,
        );

        expect(reasonOf(result)).toBe("username_taken");
        expect(user("maria")).toEqual(before);
        expect(userCount()).toBe(1);
      });

      it("is refused by the check made before a password is asked for", () => {
        expect(reasonOf(accounts.checkNew({ username: "maria" }))).toBe(
          "username_taken",
        );
        expect(accounts.checkNew({ username: "juan" }).ok).toBe(true);
      });
    });

    it("refuses an empty username or one wrapped in whitespace", () => {
      tenant("totem");

      for (const username of ["", "   ", " maria", "maria "]) {
        expect(
          reasonOf(accounts.create({ username, password: PASSWORD }, OPERATOR)),
        ).toBe("invalid_username");
      }
      expect(userCount()).toBe(0);
    });

    it("checks everything but the password before one exists", () => {
      const alpha = tenant("alpha");
      tenant("beta");

      expect(reasonOf(accounts.checkNew({ username: "maria" }))).toBe(
        "tenant_required",
      );
      expect(accounts.checkNew({ username: "maria", tenantId: alpha }).ok).toBe(
        true,
      );
      expect(
        accounts.checkNew({ username: "maria", platformOperator: true }).ok,
      ).toBe(true);
      expect(userCount()).toBe(0);
    });
  });

  describe("promoting an account", () => {
    let tenantId: string;

    beforeEach(() => {
      tenantId = tenant("totem");
      accounts.create({ username: "maria", password: PASSWORD }, OPERATOR);
      accounts.create({ username: "juan", password: PASSWORD }, OPERATOR);
    });

    it("makes an existing account a platform operator", () => {
      const result = accounts.promote("maria", OPERATOR);

      expect(result.ok && result.value).toMatchObject({
        username: "maria",
        changed: true,
      });
      expect(operators()).toEqual(["maria"]);
    });

    it("keeps the account's tenant membership", () => {
      accounts.promote("maria", OPERATOR);

      expect(membershipsOn(db).roleFor(tenantId, user("maria")!.id)).toBe(
        "admin",
      );
    });

    it("leaves every other account alone", () => {
      accounts.promote("maria", OPERATOR);

      expect(user("juan")!.is_platform_operator).toBe(0);
    });

    it("changes nothing the second time, and says so", () => {
      accounts.promote("maria", OPERATOR);

      const again = accounts.promote("maria", OPERATOR);

      expect(again.ok && again.value.changed).toBe(false);
      expect(operators()).toEqual(["maria"]);
    });

    it("is refused for a username nobody holds", () => {
      const result = accounts.promote("nobody", OPERATOR);

      expect(reasonOf(result)).toBe("not_found");
      expect(operators()).toEqual([]);
    });

    it("is refused for a disabled account", () => {
      db.prepare(
        "UPDATE users SET is_active = 0 WHERE username = 'maria'",
      ).run();

      const result = accounts.promote("maria", OPERATOR);

      expect(reasonOf(result)).toBe("inactive");
      expect(operators()).toEqual([]);
    });

    it("counts an account whose active flag was never set as active", () => {
      db.prepare(
        "UPDATE users SET is_active = NULL WHERE username = 'maria'",
      ).run();

      expect(accounts.promote("maria", OPERATOR).ok).toBe(true);
      expect(operators()).toEqual(["maria"]);
    });
  });

  describe("the audit trail", () => {
    type AuditRow = {
      tenant_id: string | null;
      user_id: string | null;
      actor: string;
      action: string;
      resource_type: string;
      resource_id: string | null;
      metadata: string;
    };

    function auditRows(): AuditRow[] {
      return db
        .prepare("SELECT * FROM audit_log ORDER BY created_at, rowid")
        .all() as AuditRow[];
    }

    it("records a created admin under the operator and the tenant it joined", () => {
      const tenantId = tenant("totem");

      const result = accounts.create(
        { username: "maria", password: PASSWORD },
        OPERATOR,
      );

      const [row, ...rest] = auditRows();
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        tenant_id: tenantId,
        user_id: null,
        actor: `cli:${OPERATOR.name}`,
        action: "create_user",
        resource_type: "user",
        resource_id: result.ok ? result.value.id : null,
      });
      expect(JSON.parse(row!.metadata)).toEqual({
        username: "maria",
        role: "admin",
        platformOperator: false,
        uid: OPERATOR.uid,
      });
    });

    it("stores the name the environment gave and the uid it could not change", () => {
      tenant("totem");
      const spoofed = { name: "alice", uid: 1000 };

      accounts.create({ username: "maria", password: PASSWORD }, spoofed);
      accounts.promote("maria", spoofed);

      const rows = auditRows();
      expect(rows.map((row) => row.actor)).toEqual(["cli:alice", "cli:alice"]);
      expect(rows.map((row) => JSON.parse(row.metadata).uid)).toEqual([
        1000, 1000,
      ]);
    });

    it("records a created platform operator with no tenant", () => {
      tenant("totem");

      accounts.create(
        { username: "staff", password: PASSWORD, platformOperator: true },
        OPERATOR,
      );

      const [row, ...rest] = auditRows();
      expect(rest).toEqual([]);
      expect(row!.tenant_id).toBeNull();
      expect(JSON.parse(row!.metadata)).toEqual({
        username: "staff",
        platformOperator: true,
        uid: OPERATOR.uid,
      });
    });

    it("never records the password", () => {
      tenant("totem");

      accounts.create({ username: "maria", password: PASSWORD }, OPERATOR);

      const stored = JSON.stringify(auditRows());
      expect(stored).not.toContain(PASSWORD);
      expect(stored).not.toContain(user("maria")!.password_hash);
    });

    it("writes nothing when the password is too short", () => {
      tenant("totem");

      accounts.create({ username: "maria", password: "short" }, OPERATOR);

      expect(auditRows()).toEqual([]);
    });

    it("writes nothing when the username is taken", () => {
      tenant("totem");
      accounts.create({ username: "maria", password: PASSWORD }, OPERATOR);

      accounts.create({ username: "maria", password: PASSWORD }, OPERATOR);

      expect(auditRows()).toHaveLength(1);
    });

    it("writes nothing when the tenant is refused", () => {
      accounts.create({ username: "maria", password: PASSWORD }, OPERATOR);

      expect(auditRows()).toEqual([]);
    });

    it("rolls the account back when its row cannot be written", () => {
      tenant("totem");
      db.run("DROP TABLE audit_log");

      expect(() =>
        accounts.create({ username: "maria", password: PASSWORD }, OPERATOR),
      ).toThrow();
      expect(user("maria")).toBeUndefined();
    });

    describe("on promotion", () => {
      beforeEach(() => {
        tenant("totem");
        accounts.create({ username: "maria", password: PASSWORD }, OPERATOR);
        db.run("DELETE FROM audit_log");
      });

      it("records one row, in no tenant even though the account belongs to one", () => {
        accounts.promote("maria", OPERATOR);

        const [row, ...rest] = auditRows();
        expect(rest).toEqual([]);
        expect(row).toMatchObject({
          tenant_id: null,
          user_id: null,
          actor: `cli:${OPERATOR.name}`,
          action: "promote_platform_operator",
          resource_type: "user",
          resource_id: user("maria")!.id,
        });
        expect(JSON.parse(row!.metadata)).toEqual({
          username: "maria",
          platformOperator: true,
          uid: OPERATOR.uid,
        });
      });

      it("records no tenant for an account that belongs to several either", () => {
        membershipsOn(db).upsert({
          tenantId: tenant("other"),
          userId: user("maria")!.id,
          role: "admin",
          createdBy: null,
        });

        accounts.promote("maria", OPERATOR);

        expect(auditRows().map((row) => row.tenant_id)).toEqual([null]);
      });

      it("writes nothing when the account was already a platform operator", () => {
        accounts.promote("maria", OPERATOR);
        db.run("DELETE FROM audit_log");

        accounts.promote("maria", OPERATOR);

        expect(auditRows()).toEqual([]);
      });

      it("writes nothing for an unknown or disabled account", () => {
        accounts.promote("nobody", OPERATOR);
        db.prepare("UPDATE users SET is_active = 0").run();
        accounts.promote("maria", OPERATOR);

        expect(auditRows()).toEqual([]);
      });

      it("leaves the account unpromoted when its row cannot be written", () => {
        db.run("DROP TABLE audit_log");

        expect(() => accounts.promote("maria", OPERATOR)).toThrow();
        expect(user("maria")!.is_platform_operator).toBe(0);
      });
    });
  });

  describe("knowing whether anybody holds the platform operator's powers", () => {
    beforeEach(() => {
      tenant("totem");
    });

    it("is no for a database of ordinary accounts", () => {
      accounts.create({ username: "maria", password: PASSWORD }, OPERATOR);

      expect(accounts.hasPlatformOperator()).toBe(false);
    });

    it("is yes once one is created", () => {
      accounts.create(
        {
          username: "staff",
          password: PASSWORD,
          platformOperator: true,
        },
        OPERATOR,
      );

      expect(accounts.hasPlatformOperator()).toBe(true);
    });

    it("is yes once an account is promoted", () => {
      accounts.create({ username: "maria", password: PASSWORD }, OPERATOR);
      accounts.promote("maria", OPERATOR);

      expect(accounts.hasPlatformOperator()).toBe(true);
    });

    it("is no when the only operator is disabled", () => {
      accounts.create(
        {
          username: "staff",
          password: PASSWORD,
          platformOperator: true,
        },
        OPERATOR,
      );
      db.prepare("UPDATE users SET is_active = 0").run();

      expect(accounts.hasPlatformOperator()).toBe(false);
    });
  });
});
