/**
 * The report and funnel routes answer an invalid date with 400 and a short
 * message, and cut their days in America/Lima whatever zone the server is in.
 */

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
import { Hono } from "hono";
import * as XLSX from "xlsx";
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
import analyticsRoutes from "../src/routes/analytics.ts";
import reportRoutes from "../src/routes/reports.ts";

const CUSTOMER = "51900333444";

function buildApp() {
  const app = new Hono();
  app.use("/api/*", requireAuth);
  app.use("/api/analytics/*", requireRole("admin", "developer", "supervisor"));
  app.route("/api/analytics", analyticsRoutes);
  app.route("/api/reports", reportRoutes);
  app.onError(errorHandler);
  return app;
}

function login(
  tenant: TenantFixture,
  role: "admin" | "sales_agent" = "admin",
): { Cookie: string } {
  const { userId } = createMember(tenant, role);
  const token = generateSessionToken();
  createSession(token, userId, tenant.tenantId);
  return { Cookie: `session=${token}` };
}

function rowCount(buffer: ArrayBuffer): number {
  const workbook = XLSX.read(Buffer.from(buffer), { type: "buffer" });
  const [name] = workbook.SheetNames;
  return XLSX.utils.sheet_to_json(workbook.Sheets[name ?? ""] ?? {}).length;
}

describe("report and funnel routes", () => {
  const originalTz = process.env.TZ;
  let app: ReturnType<typeof buildApp>;
  let tenant: TenantFixture;
  let auth: { Cookie: string };

  const get = (path: string, headers: Record<string, string> = auth) =>
    app.request(path, { headers });

  function setLastActivity(at: number): void {
    db.prepare(
      `UPDATE conversations SET last_activity_at = ?
       WHERE tenant_id = ? AND phone_number = ?`,
    ).run(at, tenant.tenantId, CUSTOMER);
  }

  beforeAll(() => {
    process.env.TZ = "UTC";
  });

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  beforeEach(() => {
    applySchema();
    app = buildApp();
    tenant = createTenantFixture("report-routes");
    insertConversation(tenant.ref(CUSTOMER), { clientName: "Ana" });
    auth = login(tenant);
  });

  afterEach(() => {
    setSystemTime();
    dropTenantFixture(tenant);
  });

  describe("an invalid date", () => {
    it.each([
      ["/api/reports/daily?date=garbage", "date must be YYYY-MM-DD"],
      ["/api/reports/daily?date=2026-02-30", "date must be YYYY-MM-DD"],
      [
        "/api/reports/daily?date=2026-09-19T10:00:00Z",
        "date must be YYYY-MM-DD",
      ],
      [
        "/api/reports/activity?startDate=garbage",
        "startDate must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
      [
        "/api/reports/activity?startDate=2026-03-01&endDate=2026-13-01",
        "endDate must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
      [
        "/api/reports/orders?startDate=garbage",
        "startDate must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
      [
        "/api/reports/orders?startDate=2026-03-01&endDate=nope",
        "endDate must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
      [
        "/api/reports/orders?startDate=2026-04-31T00:00:00-05:00",
        "startDate must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
      [
        "/api/analytics/funnel?end=2026-02-30T12:00:00Z",
        "end must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
      [
        "/api/analytics/funnel?start=garbage",
        "start must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
      [
        "/api/analytics/funnel?start=2026-03-01&end=2026-02-30",
        "end must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
    ])("answers 400 with a short message: %s", async (path, message) => {
      const res = await get(path);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: message });
    });
  });

  describe("the daily report", () => {
    it("is the Lima day, from Lima midnight to the last millisecond of it", async () => {
      setLastActivity(Date.parse("2026-09-19T00:00:00.000-05:00"));
      expect(
        rowCount(
          await (await get("/api/reports/daily?date=2026-09-19")).arrayBuffer(),
        ),
      ).toBe(1);

      setLastActivity(Date.parse("2026-09-18T23:59:59.999-05:00"));
      expect(
        rowCount(
          await (await get("/api/reports/daily?date=2026-09-19")).arrayBuffer(),
        ),
      ).toBe(0);

      setLastActivity(Date.parse("2026-09-19T23:59:59.999-05:00"));
      expect(
        rowCount(
          await (await get("/api/reports/daily?date=2026-09-19")).arrayBuffer(),
        ),
      ).toBe(1);
    });

    it("is named for the date asked for", async () => {
      const res = await get("/api/reports/daily?date=2026-09-19");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="report-2026-09-19.xlsx"',
      );
    });

    it("is named for today in Lima when no date is given", async () => {
      // 22:00 on the 19th in Lima, already the 20th in UTC.
      setSystemTime(new Date("2026-09-20T03:00:00.000Z"));

      const res = await get("/api/reports/daily");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="report-2026-09-19.xlsx"',
      );
    });
  });

  describe("the activity report", () => {
    it("covers Lima days and is named for them", async () => {
      setLastActivity(Date.parse("2026-03-10T23:30:00-05:00"));

      const res = await get(
        "/api/reports/activity?startDate=2026-03-09&endDate=2026-03-10",
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="reporte-actividad-2026-03-09-a-2026-03-10.xlsx"',
      );
      expect(rowCount(await res.arrayBuffer())).toBe(1);
    });

    it("leaves out the next Lima day", async () => {
      setLastActivity(Date.parse("2026-03-11T00:00:00-05:00"));

      const res = await get(
        "/api/reports/activity?startDate=2026-03-09&endDate=2026-03-10",
      );

      expect(rowCount(await res.arrayBuffer())).toBe(0);
    });
  });

  describe("the orders report", () => {
    it("is named for the Lima days asked for", async () => {
      const res = await get(
        "/api/reports/orders?startDate=2026-03-09&endDate=2026-03-10",
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="reporte-ordenes-2026-03-09-a-2026-03-10.xlsx"',
      );
    });
  });

  describe("today's contact count", () => {
    it("counts the Lima day", async () => {
      // 22:00 on the 18th in Lima, already the 19th in UTC.
      setSystemTime(new Date("2026-09-19T03:00:00.000Z"));
      setLastActivity(Date.parse("2026-09-18T12:00:00-05:00"));

      const res = await get("/api/reports/today-count");

      expect(await res.json()).toEqual({ count: 1 });
    });
  });

  describe("the funnel", () => {
    it("covers the whole Lima day of a date-only end", async () => {
      db.prepare(
        `INSERT INTO analytics_events
           (id, tenant_id, channel_account_id, phone_number, event_type, created_at)
         VALUES (?, ?, ?, ?, 'session_start', ?)`,
      ).run(
        crypto.randomUUID(),
        tenant.tenantId,
        tenant.channelAccountId,
        CUSTOMER,
        Date.parse("2026-03-10T15:00:00.000Z"),
      );

      const res = await get(
        "/api/analytics/funnel?start=2026-03-10&end=2026-03-10",
      );
      const body = (await res.json()) as {
        stats: { sessions_started: number };
      };

      expect(res.status).toBe(200);
      expect(body.stats.sessions_started).toBe(1);
    });
  });

  describe("access", () => {
    it("still turns away a role that may not read reports", async () => {
      const agent = login(tenant, "sales_agent");

      expect((await get("/api/reports/daily", agent)).status).toBe(403);
      expect((await get("/api/reports/today-count", agent)).status).toBe(403);
    });

    it("still needs a session", async () => {
      expect((await get("/api/reports/daily", {})).status).toBe(401);
    });
  });
});
