import { Hono } from "hono";
import { limaDateString, limaDayBounds, limaRangeEdge } from "../db/query.ts";
import { ReportService } from "../domains/reports/index.ts";
import { requireRole, requireTenantScope } from "../middleware/auth.ts";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const reports = new Hono();

reports.use(
  "/*",
  requireTenantScope,
  requireRole("admin", "developer", "supervisor"),
);

reports.get("/daily", (c) => {
  const date = c.req.query("date") || undefined;
  const buffer = ReportService.generateDailyReport(
    c.get("scope").tenantId,
    date,
  );

  c.header("Content-Type", XLSX_TYPE);
  c.header(
    "Content-Disposition",
    `attachment; filename="report-${date ?? limaDateString(Date.now())}.xlsx"`,
  );

  return c.body(buffer);
});

reports.get("/today-count", (c) => {
  const count = ReportService.getTodayContactCount(c.get("scope").tenantId);
  return c.json({ count });
});

reports.get("/activity", (c) => {
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const segmentsStr = c.req.query("segments") || "fnb,gaso,none";
  const saleStatusesStr = c.req.query("saleStatuses") || "all";

  const startMs = startDateStr
    ? limaRangeEdge(startDateStr, "start", "startDate")
    : limaDayBounds()[0];
  const endMs = endDateStr
    ? limaRangeEdge(endDateStr, "end", "endDate")
    : limaDayBounds()[1];

  const segments = segmentsStr.split(",").filter(Boolean);
  const saleStatuses = saleStatusesStr.split(",").filter(Boolean);

  const buffer = ReportService.generateActivityReport({
    tenantId: c.get("scope").tenantId,
    startDate: new Date(startMs),
    endDate: new Date(endMs),
    segments,
    saleStatuses,
  });

  const filename = `reporte-actividad-${limaDateString(startMs)}-a-${limaDateString(endMs)}.xlsx`;

  c.header("Content-Type", XLSX_TYPE);
  c.header("Content-Disposition", `attachment; filename="${filename}"`);

  return c.body(buffer);
});

reports.get("/orders", (c) => {
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const status = c.req.query("status") || "";
  const assignedAgent = c.req.query("assignedAgent") || "";

  const startMs = startDateStr
    ? limaRangeEdge(startDateStr, "start", "startDate")
    : undefined;
  const endMs = endDateStr
    ? limaRangeEdge(endDateStr, "end", "endDate")
    : undefined;

  const buffer = ReportService.generateOrderReport({
    tenantId: c.get("scope").tenantId,
    startDate: startMs === undefined ? undefined : new Date(startMs),
    endDate: endMs === undefined ? undefined : new Date(endMs),
    status: status || undefined,
    assignedAgent: assignedAgent || undefined,
  });

  const dateRange =
    startMs === undefined
      ? "todas"
      : `${limaDateString(startMs)}-a-${endMs === undefined ? "hoy" : limaDateString(endMs)}`;
  const filename = `reporte-ordenes-${dateRange}.xlsx`;

  c.header("Content-Type", XLSX_TYPE);
  c.header("Content-Disposition", `attachment; filename="${filename}"`);

  return c.body(buffer);
});

export default reports;
