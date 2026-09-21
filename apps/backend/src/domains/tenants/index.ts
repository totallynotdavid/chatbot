import type { Database } from "bun:sqlite";
import { db } from "../../db/index.ts";
import { queriesOn } from "../../db/query.ts";
import type { Tenant, TenantMembership, TenantRole } from "@vendeya/types";

export const TENANT_ROLES: TenantRole[] = [
  "admin",
  "developer",
  "supervisor",
  "sales_agent",
];

export function isTenantRole(role: string): role is TenantRole {
  return (TENANT_ROLES as string[]).includes(role);
}

/**
 * Tenant reads and writes bound to one connection. The seeds and the account
 * command receive their own database (a temporary file in tests) and bind it
 * here. Other code uses `TenantService` below.
 */
export function tenantsOn(database: Database) {
  const { getAll, getOne } = queriesOn(database);

  const service = {
    getAll: (): Tenant[] =>
      getAll<Tenant>("SELECT * FROM tenants ORDER BY name"),

    getById: (id: string): Tenant | null =>
      getOne<Tenant>("SELECT * FROM tenants WHERE id = ?", [id]) ?? null,

    getBySlug: (slug: string): Tenant | null =>
      getOne<Tenant>("SELECT * FROM tenants WHERE slug = ?", [slug]) ?? null,

    /**
     * Whether the tenant is open for access. Suspension closes a business to
     * everyone, platform operators included, and a missing tenant is closed too.
     * `canAccessTenant` in platform/auth/scope.ts applies it to unpinned callers.
     */
    isOpen: (id: string): boolean =>
      getOne<{ status: string }>("SELECT status FROM tenants WHERE id = ?", [
        id,
      ])?.status === "active",

    create: (data: { slug: string; name: string; id?: string }): Tenant => {
      const id = data.id ?? crypto.randomUUID();
      database
        .prepare(
          "INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, ?, 'active')",
        )
        .run(id, data.slug, data.name);
      return service.getById(id)!;
    },

    count: (): number =>
      getOne<{ count: number }>("SELECT COUNT(*) as count FROM tenants")!.count,
  };

  return service;
}

/** Memberships bound to one connection. See `tenantsOn`. */
export function membershipsOn(database: Database) {
  const { getAll, getOne } = queriesOn(database);

  const service = {
    /** Open tenants the user belongs to, with the role they hold in each. */
    listForUser: (userId: string): Array<Tenant & { role: TenantRole }> =>
      getAll<Tenant & { role: TenantRole }>(
        `SELECT t.*, m.role as role
         FROM tenant_memberships m
         JOIN tenants t ON t.id = m.tenant_id
         WHERE m.user_id = ? AND t.status = 'active'
         ORDER BY t.name`,
        [userId],
      ),

    /**
     * How many tenants a user belongs to, counting suspended ones. Callers use
     * it where a change to the global user record would reach beyond the acting
     * tenant. A suspended tenant still counts because it can be reactivated.
     */
    countForUser: (userId: string): number =>
      getOne<{ count: number }>(
        "SELECT COUNT(*) as count FROM tenant_memberships WHERE user_id = ?",
        [userId],
      )!.count,

    listForTenant: (tenantId: string): TenantMembership[] =>
      getAll<TenantMembership>(
        "SELECT * FROM tenant_memberships WHERE tenant_id = ? ORDER BY created_at",
        [tenantId],
      ),

    get: (tenantId: string, userId: string): TenantMembership | null =>
      getOne<TenantMembership>(
        "SELECT * FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?",
        [tenantId, userId],
      ) ?? null,

    /** The role a user holds in a tenant, or null if they are not a member. */
    roleFor: (tenantId: string, userId: string): TenantRole | null =>
      service.get(tenantId, userId)?.role ?? null,

    /**
     * Create or re-role a membership. `is_available` is deliberately left
     * alone: it is the agent's own switch inside this tenant, not something a
     * role change should reset.
     */
    upsert: (data: {
      tenantId: string;
      userId: string;
      role: TenantRole;
      createdBy?: string | null;
    }): TenantMembership => {
      const existing = service.get(data.tenantId, data.userId);

      if (existing) {
        database
          .prepare(
            "UPDATE tenant_memberships SET role = ? WHERE tenant_id = ? AND user_id = ?",
          )
          .run(data.role, data.tenantId, data.userId);
      } else {
        database
          .prepare(
            `INSERT INTO tenant_memberships (id, tenant_id, user_id, role, created_by)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            crypto.randomUUID(),
            data.tenantId,
            data.userId,
            data.role,
            data.createdBy ?? null,
          );
      }

      return service.get(data.tenantId, data.userId)!;
    },

    /**
     * Whether the agent is taking new conversations in this tenant. Availability
     * belongs to the membership, not the account: a sales agent who works for
     * two businesses can go offline for one and stay in the other's rotation.
     * Returns false when there is no membership to set it on.
     */
    setAvailability: (
      tenantId: string,
      userId: string,
      isAvailable: boolean,
    ): boolean => {
      const changed = database
        .prepare(
          "UPDATE tenant_memberships SET is_available = ? WHERE tenant_id = ? AND user_id = ?",
        )
        .run(isAvailable ? 1 : 0, tenantId, userId);

      return changed.changes > 0;
    },

    remove: (tenantId: string, userId: string): void => {
      database
        .prepare(
          "DELETE FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?",
        )
        .run(tenantId, userId);
    },
  };

  return service;
}

export const TenantService = tenantsOn(db);
export const MembershipService = membershipsOn(db);
