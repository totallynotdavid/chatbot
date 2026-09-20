/**
 * GET /api/providers/:dni returns one person's credit standing and spends the
 * providers' quota, so it answers VendeYa's own staff and nobody else.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Hono } from "hono";
import { db } from "../src/db/index.ts";
import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { requireAuth } from "../src/middleware/auth.ts";
import { errorHandler } from "../src/middleware/error.ts";
import { eligibilityHandler } from "../src/bootstrap/index.ts";
import { Ok } from "../src/shared/result/index.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import providerRoutes from "../src/routes/providers.ts";

const DNI = "12345678";
const ELIGIBILITY = { eligible: true, marker: "stubbed-provider-result" };

/** Mounted the way index.ts mounts it: behind the global session check. */
function buildApp() {
  const app = new Hono();
  app.use("/api/*", requireAuth);
  app.route("/api/providers", providerRoutes);
  app.onError(errorHandler);
  return app;
}

function login(userId: string, activeTenantId: string | null): string {
  const token = generateSessionToken();
  createSession(token, userId, activeTenantId);
  return `session=${token}`;
}

function createPlatformOperator(): string {
  const userId = `u-${crypto.randomUUID()}`;
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, name, is_platform_operator)
     VALUES (?, ?, 'x', 'admin', 'Operator', 1)`,
  ).run(userId, `operator-${userId.slice(2, 10)}`);
  return userId;
}

describe("provider lookup", () => {
  let app: ReturnType<typeof buildApp>;
  let tenant: TenantFixture;
  let execute: ReturnType<typeof spyOn>;

  beforeEach(() => {
    applySchema();
    app = buildApp();
    tenant = createTenantFixture("provider-lookup");
    execute = spyOn(eligibilityHandler, "execute").mockResolvedValue(
      Ok(ELIGIBILITY) as never,
    );
  });

  afterEach(() => {
    execute.mockRestore();
    dropTenantFixture(tenant);
  });

  function lookup(cookie: string | null, dni = DNI) {
    return app.request(`/api/providers/${dni}`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
  }

  it("answers a platform operator with the provider result", async () => {
    const response = await lookup(login(createPlatformOperator(), null));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.dni).toBe(DNI);
    expect(body.result).toEqual(ELIGIBILITY);
    expect(Array.isArray(body.providersChecked)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("keeps the 400 for a DNI that is not 8 digits", async () => {
    const response = await lookup(login(createPlatformOperator(), null), "123");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "DNI debe tener 8 dígitos",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a tenant admin with 403 and asks no provider", async () => {
    const admin = createMember(tenant, "admin");

    const response = await lookup(login(admin.userId, tenant.tenantId));

    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a sales agent with 403 and asks no provider", async () => {
    const agent = createMember(tenant, "sales_agent");

    const response = await lookup(login(agent.userId, tenant.tenantId));

    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a caller with no session with 401 and asks no provider", async () => {
    const response = await lookup(null);

    expect(response.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
});
