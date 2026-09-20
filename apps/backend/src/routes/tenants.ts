import { Hono } from "hono";
import { pathParam } from "../lib/http.ts";
import { getOne } from "../db/query.ts";
import {
  MembershipService,
  TenantService,
  isTenantRole,
} from "../domains/tenants/index.ts";
import { setSessionTenant } from "../platform/auth/session.ts";
import { logAction } from "../platform/audit/logger.ts";
import { requirePlatformOperator } from "../middleware/auth.ts";

const tenants = new Hono();

/** Tenants the caller can see, with the caller's role in each. */
tenants.get("/", (c) => {
  const scope = c.get("scope");

  // A platform operator sees every tenant, suspended ones included, because
  // supporting them is the job.
  if (scope.isPlatformOperator) {
    return c.json({
      tenants: TenantService.getAll().map((t) => ({ ...t, role: null })),
      isPlatformOperator: true,
      activeTenantId: scope.tenantId,
    });
  }

  return c.json({
    tenants: MembershipService.listForUser(scope.userId),
    isPlatformOperator: false,
    activeTenantId: scope.tenantId,
  });
});

/** Repoint the session at a tenant. */
tenants.post("/active", async (c) => {
  const scope = c.get("scope");
  const session = c.get("session");
  const { tenantId } = await c.req.json();

  // Passing null returns a platform operator to unscoped, cross-tenant reads.
  if (tenantId === null || tenantId === undefined) {
    if (!scope.isPlatformOperator) {
      return c.json(
        { error: "Only platform operators may act without a tenant" },
        403,
      );
    }
    setSessionTenant(session.id, null);
    return c.json({ activeTenantId: null });
  }

  if (typeof tenantId !== "string") {
    return c.json({ error: "tenantId must be a string or null" }, 400);
  }

  const tenant = TenantService.getById(tenantId);
  if (!tenant || tenant.status !== "active") {
    return c.json({ error: "Tenant not found" }, 404);
  }

  // Membership is checked here rather than trusted from the request. A
  // platform operator may select any open tenant.
  const role = MembershipService.roleFor(tenantId, scope.userId);

  if (!role && !scope.isPlatformOperator) {
    // Do not distinguish "no such tenant" from "not yours".
    return c.json({ error: "Tenant not found" }, 404);
  }

  setSessionTenant(session.id, tenantId);

  logAction(
    { userId: scope.userId, tenantId },
    "select_tenant",
    "tenant",
    tenantId,
    { asPlatformOperator: scope.isPlatformOperator && !role },
  );

  return c.json({ activeTenantId: tenantId, role });
});

tenants.post("/", requirePlatformOperator, async (c) => {
  const scope = c.get("scope");
  const { slug, name } = await c.req.json();

  if (!slug || !name) {
    return c.json({ error: "slug and name are required" }, 400);
  }

  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    return c.json(
      { error: "slug must be lowercase alphanumeric with dashes" },
      400,
    );
  }

  if (TenantService.getBySlug(slug)) {
    return c.json({ error: "A tenant with that slug already exists" }, 409);
  }

  const tenant = TenantService.create({ slug, name });

  logAction(
    { userId: scope.userId, tenantId: tenant.id },
    "create_tenant",
    "tenant",
    tenant.id,
    { slug, name },
  );

  return c.json(tenant, 201);
});

tenants.post("/:id/members", requirePlatformOperator, async (c) => {
  const scope = c.get("scope");
  const tenantId = pathParam(c, "id");
  const { userId, role } = await c.req.json();

  if (!userId || !isTenantRole(role)) {
    return c.json({ error: "userId and a valid role are required" }, 400);
  }

  if (!TenantService.getById(tenantId)) {
    return c.json({ error: "Tenant not found" }, 404);
  }

  if (!getOne<{ id: string }>("SELECT id FROM users WHERE id = ?", [userId])) {
    return c.json({ error: "User not found" }, 404);
  }

  const membership = MembershipService.upsert({
    tenantId,
    userId,
    role,
    createdBy: scope.userId,
  });

  logAction(
    { userId: scope.userId, tenantId },
    "grant_membership",
    "user",
    userId,
    { role },
  );

  return c.json(membership, 201);
});

export default tenants;
