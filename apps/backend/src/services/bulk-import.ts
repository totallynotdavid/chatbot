import {
  BundleService,
} from "./catalog/index.ts";
import { PeriodService } from "./periods.ts";
import { db } from "../db/index.ts";

/**
 * CSV Format for Bundles (GASO & FnB):
 * period_id,segment,name,price,primary_category,image_id,composition_json,installments_json
 * 
 * Notes:
 * - period_id: Must reference an existing draft period
 * - segment: 'gaso' or 'fnb'
 * - image_id: Required, must be a valid image ID in storage
 * - composition_json: JSON string with fixed + choices arrays
 * - installments_json: JSON string with payment schedule
 */
export const BulkImportService = {
  processBundlesCsv: async (csvContent: string, userId: string) => {
    const lines = csvContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      return {
        successCount: 0,
        errors: ["CSV vacío o solo contiene encabezado"],
      };
    }

    const dataRows = lines.slice(1);
    let successCount = 0;
    const errors: string[] = [];

    const transaction = db.transaction(() => {
      for (let idx = 0; idx < dataRows.length; idx++) {
        const line = dataRows[idx];
        if (!line) continue;

        const cols = line.split(",").map((c) => c.trim());

        if (cols.length < 6) {
          errors.push(`Fila ${idx + 2}: Se requieren al menos 6 columnas`);
          continue;
        }

        const [
          periodId,
          name,
          price,
          primaryCategory,
          imageId,
          compositionJson,
          installmentsJson,
        ] = cols;

        if (
          !periodId ||
          !name ||
          !price ||
          !primaryCategory ||
          !imageId ||
          !compositionJson ||
          !installmentsJson
        ) {
          errors.push(`Fila ${idx + 2}: Faltan campos requeridos`);
          continue;
        }

        const period = PeriodService.getById(periodId);
        if (!period) {
          errors.push(`Fila ${idx + 2}: Período "${periodId}" no existe`);
          continue;
        }
        if (period.status !== "draft") {
          errors.push(`Fila ${idx + 2}: El período debe estar en borrador`);
          continue;
        }

        const parsedPrice = Number.parseFloat(price);
        if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
          errors.push(`Fila ${idx + 2}: Precio inválido "${price}"`);
          continue;
        }

        try {
          const id = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          BundleService.create({
            id,
            period_id: periodId,
            segment: "gaso",
            name,
            price: parsedPrice,
            primary_category: primaryCategory,
            categories_json: "[]",
            image_id: imageId,
            composition_json: compositionJson,
            installments_json: installmentsJson,
            created_by: userId,
          });
          successCount++;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`Fila ${idx + 2}: ${msg}`);
        }
      }
    });

    transaction();
    return { successCount, errors };
  },
};
