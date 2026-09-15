import { Hono } from "hono";
import { pathParam } from "../lib/http.ts";
import { PeriodService } from "../domains/catalog/periods.ts";
import { logAction } from "../platform/audit/logger.ts";
import {
  activeTenantId,
  requireActiveTenant,
  requireRole,
  requireTenantScope,
} from "../middleware/auth.ts";

const periods = new Hono();

const requireCatalogWrite = requireRole("admin", "developer", "supervisor");

periods.use("/*", requireTenantScope);

// List all periods
periods.get("/", (c) => {
  return c.json(PeriodService.getAll(c.get("scope").tenantId));
});

// Get active period
periods.get("/active", requireActiveTenant, (c) => {
  const period = PeriodService.getActive(activeTenantId(c));
  if (!period) {
    return c.json({ error: "No hay período activo" }, 404);
  }
  return c.json(period);
});

// Get period by ID
periods.get("/:id", (c) => {
  const id = pathParam(c, "id");
  const period = PeriodService.getById(c.get("scope").tenantId, id);
  if (!period) {
    return c.json({ error: "Período no encontrado" }, 404);
  }
  return c.json(period);
});

// Create new period
periods.post("/", requireActiveTenant, requireCatalogWrite, async (c) => {
  const user = c.get("user");
  const tenantId = activeTenantId(c);
  const { name, year_month } = await c.req.json();

  if (!name || !year_month) {
    return c.json({ error: "name y year_month son requeridos" }, 400);
  }

  // Validate year_month format (YYYY-MM)
  if (!/^\d{4}-\d{2}$/.test(year_month)) {
    return c.json({ error: "year_month debe tener formato YYYY-MM" }, 400);
  }

  // Uniqueness is per tenant: another business may already run this month.
  const existing = PeriodService.getByYearMonth(tenantId, year_month);
  if (existing) {
    return c.json({ error: "Ya existe un período para ese mes" }, 400);
  }

  const period = PeriodService.create({
    tenantId,
    name,
    year_month,
    created_by: user.id,
  });

  logAction(
    { userId: user.id, tenantId },
    "create_period",
    "period",
    period.id,
    { name, year_month },
  );

  return c.json(period, 201);
});

// Update period status (publish/archive)
periods.patch(
  "/:id/status",
  requireActiveTenant,
  requireCatalogWrite,
  async (c) => {
    const id = pathParam(c, "id");
    const user = c.get("user");
    const tenantId = activeTenantId(c);
    const { status } = await c.req.json();

    if (!["draft", "active", "archived"].includes(status)) {
      return c.json({ error: "Estado inválido" }, 400);
    }

    const period = PeriodService.getById(tenantId, id);
    if (!period) {
      return c.json({ error: "Período no encontrado" }, 404);
    }

    // Cannot revert archived to draft
    if (period.status === "archived" && status === "draft") {
      return c.json(
        { error: "No se puede revertir un período archivado a borrador" },
        400,
      );
    }

    const updated = PeriodService.updateStatus(tenantId, id, status);

    logAction(
      { userId: user.id, tenantId },
      "update_period_status",
      "period",
      id,
      { old_status: period.status, new_status: status },
    );

    return c.json(updated);
  },
);

// Delete period (only draft, no products)
periods.delete("/:id", requireActiveTenant, requireCatalogWrite, (c) => {
  const id = pathParam(c, "id");
  const user = c.get("user");
  const tenantId = activeTenantId(c);

  const result = PeriodService.delete(tenantId, id);

  if (!result.success) {
    return c.json({ error: result.message }, 400);
  }

  logAction({ userId: user.id, tenantId }, "delete_period", "period", id);
  return c.json({ success: true });
});

export default periods;
