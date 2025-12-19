import { db } from "../db";
import * as XLSX from "xlsx";

export const ReportService = {
    generateDailyReport: (date: Date = new Date()) => {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);

        const rows = db
            .prepare(`
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
        `)
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
};
