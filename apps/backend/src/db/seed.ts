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

    const productCheck = db
        .prepare("SELECT count(*) as count FROM catalog_products")
        .get() as { count: number };

    if (productCheck.count === 0) {
        const adminUser = db
            .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
            .get() as { id: string };

        const sampleProducts = [
            // FNB Products - Premium segment with flexible rules
            {
                segment: "fnb",
                category: "celulares",
                name: "iPhone 14 128GB",
                price: 3499,
                installments: 18,
            },
            {
                segment: "fnb",
                category: "celulares",
                name: "Samsung Galaxy S23",
                price: 2899,
                installments: 18,
            },
            {
                segment: "fnb",
                category: "celulares",
                name: "Xiaomi Redmi Note 12 Pro",
                price: 1199,
                installments: 12,
            },
            {
                segment: "fnb",
                category: "laptops",
                name: "MacBook Air M2 256GB",
                price: 4999,
                installments: 24,
            },
            {
                segment: "fnb",
                category: "laptops",
                name: "Laptop HP Pavilion 15'' i7",
                price: 2799,
                installments: 18,
            },
            {
                segment: "fnb",
                category: "laptops",
                name: "Lenovo IdeaPad 3 i5",
                price: 1899,
                installments: 12,
            },
            {
                segment: "fnb",
                category: "televisores",
                name: "Smart TV Samsung 55'' 4K",
                price: 2199,
                installments: 18,
            },
            {
                segment: "fnb",
                category: "televisores",
                name: "Smart TV LG 43'' Full HD",
                price: 1299,
                installments: 12,
            },
            {
                segment: "fnb",
                category: "cocinas",
                name: "Cocina Mabe 6 Hornillas Acero",
                price: 1899,
                installments: 12,
            },
            {
                segment: "fnb",
                category: "refrigeradoras",
                name: "Refrigeradora Samsung Side by Side",
                price: 3299,
                installments: 18,
            },

            // GASO Products - Calidda gas clients, restrictive rules
            {
                segment: "gaso",
                category: "celulares",
                name: "Samsung Galaxy A14",
                price: 699,
                installments: 12,
            },
            {
                segment: "gaso",
                category: "celulares",
                name: "Xiaomi Redmi 12",
                price: 549,
                installments: 12,
            },
            {
                segment: "gaso",
                category: "celulares",
                name: "Motorola Moto G73",
                price: 899,
                installments: 12,
            },
            {
                segment: "gaso",
                category: "laptops",
                name: "Laptop HP 15.6'' i5 8GB",
                price: 1799,
                installments: 18,
            },
            {
                segment: "gaso",
                category: "laptops",
                name: "Laptop Lenovo V14 i3",
                price: 1299,
                installments: 12,
            },
            {
                segment: "gaso",
                category: "televisores",
                name: "Smart TV LG 43'' Full HD",
                price: 1199,
                installments: 12,
            },
            {
                segment: "gaso",
                category: "televisores",
                name: "TV Samsung 32'' HD",
                price: 799,
                installments: 12,
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
                category: "cocinas",
                name: "Cocina Mabe 5 Hornillas",
                price: 1199,
                installments: 12,
            },
            {
                segment: "gaso",
                category: "refrigeradoras",
                name: "Refrigeradora LG 250L",
                price: 1499,
                installments: 18,
            },
            {
                segment: "gaso",
                category: "refrigeradoras",
                name: "Refrigeradora Indurama 170L",
                price: 999,
                installments: 12,
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
