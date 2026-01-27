import { db } from "../../db/index.ts";
import type { Order } from "@totem/types";
import { eventBus } from "../../shared/events/index.ts";
import { createTraceId } from "@totem/utils";
import { generateOrderNumber } from "./utils.ts";
import { getOrderById } from "./read.ts";
import type { CreateOrderInput } from "./types.ts";

export function createOrder(input: CreateOrderInput): Order {
  const id = crypto.randomUUID();
  const orderNumber = generateOrderNumber();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO orders (
      id, order_number, conversation_phone, client_name, client_dni,
      products, total_amount, delivery_address, delivery_reference,
      status, assigned_agent, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `);

  stmt.run(
    id,
    orderNumber,
    input.conversationPhone,
    input.clientName,
    input.clientDni,
    input.products,
    input.totalAmount,
    input.deliveryAddress,
    input.deliveryReference || null,
    input.assignedAgent || null,
    now,
    now,
  );

  const order = getOrderById(id);
  if (!order) {
    throw new Error(`Failed to create order ${id}`);
  }

  eventBus.emit({
    type: "order_created",
    traceId: createTraceId(),
    timestamp: Date.now(),
    payload: {
      orderId: id,
      orderNumber,
      amount: input.totalAmount,
      clientName: input.clientName,
      phoneNumber: input.conversationPhone,
    },
  });

  return order;
}

export function updateOrderStatus(
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

  query += " WHERE id = ?";
  params.push(id);

  const stmt = db.prepare(query);
  stmt.run(...params);

  const order = getOrderById(id);
  if (!order) {
    throw new Error(`Failed to update order ${id}`);
  }

  return order;
}
