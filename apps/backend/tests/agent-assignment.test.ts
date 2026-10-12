import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { requireAuth, requireRole } from "../src/middleware/auth.ts";
import { errorHandler } from "../src/middleware/error.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import { TIMEOUTS } from "../src/config/timeouts.ts";
import { acquireLock } from "../src/conversation/locks.ts";
import { checkAndReassignTimeouts } from "../src/domains/conversations/assignment.ts";
import conversationRoutes from "../src/routes/conversations.ts";
import adminUserRoutes from "../src/routes/admin/users.ts";
import tenantRoutes from "../src/routes/tenants.ts";

const CUSTOMER = "51900444001";

type Auth = { cookie: string };

function buildApp() {
  const app = new Hono();
  app.use("/api/*", requireAuth);
  app.route("/api/conversations", conversationRoutes);
  app.route("/api/tenants", tenantRoutes);
  app.use("/api/admin/*", requireRole("admin"));
  app.route("/api/admin/users", adminUserRoutes);
  app.onError(errorHandler);
  return app;
}

function login(userId: string, tenantId: string | null): Auth {
  const token = generateSessionToken();
  createSession(token, userId, tenantId);
  return { cookie: `session=${token}` };
}

function createOperator(): string {
  const userId = `u-${crypto.randomUUID()}`;
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, name, is_platform_operator)
     VALUES (?, ?, 'x', 'admin', 'Operator', 1)`,
  ).run(userId, `op-${userId.slice(2, 12)}`);
  return userId;
}

describe("conversation assignment", () => {
  let app: ReturnType<typeof buildApp>;
  let tenant: TenantFixture;
  let admin: Auth;
  let operator: Auth;

  beforeEach(() => {
    applySchema();
    app = buildApp();
    tenant = createTenantFixture("assignment");
    admin = login(createMember(tenant, "admin").userId, tenant.tenantId);
    operator = login(createOperator(), null);
    insertConversation(tenant.ref(CUSTOMER));
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  function request(
    method: string,
    path: string,
    auth: Auth,
    body?: unknown,
  ): Promise<Response> {
    return Promise.resolve(
      app.request(path, {
        method,
        headers: {
          Cookie: auth.cookie,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  const takeover = (auth: Auth) =>
    request("POST", `/api/conversations/${CUSTOMER}/takeover`, auth);

  function assignedAgent(): string | null {
    return (
      db
        .prepare(
          "SELECT assigned_agent FROM conversations WHERE tenant_id = ? AND phone_number = ?",
        )
        .get(tenant.tenantId, CUSTOMER) as { assigned_agent: string | null }
    ).assigned_agent;
  }

  async function visibleTo(auth: Auth): Promise<boolean> {
    const response = await request("GET", "/api/conversations", auth);
    const rows = (await response.json()) as Array<{ phone_number: string }>;
    return rows.some((row) => row.phone_number === CUSTOMER);
  }

  function newAgent() {
    const { userId } = createMember(tenant, "sales_agent");
    return { userId, auth: login(userId, tenant.tenantId) };
  }

  describe("takeover", () => {
    it("assigns the agent who takes over", async () => {
      const agent = newAgent();

      const response = await takeover(agent.auth);

      expect(response.status).toBe(200);
      expect(assignedAgent()).toBe(agent.userId);
    });

    it("turns a second taker away and keeps the first", async () => {
      const first = newAgent();
      await takeover(first.auth);

      const response = await takeover(admin);

      expect(response.status).toBe(409);
      expect(assignedAgent()).toBe(first.userId);
    });

    it("does not let another agent reach a conversation an agent holds", async () => {
      const first = newAgent();
      const second = newAgent();
      await takeover(first.auth);

      const response = await takeover(second.auth);

      expect(response.ok).toBe(false);
      expect(assignedAgent()).toBe(first.userId);
    });

    it("lets the agent who holds the conversation repeat the takeover", async () => {
      const agent = newAgent();
      await takeover(agent.auth);

      const response = await takeover(agent.auth);

      expect(response.status).toBe(200);
      expect(assignedAgent()).toBe(agent.userId);
    });

    it("lets one of two simultaneous takers win", async () => {
      const first = newAgent();
      const second = newAgent();

      const [a, b] = await Promise.all([
        takeover(first.auth),
        takeover(second.auth),
      ]);

      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect(assignedAgent()).toBe(a.ok ? first.userId : second.userId);
    });
  });

  describe("removing an agent", () => {
    it("clears their conversations so another agent can take them", async () => {
      const removed = newAgent();
      await takeover(removed.auth);

      const response = await request(
        "DELETE",
        `/api/admin/users/${removed.userId}/membership`,
        admin,
      );
      expect(response.status).toBe(200);
      expect(assignedAgent()).toBeNull();

      const next = newAgent();
      expect((await takeover(next.auth)).status).toBe(200);
      expect(assignedAgent()).toBe(next.userId);
    });

    it("does not hand the conversation back when the agent is added again", async () => {
      const removed = newAgent();
      await takeover(removed.auth);
      await request(
        "DELETE",
        `/api/admin/users/${removed.userId}/membership`,
        admin,
      );
      const next = newAgent();
      await takeover(next.auth);

      const added = await request(
        "POST",
        `/api/tenants/${tenant.tenantId}/members`,
        operator,
        { userId: removed.userId, role: "sales_agent" },
      );
      expect(added.status).toBe(201);

      expect(assignedAgent()).toBe(next.userId);
      expect(await visibleTo(login(removed.userId, tenant.tenantId))).toBe(
        false,
      );
    });

    it("leaves the conversations of other agents alone", async () => {
      const removed = newAgent();
      const kept = newAgent();
      await takeover(kept.auth);

      await request(
        "DELETE",
        `/api/admin/users/${removed.userId}/membership`,
        admin,
      );

      expect(assignedAgent()).toBe(kept.userId);
    });
  });

  describe("deactivating an agent", () => {
    const setStatus = (userId: string) =>
      request("PATCH", `/api/admin/users/${userId}/status`, admin);

    it("clears their conversations so another agent can take them", async () => {
      const agent = newAgent();
      await takeover(agent.auth);

      const response = await setStatus(agent.userId);
      expect(response.status).toBe(200);
      expect(assignedAgent()).toBeNull();

      const next = newAgent();
      expect((await takeover(next.auth)).status).toBe(200);
      expect(assignedAgent()).toBe(next.userId);
    });

    it("does not return them when the account is turned back on", async () => {
      const agent = newAgent();
      await takeover(agent.auth);
      await setStatus(agent.userId);

      const response = await setStatus(agent.userId);

      expect(response.status).toBe(200);
      expect(assignedAgent()).toBeNull();
    });

    it("leaves the conversations of other agents alone", async () => {
      const gone = newAgent();
      const kept = newAgent();
      await takeover(kept.auth);

      await setStatus(gone.userId);

      expect(assignedAgent()).toBe(kept.userId);
    });
  });

  describe("releasing a conversation", () => {
    it("clears the agent so another agent can take it", async () => {
      const first = newAgent();
      await takeover(first.auth);

      const released = await request(
        "POST",
        `/api/conversations/${CUSTOMER}/release`,
        first.auth,
      );
      expect(released.status).toBe(200);
      expect(assignedAgent()).toBeNull();

      const next = newAgent();
      expect((await takeover(next.auth)).status).toBe(200);
      expect(assignedAgent()).toBe(next.userId);
    });
  });

  describe("an assignment waiting to be accepted", () => {
    const TEN_MINUTES = 10 * 60 * 1000;

    function state() {
      const row = db
        .prepare(
          `SELECT assigned_agent, assignment_notified_at, status, handover_reason, context_data
           FROM conversations WHERE tenant_id = ? AND phone_number = ?`,
        )
        .get(tenant.tenantId, CUSTOMER) as {
        assigned_agent: string | null;
        assignment_notified_at: number | null;
        status: string;
        handover_reason: string | null;
        context_data: string;
      };
      return {
        assignedAgent: row.assigned_agent,
        notifiedAt: row.assignment_notified_at,
        status: row.status,
        handoverReason: row.handover_reason,
        phase: JSON.parse(row.context_data).phase.phase as string,
      };
    }

    function assignedTo(userId: string, notifiedAt = Date.now()) {
      db.prepare(
        `UPDATE conversations
         SET assigned_agent = ?, assignment_notified_at = ?, status = 'human_takeover',
             handover_reason = 'multiple_objections', context_data = ?
         WHERE tenant_id = ? AND phone_number = ?`,
      ).run(
        userId,
        notifiedAt,
        JSON.stringify({
          phase: { phase: "escalated", reason: "multiple_objections" },
          metadata: { createdAt: Date.now(), lastActivityAt: Date.now() },
        }),
        tenant.tenantId,
        CUSTOMER,
      );
    }

    function goOffline(userId: string) {
      db.prepare(
        "UPDATE tenant_memberships SET is_available = 0 WHERE tenant_id = ? AND user_id = ?",
      ).run(tenant.tenantId, userId);
    }

    const decline = (auth: Auth) =>
      request(
        "POST",
        `/api/conversations/${CUSTOMER}/decline-assignment`,
        auth,
      );

    it("is accepted by the takeover, so the timer leaves the conversation with the agent", async () => {
      const agent = newAgent();
      newAgent();
      assignedTo(agent.userId, Date.now() - TEN_MINUTES);

      expect((await takeover(agent.auth)).status).toBe(200);
      expect(state().notifiedAt).toBeNull();

      await checkAndReassignTimeouts();

      expect(state().assignedAgent).toBe(agent.userId);
    });

    it("goes to the next agent when it times out, and the conversation stays with a person", async () => {
      const silent = newAgent();
      const next = newAgent();
      goOffline(silent.userId);
      assignedTo(silent.userId, Date.now() - TEN_MINUTES);

      await checkAndReassignTimeouts();

      expect(state()).toMatchObject({
        assignedAgent: next.userId,
        status: "human_takeover",
        handoverReason: "multiple_objections",
        phase: "escalated",
      });
      expect(state().notifiedAt).toBeGreaterThan(Date.now() - TEN_MINUTES);
    });

    it("is not reassigned before the window passes", async () => {
      const agent = newAgent();
      newAgent();
      assignedTo(agent.userId);

      await checkAndReassignTimeouts();

      expect(state().assignedAgent).toBe(agent.userId);
    });

    describe("declined by the agent", () => {
      it("goes to the next agent and moves a conversation the bot owned to a person", async () => {
        const first = newAgent();
        const next = newAgent();
        goOffline(first.userId);
        db.prepare(
          "UPDATE conversations SET assigned_agent = ? WHERE tenant_id = ? AND phone_number = ?",
        ).run(first.userId, tenant.tenantId, CUSTOMER);
        expect(state()).toMatchObject({ status: "active", phase: "greeting" });

        const response = await decline(first.auth);

        expect(response.status).toBe(200);
        expect(state()).toMatchObject({
          assignedAgent: next.userId,
          status: "human_takeover",
          phase: "escalated",
        });
        expect(state().notifiedAt).toBeGreaterThan(0);
      });

      it("leaves a conversation the bot owned escalated and unassigned when no other agent is available", async () => {
        const only = newAgent();
        goOffline(only.userId);
        db.prepare(
          "UPDATE conversations SET assigned_agent = ? WHERE tenant_id = ? AND phone_number = ?",
        ).run(only.userId, tenant.tenantId, CUSTOMER);
        expect(state()).toMatchObject({ status: "active", phase: "greeting" });

        const response = await decline(only.auth);

        expect(response.status).toBe(200);
        expect(state()).toEqual({
          assignedAgent: null,
          notifiedAt: null,
          status: "human_takeover",
          handoverReason: "agent_assigned",
          phase: "escalated",
        });
      });

      it("does not let an agent decline a conversation held by another", async () => {
        const holder = newAgent();
        const other = newAgent();
        assignedTo(holder.userId);

        const response = await decline(other.auth);

        expect(response.status).toBe(404);
        expect(state().assignedAgent).toBe(holder.userId);
      });

      it("answers busy and changes nothing while the conversation is locked", async () => {
        const agent = newAgent();
        newAgent();
        assignedTo(agent.userId);
        const before = state();
        const timeouts = TIMEOUTS as { LOCK_DEFAULT: number };
        const saved = timeouts.LOCK_DEFAULT;
        const release = await acquireLock(tenant.ref(CUSTOMER));
        timeouts.LOCK_DEFAULT = 30;

        try {
          const response = await decline(agent.auth);

          expect(response.status).toBe(409);
        } finally {
          timeouts.LOCK_DEFAULT = saved;
          release();
        }
        expect(state()).toEqual(before);
      });
    });
  });

  describe("demoting an agent", () => {
    it("clears their conversations", async () => {
      const agent = newAgent();
      await takeover(agent.auth);

      const response = await request(
        "PATCH",
        `/api/admin/users/${agent.userId}/role`,
        admin,
        { role: "supervisor" },
      );

      expect(response.status).toBe(200);
      expect(assignedAgent()).toBeNull();
    });

    it("keeps them when the role is set to the one the agent already has", async () => {
      const agent = newAgent();
      await takeover(agent.auth);

      await request("PATCH", `/api/admin/users/${agent.userId}/role`, admin, {
        role: "sales_agent",
      });

      expect(assignedAgent()).toBe(agent.userId);
    });
  });
});
