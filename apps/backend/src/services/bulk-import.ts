import { CatalogService } from './catalog';
import { db } from '../db';
import type { Segment } from '@totem/types';

export const BulkImportService = {
    processCsv: async (csvContent: string, userId: string) => {
        const lines = csvContent.split('\n').filter(l => l.trim().length > 0);
        // lines[0] is header
        const dataRows = lines.slice(1);

        let successCount = 0;
        let errors: string[] = [];

        db.transaction(() => {
            dataRows.forEach((line, idx) => {
                const cols = line.split(',').map(c => c.trim());
                if (cols.length < 6) return;

                const [segment, category, name, price, description, image_filename] = cols;

                if (segment !== 'fnb' && segment !== 'gaso') {
                    errors.push(`Row ${idx + 2}: Invalid segment ${segment}`);
                    return;
                }

                try {
                    const relativePath = `catalog/${segment}/${category}/${image_filename}`;
                    const id = `${segment.toUpperCase()}-${category.slice(0,3).toUpperCase()}-${Date.now()}-${idx}`;

                    CatalogService.create({
                        id,
                        segment: segment as Segment,
                        category,
                        name,
                        description,
                        price: parseFloat(price),
                        image_main_path: relativePath,
                        image_specs_path: null,
                        created_by: userId
                    });
                    successCount++;
                } catch (e: any) {
                    errors.push(`Row ${idx + 2}: ${e.message}`);
                }
            });
        })();

        return { successCount, errors };
    }
};
