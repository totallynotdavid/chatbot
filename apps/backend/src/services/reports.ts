import { db } from "../db/index.ts";
import * as XLSX from "xlsx";

type ActivityReportParams = {
  startDate: Date;
  endDate: Date;
  segments: string[];
  saleStatuses: string[];
};

export const ReportService = {
  generateDailyReport: (date: Date = new Date()) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const rows = db
      .prepare(
        `
            SELECT 
              phone_number,
              client_name,
              dni,
              segment,
              credit_line,
              status,
              current_state,
              last_activity_at
            FROM conversations 
            WHERE last_activity_at BETWEEN ? AND ?
        `,
      )
      .all(start.toISOString(), end.toISOString());

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      start.toISOString().split("T")[0],
    );

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  },

  generateActivityReport: (params: ActivityReportParams) => {
    const { startDate, endDate, segments, saleStatuses } = params;

    // Build WHERE conditions
    const conditions: string[] = ["is_simulation = 0"];
    const values: any[] = [];

    // Date range - using timestamps
    const startTimestamp = startDate.getTime();
    const endTimestamp = endDate.getTime();
    conditions.push("last_activity_at >= ? AND last_activity_at <= ?");
    values.push(startTimestamp, endTimestamp);

    // Segment filter
    if (segments.length > 0 && !segments.includes("all")) {
      const segmentConditions: string[] = [];
      if (segments.includes("fnb")) segmentConditions.push("segment = 'fnb'");
      if (segments.includes("gaso")) segmentConditions.push("segment = 'gaso'");
      if (segments.includes("none")) segmentConditions.push("segment IS NULL");
      if (segmentConditions.length > 0) {
        conditions.push(`(${segmentConditions.join(" OR ")})`);
      }
    }

    // Sale status filter
    if (saleStatuses.length > 0 && !saleStatuses.includes("all")) {
      const statusPlaceholders = saleStatuses.map(() => "?").join(",");
      conditions.push(`sale_status IN (${statusPlaceholders})`);
      values.push(...saleStatuses);
    }

    const whereClause = conditions.join(" AND ");

    const rows = db
      .prepare(
        `
        SELECT 
          phone_number as "Teléfono",
          client_name as "Nombre",
          dni as "DNI",
          segment as "Campaña",
          credit_line as "Crédito",
          nse as "NSE",
          current_state as "Estado Bot",
          sale_status as "Estado Venta",
          agent_notes as "Observaciones",
          products_interested as "Productos",
          last_activity_at as "Última Actividad"
        FROM conversations 
        WHERE ${whereClause}
        ORDER BY last_activity_at DESC
      `,
      )
      .all(...values) as any[];

    // Transform data for Excel
    const transformedRows = rows.map((row, index) => {
      // Parse products JSON if present
      let productos = "";
      try {
        const productsArray = JSON.parse(row["Productos"] || "[]");
        if (Array.isArray(productsArray) && productsArray.length > 0) {
          productos = productsArray.join(", ");
        }
      } catch {
        productos = row["Productos"] || "";
      }

      // Format timestamp
      let fechaActividad = "";
      if (row["Última Actividad"]) {
        const timestamp = Number(row["Última Actividad"]);
        if (!isNaN(timestamp)) {
          fechaActividad = new Date(timestamp).toLocaleString("es-PE", {
            timeZone: "America/Lima",
          });
        } else {
          fechaActividad = row["Última Actividad"];
        }
      }

      // Map sale status to Spanish
      const saleStatusMap: Record<string, string> = {
        pending: "Pendiente",
        confirmed: "Confirmado",
        rejected: "Rechazado",
        no_answer: "Sin respuesta",
      };

      // Map segment to Spanish
      const segmentMap: Record<string, string> = {
        fnb: "FNB",
        gaso: "GASO",
      };

      return {
        "#": index + 1,
        Teléfono: row["Teléfono"],
        Nombre: row["Nombre"] || "",
        DNI: row["DNI"] || "",
        Campaña: segmentMap[row["Campaña"]] || "",
        Crédito: row["Crédito"] || "",
        NSE: row["NSE"] || "",
        "Estado Venta": saleStatusMap[row["Estado Venta"]] || "Pendiente",
        Productos: productos,
        Observaciones: row["Observaciones"] || "",
        "Última Actividad": fechaActividad,
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(transformedRows);

    // Set column widths
    worksheet["!cols"] = [
      { wch: 5 }, // #
      { wch: 15 }, // Teléfono
      { wch: 25 }, // Nombre
      { wch: 12 }, // DNI
      { wch: 8 }, // Campaña
      { wch: 10 }, // Crédito
      { wch: 5 }, // NSE
      { wch: 12 }, // Estado Venta
      { wch: 30 }, // Productos
      { wch: 40 }, // Observaciones
      { wch: 20 }, // Última Actividad
    ];

    const workbook = XLSX.utils.book_new();
    const sheetName = `${startDate.toISOString().split("T")[0]}`;
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  },

  getTodayContactCount: () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startTimestamp = today.getTime();

    const result = db
      .prepare(
        `
        SELECT COUNT(*) as count 
        FROM conversations 
        WHERE is_simulation = 0 AND last_activity_at >= ?
      `,
      )
      .get(startTimestamp) as { count: number };

    return result?.count ?? 0;
  },
};
