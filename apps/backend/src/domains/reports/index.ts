import {
  getAll,
  getOne,
  limaDateString,
  limaDayBounds,
  tenantPredicate,
} from "../../db/query.ts";
import * as XLSX from "xlsx";

type ActivityReportParams = {
  /**
   * Null spans open tenants. Only an unpinned platform operator's request
   * passes it.
   */
  tenantId: string | null;
  startDate: Date;
  endDate: Date;
  segments: string[];
  saleStatuses: string[];
};

type OrderReportParams = {
  tenantId: string | null;
  startDate?: Date;
  endDate?: Date;
  status?: string;
  assignedAgent?: string;
};

export const ReportService = {
  /** `date` is `YYYY-MM-DD` in Lima. Omitted, it is today there. */
  generateDailyReport: (tenantId: string | null, date?: string) => {
    const [start, end] = limaDayBounds(date);

    const rows = getAll<Record<string, unknown>>(
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
              AND ${tenantPredicate(tenantId)}
        `,
      tenantId ? [start, end, tenantId] : [start, end],
    );

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, limaDateString(start));

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  },

  generateActivityReport: (params: ActivityReportParams) => {
    const { tenantId, startDate, endDate, segments, saleStatuses } = params;

    const conditions: string[] = ["is_simulation = 0"];
    const values: any[] = [];

    conditions.push(tenantPredicate(tenantId));
    if (tenantId) values.push(tenantId);

    const startTimestamp = startDate.getTime();
    const endTimestamp = endDate.getTime();
    conditions.push("last_activity_at >= ? AND last_activity_at <= ?");
    values.push(startTimestamp, endTimestamp);

    if (segments.length > 0 && !segments.includes("all")) {
      const segmentConditions: string[] = [];
      if (segments.includes("fnb")) segmentConditions.push("segment = 'fnb'");
      if (segments.includes("gaso")) segmentConditions.push("segment = 'gaso'");
      if (segments.includes("none")) segmentConditions.push("segment IS NULL");
      if (segmentConditions.length > 0) {
        conditions.push(`(${segmentConditions.join(" OR ")})`);
      }
    }

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
      values,
    );

    const transformedRows = rows.map((row, index) => {
      let productos = "";
      try {
        const productsArray = JSON.parse((row["Productos"] as string) || "[]");
        if (Array.isArray(productsArray) && productsArray.length > 0) {
          productos = productsArray.join(", ");
        }
      } catch {
        productos = (row["Productos"] as string) || "";
      }

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

      const saleStatusMap: Record<string, string> = {
        pending: "Pendiente",
        confirmed: "Confirmado",
        rejected: "Rechazado",
        no_answer: "Sin respuesta",
      };

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
        "Estado Venta":
          saleStatusMap[row["Estado Venta"] as string] || "Pendiente",
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
    const sheetName = limaDateString(startTimestamp);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  },

  getTodayContactCount: (tenantId: string | null) => {
    const [startTimestamp] = limaDayBounds();

    const result = getOne<{ count: number }>(
      `
        SELECT COUNT(*) as count
        FROM conversations
        WHERE is_simulation = 0 AND last_activity_at >= ?
          AND ${tenantPredicate(tenantId)}
      `,
      tenantId ? [startTimestamp, tenantId] : [startTimestamp],
    );

    return result?.count ?? 0;
  },

  generateOrderReport: (params: OrderReportParams) => {
    const { tenantId, startDate, endDate, status, assignedAgent } = params;

    const conditions: string[] = [];
    const values: any[] = [];

    conditions.push(tenantPredicate(tenantId));
    if (tenantId) values.push(tenantId);

    if (startDate) {
      conditions.push("created_at >= ?");
      values.push(startDate.getTime());
    }

    if (endDate) {
      conditions.push("created_at <= ?");
      values.push(endDate.getTime());
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
      values,
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
        return !isNaN(timestamp)
          ? new Date(timestamp).toLocaleString("es-PE", {
              timeZone: "America/Lima",
            })
          : "";
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
      ? limaDateString(startDate.getTime())
      : "Ordenes";
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  },
};
