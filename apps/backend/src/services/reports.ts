import { db } from "../db/index.ts";
import { getAll } from "../db/query.ts";
import * as XLSX from "xlsx";

type ActivityReportParams = {
  startDate: Date;
  endDate: Date;
  segments: string[];
  saleStatuses: string[];
};

type OrderReportParams = {
  startDate?: Date;
  endDate?: Date;
  status?: string;
  assignedAgent?: string;
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

    const rows = getAll<Record<string, unknown>>(
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
      values
    );

    // Transform data for Excel
    const transformedRows = rows.map((row, index) => {
      // Parse products JSON if present
      let productos = "";
      try {
        const productsArray = JSON.parse((row["Productos"] as string) || "[]");
        if (Array.isArray(productsArray) && productsArray.length > 0) {
          productos = productsArray.join(", ");
        }
      } catch {
        productos = (row["Productos"] as string) || "";
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
          fechaActividad = row["Última Actividad"] as string;
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
        Campaña: segmentMap[row["Campaña"] as string] || "",
        Crédito: row["Crédito"] || "",
        NSE: row["NSE"] || "",
        "Estado Venta": saleStatusMap[row["Estado Venta"] as string] || "Pendiente",
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

  generateOrderReport: (params: OrderReportParams = {}) => {
    const { startDate, endDate, status, assignedAgent } = params;

    const conditions: string[] = [];
    const values: any[] = [];

    if (startDate) {
      conditions.push("created_at >= ?");
      values.push(startDate.getTime());
    }

    if (endDate) {
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push("created_at <= ?");
      values.push(endOfDay.getTime());
    }

    if (status) {
      conditions.push("status = ?");
      values.push(status);
    }

    if (assignedAgent) {
      conditions.push("assigned_agent = ?");
      values.push(assignedAgent);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = getAll<Record<string, unknown>>(
      `
        SELECT 
          order_number as "Número de Orden",
          client_name as "Cliente",
          client_dni as "DNI",
          conversation_phone as "Teléfono",
          total_amount as "Monto Total",
          delivery_address as "Dirección",
          delivery_reference as "Referencia",
          status as "Estado",
          assigned_agent as "Agente",
          supervisor_notes as "Notas Supervisor",
          calidda_notes as "Notas Calidda",
          created_at as "Fecha Creación",
          updated_at as "Última Actualización"
        FROM orders 
        ${whereClause}
        ORDER BY created_at DESC
      `,
      values
    );

    const statusMap: Record<string, string> = {
      pending: "Pendiente",
      supervisor_approved: "Aprobado Supervisor",
      supervisor_rejected: "Rechazado Supervisor",
      calidda_approved: "Aprobado Calidda",
      calidda_rejected: "Rechazado Calidda",
      delivered: "Entregado",
    };

    const transformedRows = rows.map((row, index) => {
      const formatTimestamp = (ts: any) => {
        const timestamp = Number(ts);
        if (!isNaN(timestamp)) {
          return new Date(timestamp).toLocaleString("es-PE", {
            timeZone: "America/Lima",
          });
        }
        return "";
      };

      return {
        "#": index + 1,
        "Número de Orden": row["Número de Orden"],
        Cliente: row["Cliente"],
        DNI: row["DNI"],
        Teléfono: row["Teléfono"],
        "Monto Total": `S/ ${Number(row["Monto Total"]).toFixed(2)}`,
        Dirección: row["Dirección"] || "",
        Referencia: row["Referencia"] || "",
        Estado: statusMap[row["Estado"] as string] || row["Estado"],
        Agente: row["Agente"] || "",
        "Notas Supervisor": row["Notas Supervisor"] || "",
        "Notas Calidda": row["Notas Calidda"] || "",
        "Fecha Creación": formatTimestamp(row["Fecha Creación"]),
        "Última Actualización": formatTimestamp(row["Última Actualización"]),
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(transformedRows);

    worksheet["!cols"] = [
      { wch: 5 }, // #
      { wch: 18 }, // Número de Orden
      { wch: 25 }, // Cliente
      { wch: 12 }, // DNI
      { wch: 15 }, // Teléfono
      { wch: 12 }, // Monto Total
      { wch: 35 }, // Dirección
      { wch: 25 }, // Referencia
      { wch: 18 }, // Estado
      { wch: 20 }, // Agente
      { wch: 30 }, // Notas Supervisor
      { wch: 30 }, // Notas Calidda
      { wch: 20 }, // Fecha Creación
      { wch: 20 }, // Última Actualización
    ];

    const workbook = XLSX.utils.book_new();
    const sheetName = startDate
      ? startDate.toISOString().split("T")[0]
      : "Ordenes";
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  },
};
