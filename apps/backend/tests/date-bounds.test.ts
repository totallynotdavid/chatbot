/** Range queries and writes on the millisecond columns: the funnel, the daily report, `last_activity_at`. */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  setSystemTime,
} from "bun:test";
import process from "node:process";
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

function dailyReportRows(tenantId: string, date?: string): number {
  const buffer = ReportService.generateDailyReport(tenantId, date);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const [name] = workbook.SheetNames;
  return XLSX.utils.sheet_to_json(workbook.Sheets[name ?? ""] ?? {}).length;
}

// The dashboard's day is America/Lima. A server in any other zone must cut it the same.
describe("date ranges over millisecond columns", () => {
  const originalTz = process.env.TZ;
  let tenant: TenantFixture;

  beforeAll(() => {
    process.env.TZ = "UTC";
  });

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("date-bounds");
    insertConversation(tenant.ref(CUSTOMER), { clientName: "Ana" });
  });

  afterEach(() => {
    setSystemTime();
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

    describe("a date-only end", () => {
      it("covers the whole Lima day, including its evening", () => {
        insertEvent(tenant, Date.parse("2026-03-10T15:00:00.000Z"));
        insertEvent(tenant, Date.parse("2026-03-10T23:30:00-05:00"));

        const stats = getFunnelStats(
          tenant.tenantId,
          "2026-03-01",
          "2026-03-10",
        );

        expect(stats.sessions_started).toBe(2);
      });

      it("stops at the next Lima midnight", () => {
        insertEvent(tenant, Date.parse("2026-03-11T00:00:00-05:00"));

        const stats = getFunnelStats(
          tenant.tenantId,
          "2026-03-01",
          "2026-03-10",
        );

        expect(stats.sessions_started).toBe(0);
      });
    });

    describe("a date-only start", () => {
      it("starts at Lima midnight", () => {
        insertEvent(tenant, Date.parse("2026-03-10T00:00:00-05:00"));

        const stats = getFunnelStats(
          tenant.tenantId,
          "2026-03-10",
          "2026-03-10",
        );

        expect(stats.sessions_started).toBe(1);
      });

      it("leaves out the last moment of the day before", () => {
        insertEvent(tenant, Date.parse("2026-03-09T23:59:59.999-05:00"));

        const stats = getFunnelStats(
          tenant.tenantId,
          "2026-03-10",
          "2026-03-10",
        );

        expect(stats.sessions_started).toBe(0);
      });
    });

    describe("a timestamp with a zone", () => {
      it("keeps its exact instant at the start", () => {
        insertEvent(tenant, Date.parse("2026-03-10T11:59:59.999Z"));
        insertEvent(tenant, Date.parse("2026-03-10T12:00:00.000Z"));

        const stats = getFunnelStats(
          tenant.tenantId,
          "2026-03-10T12:00:00.000Z",
          "2026-03-10T23:59:59.999Z",
        );

        expect(stats.sessions_started).toBe(1);
      });

      it("keeps its exact instant at the end", () => {
        insertEvent(tenant, Date.parse("2026-03-10T12:00:00.000Z"));
        insertEvent(tenant, Date.parse("2026-03-10T12:00:00.001Z"));

        const stats = getFunnelStats(
          tenant.tenantId,
          "2026-03-10T00:00:00.000Z",
          "2026-03-10T12:00:00.000Z",
        );

        expect(stats.sessions_started).toBe(1);
      });
    });

    it("refuses a bound that is not a date", () => {
      expect(() => getFunnelStats(tenant.tenantId, "garbage")).toThrow(
        "start must be YYYY-MM-DD or an ISO timestamp with a zone",
      );
      expect(() =>
        getFunnelStats(tenant.tenantId, "2026-02-01", "2026-02-30"),
      ).toThrow("end must be YYYY-MM-DD or an ISO timestamp with a zone");
    });
  });

  describe("the daily report", () => {
    it("lists a conversation active that day", () => {
      setLastActivity(tenant, Date.parse("2026-03-10T12:00:00-05:00"));

      expect(dailyReportRows(tenant.tenantId, "2026-03-10")).toBe(1);
    });

    it("leaves out a conversation active on another day", () => {
      setLastActivity(tenant, Date.parse("2026-03-11T12:00:00-05:00"));

      expect(dailyReportRows(tenant.tenantId, "2026-03-10")).toBe(0);
    });

    it("opens at Lima midnight", () => {
      setLastActivity(tenant, Date.parse("2026-09-19T00:00:00.000-05:00"));

      expect(dailyReportRows(tenant.tenantId, "2026-09-19")).toBe(1);
    });

    it("leaves out the last moment of the Lima day before", () => {
      setLastActivity(tenant, Date.parse("2026-09-18T23:59:59.999-05:00"));

      expect(dailyReportRows(tenant.tenantId, "2026-09-19")).toBe(0);
    });

    it("closes on the last millisecond of the Lima day", () => {
      setLastActivity(tenant, Date.parse("2026-09-19T23:59:59.999-05:00"));

      expect(dailyReportRows(tenant.tenantId, "2026-09-19")).toBe(1);
    });

    it("leaves out Lima midnight of the next day", () => {
      setLastActivity(tenant, Date.parse("2026-09-20T00:00:00.000-05:00"));

      expect(dailyReportRows(tenant.tenantId, "2026-09-19")).toBe(0);
    });

    it("is today's Lima day when no date is given", () => {
      setSystemTime(new Date("2026-09-20T03:00:00.000Z"));
      setLastActivity(tenant, Date.parse("2026-09-19T08:00:00-05:00"));

      expect(dailyReportRows(tenant.tenantId)).toBe(1);
    });

    it("names its sheet for the Lima date", () => {
      const buffer = ReportService.generateDailyReport(
        tenant.tenantId,
        "2026-09-19",
      );

      expect(XLSX.read(buffer, { type: "buffer" }).SheetNames).toEqual([
        "2026-09-19",
      ]);
    });

    it("refuses a date that is not a calendar day", () => {
      expect(() =>
        ReportService.generateDailyReport(tenant.tenantId, "garbage"),
      ).toThrow("date must be YYYY-MM-DD");
    });
  });

  describe("today's contact count", () => {
    it("counts activity since Lima midnight, not UTC midnight", () => {
      // 22:00 on the 18th in Lima, already the 19th in UTC.
      setSystemTime(new Date("2026-09-19T03:00:00.000Z"));
      setLastActivity(tenant, Date.parse("2026-09-18T12:00:00-05:00"));

      expect(ReportService.getTodayContactCount(tenant.tenantId)).toBe(1);
    });

    it("leaves out activity from the Lima day before", () => {
      // Now is 00:30 on the 19th in Lima. The activity at 20:00 on the 18th in
      // Lima is already past UTC midnight, so a UTC cutoff would count it.
      setSystemTime(new Date("2026-09-19T05:30:00.000Z"));
      setLastActivity(tenant, Date.parse("2026-09-18T20:00:00-05:00"));

      expect(ReportService.getTodayContactCount(tenant.tenantId)).toBe(0);
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

    it("is an integer after an agent takes the conversation over", async () => {
      const agent = `u-${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, name)
         VALUES (?, ?, 'x', 'sales_agent', 'Agent')`,
      ).run(agent, `agent-${agent.slice(2, 10)}`);

      const before = Date.now();
      await takeoverConversation(tenant.ref(CUSTOMER), agent);

      const stored = lastActivity(tenant);
      expect(typeof stored).toBe("number");
      expect(stored as number).toBeGreaterThanOrEqual(before);

      db.prepare("DELETE FROM audit_log WHERE user_id = ?").run(agent);
      db.prepare("DELETE FROM users WHERE id = ?").run(agent);
    });

    it("lands inside today's daily report", () => {
      updateConversation(tenant.ref(CUSTOMER), { phase: "greeting" }, {});

      expect(dailyReportRows(tenant.tenantId)).toBe(1);
    });
  });
});
