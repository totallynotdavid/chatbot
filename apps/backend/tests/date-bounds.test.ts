/** Range queries and writes on the millisecond columns: the funnel, the daily report, `last_activity_at`. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as XLSX from "xlsx";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { getFunnelStats } from "../src/domains/analytics/index.ts";
import { ReportService } from "../src/domains/reports/index.ts";
import { resetSession, updateConversation } from "../src/conversation/store.ts";
import { takeoverConversation } from "../src/domains/conversations/write.ts";

const CUSTOMER = "51900111222";

function insertEvent(fixture: TenantFixture, createdAt: number): void {
  db.prepare(
    `INSERT INTO analytics_events
       (id, tenant_id, channel_account_id, phone_number, event_type, created_at)
     VALUES (?, ?, ?, ?, 'session_start', ?)`,
  ).run(
    crypto.randomUUID(),
    fixture.tenantId,
    fixture.channelAccountId,
    CUSTOMER,
    createdAt,
  );
}

function setLastActivity(fixture: TenantFixture, at: number): void {
  db.prepare(
    `UPDATE conversations SET last_activity_at = ?
     WHERE tenant_id = ? AND phone_number = ?`,
  ).run(at, fixture.tenantId, CUSTOMER);
}

function lastActivity(fixture: TenantFixture): unknown {
  return (
    db
      .prepare(
        "SELECT last_activity_at FROM conversations WHERE tenant_id = ? AND phone_number = ?",
      )
      .get(fixture.tenantId, CUSTOMER) as { last_activity_at: unknown }
  ).last_activity_at;
}

function dailyReportRows(tenantId: string, date: Date): number {
  const buffer = ReportService.generateDailyReport(tenantId, date);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const [name] = workbook.SheetNames;
  return XLSX.utils.sheet_to_json(workbook.Sheets[name ?? ""] ?? {}).length;
}

describe("date ranges over millisecond columns", () => {
  let tenant: TenantFixture;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("date-bounds");
    insertConversation(tenant.ref(CUSTOMER), { clientName: "Ana" });
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  describe("the funnel", () => {
    it("counts an event inside an explicit range", () => {
      const at = Date.parse("2026-03-10T15:00:00.000Z");
      insertEvent(tenant, at);

      const stats = getFunnelStats(
        tenant.tenantId,
        "2026-03-10T00:00:00.000Z",
        "2026-03-10T23:59:59.999Z",
      );

      expect(stats.sessions_started).toBe(1);
    });

    it("leaves out an event outside the range", () => {
      insertEvent(tenant, Date.parse("2026-03-11T00:00:01.000Z"));

      const stats = getFunnelStats(
        tenant.tenantId,
        "2026-03-10T00:00:00.000Z",
        "2026-03-10T23:59:59.999Z",
      );

      expect(stats.sessions_started).toBe(0);
    });

    it("counts a recent event when no range is given", () => {
      insertEvent(tenant, Date.now() - 60_000);

      expect(getFunnelStats(tenant.tenantId).sessions_started).toBe(1);
    });
  });

  describe("the daily report", () => {
    it("lists a conversation active that day", () => {
      const day = new Date(2026, 2, 10, 12, 0, 0);
      setLastActivity(tenant, day.getTime());

      expect(dailyReportRows(tenant.tenantId, day)).toBe(1);
    });

    it("leaves out a conversation active on another day", () => {
      setLastActivity(tenant, new Date(2026, 2, 11, 12, 0, 0).getTime());

      expect(dailyReportRows(tenant.tenantId, new Date(2026, 2, 10))).toBe(0);
    });
  });

  describe("the activity timestamp a conversation is written with", () => {
    it("is an integer after its state is saved", () => {
      const before = Date.now();
      updateConversation(tenant.ref(CUSTOMER), { phase: "greeting" }, {});

      const stored = lastActivity(tenant);
      expect(typeof stored).toBe("number");
      expect(stored as number).toBeGreaterThanOrEqual(before);
    });

    it("is an integer after the session is reset", () => {
      const before = Date.now();
      resetSession(tenant.ref(CUSTOMER));

      const stored = lastActivity(tenant);
      expect(typeof stored).toBe("number");
      expect(stored as number).toBeGreaterThanOrEqual(before);
    });

    it("is an integer after an agent takes the conversation over", () => {
      const agent = `u-${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, name)
         VALUES (?, ?, 'x', 'sales_agent', 'Agent')`,
      ).run(agent, `agent-${agent.slice(2, 10)}`);

      const before = Date.now();
      takeoverConversation(tenant.ref(CUSTOMER), agent);

      const stored = lastActivity(tenant);
      expect(typeof stored).toBe("number");
      expect(stored as number).toBeGreaterThanOrEqual(before);

      db.prepare("DELETE FROM audit_log WHERE user_id = ?").run(agent);
      db.prepare("DELETE FROM users WHERE id = ?").run(agent);
    });

    it("lands inside today's daily report", () => {
      updateConversation(tenant.ref(CUSTOMER), { phase: "greeting" }, {});

      expect(dailyReportRows(tenant.tenantId, new Date())).toBe(1);
    });
  });
});
