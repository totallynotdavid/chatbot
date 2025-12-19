import { CatalogService } from "./catalog";
import { db } from "../db";
import type { Segment } from "@totem/types";

export const BulkImportService = {
    processCsv: async (csvContent: string, userId: string) => {
        const lines = csvContent.split("\n").filter((l) => l.trim().length > 0);
        // lines[0] is header
        const dataRows = lines.slice(1);

        let successCount = 0;
        let errors: string[] = [];

        db.transaction(() => {
            dataRows.forEach((line, idx) => {
                const cols = line.split(",").map((c) => c.trim());
                if (cols.length < 6) return;

                const segment = cols[0];
                const category = cols[1];
                const name = cols[2];
                const price = cols[3];
                const description = cols[4];
                const image_filename = cols[5];

                if (!segment || !category || !name || !price) {
                    errors.push(`Row ${idx + 2}: Missing required fields`);
                    return;
                }

                if (segment !== "fnb" && segment !== "gaso") {
                    errors.push(`Row ${idx + 2}: Invalid segment ${segment}`);
                    return;
                }

                try {
                    const relativePath = `catalog/${segment}/${category}/${image_filename}`;
                    const id = `${segment.toUpperCase()}-${category.slice(0, 3).toUpperCase()}-${Date.now()}-${idx}`;

                    CatalogService.create({
                        id,
                        segment: segment as Segment,
                        category,
                        name,
                        description: description ?? null,
                        price: parseFloat(price),
                        image_main_path: relativePath,
                        image_specs_path: null,
                        created_by: userId,
                    });
                    successCount++;
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    errors.push(`Row ${idx + 2}: ${msg}`);
                }
            });
        })();

        return { successCount, errors };
    },
};
