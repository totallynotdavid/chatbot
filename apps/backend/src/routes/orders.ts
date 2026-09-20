import { Hono } from "hono";
import { limaRangeEdge } from "../db/query.ts";
import { pathParam, queryLimit, queryOffset } from "../lib/http.ts";
import * as ordersModule from "../domains/orders/orders.ts";
import { logAction } from "../platform/audit/logger.ts";
import {
  activeTenantId,
  requireActiveTenant,
  requireTenantScope,
} from "../middleware/auth.ts";
import { lookupConversation } from "../domains/conversations/read.ts";
import { refOf } from "../conversation/store.ts";

const app = new Hono();

app.use("/*", requireTenantScope);

// Role validation helper for order status transitions
function canUpdateOrderStatus(
  userRole: string | null,
  newStatus: string,
): { allowed: boolean; reason?: string } {
  // Supervisor-level approvals: admin or supervisor
  if (
    newStatus === "supervisor_approved" ||
    newStatus === "supervisor_rejected"
  ) {
    if (userRole === "admin" || userRole === "supervisor") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Solo supervisores pueden aprobar/rechazar a nivel supervisor",
    };
  }

  // Calidda-level approvals: admin only
  if (newStatus === "calidda_approved" || newStatus === "calidda_rejected") {
    if (userRole === "admin") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Solo administradores pueden aprobar/rechazar a nivel Calidda",
    };
  }

  // Mark as delivered: admin or supervisor
  if (newStatus === "delivered") {
    if (userRole === "admin" || userRole === "supervisor") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Solo supervisores pueden marcar como entregado",
    };
  }

  return { allowed: false, reason: "Transición de estado no permitida" };
}

// Get order metrics
app.get("/metrics", async (c) => {
  const metrics = ordersModule.getOrderMetrics(c.get("scope").tenantId);
  return c.json(metrics);
});

// Create order
app.post("/", requireActiveTenant, async (c) => {
  const body = await c.req.json();
  const user = c.get("user");
  const scope = c.get("scope");

  // The order belongs to the conversation it came from, which fixes both the
  // tenant and the channel account. A phone number alone is not enough.
  const lookup = lookupConversation(
    scope,
    body.conversationPhone,
    body.channelAccountId ?? null,
  );

  if (lookup.status === "ambiguous") {
    return c.json(
      {
        error: "Ambiguous conversation",
        detail:
          "This contact is talking to more than one of your numbers; pass channelAccountId",
      },
      409,
    );
  }

  if (lookup.status === "not_found") {
    return c.json({ error: "Conversation not found" }, 404);
  }

  const order = ordersModule.createOrder({
    ref: refOf(lookup.conversation),
    clientName: body.clientName,
    clientDni: body.clientDni,
    products: body.products,
    totalAmount: body.totalAmount,
    deliveryAddress: body.deliveryAddress,
    deliveryReference: body.deliveryReference,
    assignedAgent: user?.id,
  });

  return c.json(order, 201);
});

// Get all orders with filters
app.get("/", async (c) => {
  const status = c.req.query("status");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const startMs = startDate
    ? limaRangeEdge(startDate, "start", "startDate")
    : undefined;
  const endMs = endDate ? limaRangeEdge(endDate, "end", "endDate") : undefined;
  const assignedAgent = c.req.query("assignedAgent");
  const limit = queryLimit(c, 50);
  const offset = queryOffset(c);

  const ordersData = ordersModule.getOrders(c.get("scope").tenantId, {
    status,
    startMs,
    endMs,
    assignedAgent,
    limit,
    offset,
  });

  return c.json(ordersData);
});

// Get order by conversation phone
app.get("/by-conversation/:phone", async (c) => {
  const lookup = lookupConversation(
    c.get("scope"),
    pathParam(c, "phone"),
    c.req.query("channel") ?? null,
  );

  if (lookup.status !== "found") {
    // Ambiguous is reported the same way as missing here: this endpoint feeds
    // the conversation page, and guessing a thread would attach the wrong order
    // to it.
    return c.json({ order: null });
  }

  const order = ordersModule.getOrderByConversation(refOf(lookup.conversation));

  if (!order) {
    return c.json({ order: null });
  }

  return c.json({ order });
});

// Get order by ID
app.get("/:id", async (c) => {
  const id = pathParam(c, "id");
  const order = ordersModule.getOrderById(c.get("scope").tenantId, id);

  if (!order) {
    return c.json({ error: "Order not found" }, 404);
  }

  return c.json(order);
});

// Update order status
app.patch("/:id/status", requireActiveTenant, async (c) => {
  const id = pathParam(c, "id");
  const body = await c.req.json();
  const user = c.get("user");
  const tenantId = activeTenantId(c);

  // Check role permissions for this status transition
  const permission = canUpdateOrderStatus(user.role, body.status);
  if (!permission.allowed) {
    return c.json({ error: permission.reason }, 403);
  }

  if (!ordersModule.getOrderById(tenantId, id)) {
    return c.json({ error: "Order not found" }, 404);
  }

  const order = ordersModule.updateOrderStatus(
    tenantId,
    id,
    body.status,
    body.notes,
    body.noteType,
  );

  logAction({ userId: user.id, tenantId }, "update_order_status", "order", id, {
    newStatus: body.status,
    notes: body.notes,
  });

  return c.json(order);
});

export default app;
