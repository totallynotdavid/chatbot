/** A new simulation takes its phone number from the server, never from the client. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";

import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { requireAuth } from "../src/middleware/auth.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import simulatorRoutes from "../src/routes/simulator.ts";

describe("simulated conversation phone numbers", () => {
  let app: Hono;
  let tenant: TenantFixture;
  let headers: Record<string, string>;

  beforeEach(() => {
    applySchema();

    app = new Hono();
    app.use("/api/*", requireAuth);
    app.route("/api/simulator", simulatorRoutes);

    tenant = createTenantFixture("sim-phones");

    const token = generateSessionToken();
    createSession(token, createMember(tenant, "admin").userId, tenant.tenantId);
    headers = {
      Cookie: `session=${token}`,
      "Content-Type": "application/json",
    };
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  async function create(): Promise<string> {
    const response = await app.request("/api/simulator/conversations", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { phone_number: string }).phone_number;
  }

  async function remove(phone: string) {
    const response = await app.request(
      `/api/simulator/conversations/${phone}`,
      { method: "DELETE", headers },
    );
    expect(response.status).toBe(200);
  }

  async function listed(): Promise<string[]> {
    const response = await app.request("/api/simulator/conversations", {
      headers,
    });
    const rows = (await response.json()) as { phone_number: string }[];
    return rows.map((row) => row.phone_number);
  }

  it("gives each new simulation its own number", async () => {
    const first = await create();
    const second = await create();

    expect(new Set([first, second]).size).toBe(2);
  });

  it("does not hand out a number another simulation holds after a delete", async () => {
    const first = await create();
    const second = await create();
    const third = await create();

    await remove(first);
    const fourth = await create();

    expect(new Set([first, second, third, fourth]).size).toBe(4);
    expect((await listed()).sort()).toEqual([second, third, fourth].sort());
  });

  it("skips a number a real conversation already holds", async () => {
    const first = await create();
    await remove(first);
    insertConversation(tenant.ref(first), { clientName: "Cliente Real" });

    const next = await create();

    expect(next).not.toBe(first);
  });

  it("never allocates the reserved replay contact", async () => {
    insertConversation(tenant.ref("51999999999"), { isSimulation: true });

    const phone = await create();

    expect(phone).not.toBe("51999999999");
    expect(phone).toBe("51900000001");
  });

  it("numbers each tenant on its own", async () => {
    const other = createTenantFixture("sim-phones-other");
    try {
      const token = generateSessionToken();
      createSession(token, createMember(other, "admin").userId, other.tenantId);

      await create();
      const response = await app.request("/api/simulator/conversations", {
        method: "POST",
        headers: {
          Cookie: `session=${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      expect(
        ((await response.json()) as { phone_number: string }).phone_number,
      ).toBe("51900000001");
    } finally {
      dropTenantFixture(other);
    }
  });
});
