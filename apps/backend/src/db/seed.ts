import type { Database } from "bun:sqlite";
import bcrypt from "bcryptjs";

export function seedDatabase(db: Database) {
    const adminCheck = db
        .prepare("SELECT count(*) as count FROM users")
        .get() as { count: number };

    if (adminCheck.count === 0) {
        const adminId = crypto.randomUUID();
        const hash = bcrypt.hashSync("admin123", 10);

        db.prepare(
            `INSERT INTO users (id, username, password_hash, role, name, created_by) 
       VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(adminId, "admin", hash, "admin", "Administrador", null);

        console.log("Admin user created (username: admin, password: admin123)");
    }

    // Seed some sample products if empty
    const productCheck = db
        .prepare("SELECT count(*) as count FROM catalog_products")
        .get() as { count: number };

    if (productCheck.count === 0) {
        const adminUser = db
            .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
            .get() as { id: string };

        const sampleProducts = [
            {
                segment: "fnb",
                category: "celulares",
                name: "Smartphone Samsung Galaxy A54",
                price: 1299,
                installments: 12,
            },
            {
                segment: "fnb",
                category: "laptops",
                name: "Laptop HP 15.6'' Core i5",
                price: 2199,
                installments: 18,
            },
            {
                segment: "gaso",
                category: "cocinas",
                name: "Cocina Indurama 4 Hornillas",
                price: 899,
                installments: 12,
            },
            {
                segment: "gaso",
                category: "refrigeradoras",
                name: "Refrigeradora LG 250L",
                price: 1499,
                installments: 18,
            },
        ];

        const stmt = db.prepare(`
      INSERT INTO catalog_products 
      (id, segment, category, name, description, price, installments, image_main_path, is_active, stock_status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'in_stock', ?)
    `);

        sampleProducts.forEach((p) => {
            const id = `${p.segment.toUpperCase()}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
            const imagePath = `catalog/${p.segment}/${p.category}/placeholder.jpg`;
            stmt.run(
                id,
                p.segment,
                p.category,
                p.name,
                `Producto de ejemplo - ${p.name}`,
                p.price,
                p.installments,
                imagePath,
                adminUser.id,
            );
        });

        console.log(`Seeded ${sampleProducts.length} sample products`);
    }
}
