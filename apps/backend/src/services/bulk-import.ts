import { CatalogService } from "./catalog.ts";
import { PeriodService } from "./periods.ts";
import { db } from "../db/index.ts";
import type { Segment } from "@totem/types";

/**
 * CSV Format:
 * period_id,segment,category,name,price,installments,description,image_main_id,image_specs_id
 *
 * Notes:
 * - period_id: Must reference an existing draft period
 * - segment: "fnb" or "gaso"
 * - image_main_id: Required, must be a valid image ID in storage
 * - image_specs_id: Optional, leave empty if not needed
 * - installments: Optional, leave empty if not needed
 */
export const BulkImportService = {
  processCsv: async (csvContent: string, userId: string) => {
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

        if (cols.length < 8) {
          errors.push(
            `Fila ${idx + 2}: Se requieren al menos 8 columnas (encontradas ${cols.length})`,
          );
          continue;
        }

        const [
          periodId,
          segment,
          category,
          name,
          price,
          installments,
          description,
          imageMainId,
          imageSpecsId,
        ] = cols;

        // Validate required fields
        if (!periodId || !segment || !category || !name || !price) {
          errors.push(`Fila ${idx + 2}: Faltan campos requeridos`);
          continue;
        }

        // Validate segment
        if (segment !== "fnb" && segment !== "gaso") {
          errors.push(`Fila ${idx + 2}: Segmento inválido "${segment}"`);
          continue;
        }

        // Validate period exists and is draft
        const period = PeriodService.getById(periodId);
        if (!period) {
          errors.push(`Fila ${idx + 2}: Período "${periodId}" no existe`);
          continue;
        }
        if (period.status !== "draft") {
          errors.push(
            `Fila ${idx + 2}: El período debe estar en borrador (estado actual: ${period.status})`,
          );
          continue;
        }

        // Validate image exists
        if (!imageMainId) {
          errors.push(`Fila ${idx + 2}: Se requiere image_main_id`);
          continue;
        }

        // Note: We don't validate image exists in storage to avoid async complexity
        // Images should be uploaded before running bulk import

        // Parse numeric fields
        const parsedPrice = Number.parseFloat(price);
        if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
          errors.push(`Fila ${idx + 2}: Precio inválido "${price}"`);
          continue;
        }

        const parsedInstallments = installments
          ? Number.parseInt(installments, 10)
          : null;
        if (
          parsedInstallments !== null &&
          (Number.isNaN(parsedInstallments) || parsedInstallments <= 0)
        ) {
          errors.push(`Fila ${idx + 2}: Cuotas inválidas "${installments}"`);
          continue;
        }

        try {
          const id = `${segment.toUpperCase()}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

          CatalogService.create({
            id,
            period_id: periodId,
            segment: segment as Segment,
            category,
            name,
            description: description || null,
            price: parsedPrice,
            installments: parsedInstallments,
            image_main_id: imageMainId,
            image_specs_id: imageSpecsId || null,
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
