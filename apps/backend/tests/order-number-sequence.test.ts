import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
} from "bun:test";

import { createOrder } from "../src/domains/orders/write.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

describe("order number sequence", () => {
  let firstTenant: TenantFixture;
  let secondTenant: TenantFixture;

  beforeEach(() => {
    applySchema();
    firstTenant = createTenantFixture("order-sequence-first");
    secondTenant = createTenantFixture("order-sequence-second");
    insertConversation(firstTenant.ref("51900000001"));
    insertConversation(secondTenant.ref("51900000002"));
  });

  afterEach(() => {
    setSystemTime();
    dropTenantFixture(firstTenant);
    dropTenantFixture(secondTenant);
  });

  it("sequences 1,200 orders per tenant and resets for another tenant", () => {
    const createdAt = new Date("2026-10-11T02:00:00Z");
    setSystemTime(createdAt);

    try {
      const date = "20261010";
      const expectedNumbers = Array.from(
        { length: 1_200 },
        (_, index) => `ORD-${date}-${String(index + 1).padStart(3, "0")}`,
      );
      const numbers = Array.from(
        { length: 1_200 },
        () =>
          createOrder({
            ref: firstTenant.ref("51900000001"),
            clientName: "Cliente",
            clientDni: "12345678",
            products: [
              { productId: "p1", name: "Terma", price: 900, quantity: 1 },
            ],
            totalAmount: 900,
            deliveryAddress: "Av. Siempre Viva 123",
          }).order_number,
      );

      expect(new Set(numbers).size).toBe(1_200);
      expect(numbers).toEqual(expectedNumbers);

      const secondTenantOrder = createOrder({
        ref: secondTenant.ref("51900000002"),
        clientName: "Cliente",
        clientDni: "12345678",
        products: [{ productId: "p1", name: "Terma", price: 900, quantity: 1 }],
        totalAmount: 900,
        deliveryAddress: "Av. Siempre Viva 123",
      });

      expect(secondTenantOrder.order_number).toBe(`ORD-${date}-001`);
    } finally {
      setSystemTime();
    }
  });
});
