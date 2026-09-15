import { db } from "../../db/index.ts";
import type { Order } from "@totem/types";
import { eventBus } from "../../shared/events/index.ts";
import { createTraceId } from "@totem/utils";
import { generateOrderNumber } from "./utils.ts";
import { getOrderById } from "./read.ts";
import type { CreateOrderInput } from "./types.ts";

export function createOrder(input: CreateOrderInput): Order {
  const { ref } = input;
  const id = crypto.randomUUID();
  const orderNumber = generateOrderNumber();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO orders (
      id, tenant_id, channel_account_id, order_number, conversation_phone,
      client_name, client_dni, products, total_amount, delivery_address,
      delivery_reference, status, assigned_agent, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `);

  const productJson = JSON.stringify(input.products);
  const mainProduct = input.products[0];

  stmt.run(
    id,
    ref.tenantId,
    ref.channelAccountId,
    orderNumber,
    ref.phoneNumber,
    input.clientName,
    input.clientDni,
    productJson,
    input.totalAmount,
    input.deliveryAddress,
    input.deliveryReference || null,
    input.assignedAgent || null,
    now,
    now,
  );

  const order = getOrderById(ref.tenantId, id);
  if (!order) {
    throw new Error(`Failed to create order ${id}`);
  }

  eventBus.emit({
    type: "order_created",
    traceId: createTraceId(),
    timestamp: Date.now(),
    tenantId: ref.tenantId,
    channelAccountId: ref.channelAccountId,
    payload: {
      orderId: id,
      orderNumber,
      amount: input.totalAmount,
      clientName: input.clientName,
      phoneNumber: ref.phoneNumber,
      dni: input.clientDni,
      productName: mainProduct?.name || "Producto",
    },
  });

  return order;
}

export function updateOrderStatus(
  tenantId: string,
  id: string,
  status: string,
  notes?: string,
  noteType?: "supervisor" | "calidda",
): Order {
  const now = Date.now();
  let query = "UPDATE orders SET status = ?, updated_at = ?";
  const params: any[] = [status, now];

  if (notes && noteType) {
    const column =
      noteType === "supervisor" ? "supervisor_notes" : "calidda_notes";
    query += `, ${column} = ?`;
    params.push(notes);
  }

  query += " WHERE id = ? AND tenant_id = ?";
  params.push(id, tenantId);

  const stmt = db.prepare(query);
  stmt.run(...params);

  const order = getOrderById(tenantId, id);
  if (!order) {
    throw new Error(`Failed to update order ${id}`);
  }

  return order;
}
