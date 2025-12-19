import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { db } from "./db";
import bcrypt from "bcryptjs";

import { CatalogService } from "./services/catalog";
import { WhatsAppService } from "./services/whatsapp";
import { BulkImportService } from "./services/bulk-import";
import { ReportService } from "./services/reports";
import { getProvidersHealth } from "./services/providers";
import {
    generateSessionToken,
    createSession,
    validateSessionToken,
    invalidateSession,
    setSessionTokenCookie,
    deleteSessionTokenCookie,
    type Session,
    type User,
} from "./services/auth";
import { runAgent } from "./agent/core";
import type { Conversation } from "@totem/types";

type Env = {
    Variables: {
        user: User;
        session: Session;
    };
};

const app = new Hono<Env>();

app.use(
    "/*",
    cors({
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        credentials: true,
    }),
);

app.use(
    "/static/*",
    serveStatic({
        root: "./data/uploads",
        rewriteRequestPath: (p) => p.replace(/^\/static/, ""),
    }),
);

app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/auth/login") return next();

    if (c.req.method !== "GET") {
        const origin = c.req.header("Origin");
        const allowed = process.env.FRONTEND_URL || "http://localhost:5173";
        if (!origin || origin !== allowed) {
            return c.json({ error: "Forbidden" }, 403);
        }
    }

    const token = getCookie(c, "session");
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const { session, user } = validateSessionToken(token);
    if (!session) {
        deleteSessionTokenCookie(c);
        return c.json({ error: "Unauthorized" }, 401);
    }

    setSessionTokenCookie(c, token, session.expiresAt);

    c.set("user", user);
    c.set("session", session);

    await next();
});

app.post("/api/auth/login", async (c) => {
    const { username, password } = await c.req.json();
    const user = db
        .prepare("SELECT * FROM users WHERE username = ?")
        .get(username) as any;

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return c.json({ error: "Invalid credentials" }, 401);
    }

    const token = generateSessionToken();
    const session = createSession(token, user.id);
    setSessionTokenCookie(c, token, session.expiresAt);

    return c.json({
        user: { id: user.id, username: user.username, role: user.role },
    });
});

app.post("/api/auth/logout", async (c) => {
    const session = c.get("session");
    if (session) invalidateSession(session.id);
    deleteSessionTokenCookie(c);
    return c.json({ success: true });
});

app.get("/api/auth/me", (c) => {
    const user = c.get("user");
    return c.json({ user });
});

app.get("/api/catalog", (c) => c.json(CatalogService.getAll()));

app.post("/api/catalog", async (c) => {
    const body = await c.req.parseBody();
    const file = body["image"] as File;
    if (!file) return c.json({ error: "Missing image" }, 400);

    const segment = body["segment"] as string;
    const category = body["category"] as string;
    const fileName = `${Date.now()}_${file.name}`;
    const dir = `./data/uploads/catalog/${segment}/${category}`;

    await Bun.write(`${dir}/${fileName}`, await file.arrayBuffer());

    const user = c.get("user");
    const prod = CatalogService.create({
        id: crypto.randomUUID(),
        segment: segment as any,
        category,
        name: body["name"] as string,
        description: body["description"] as string,
        price: parseFloat(body["price"] as string),
        image_main_path: `catalog/${segment}/${category}/${fileName}`,
        image_specs_path: null,
        created_by: user.id,
    });
    return c.json(prod);
});

app.post("/api/catalog/bulk", async (c) => {
    const body = await c.req.parseBody();
    const csvFile = body["csv"] as File;
    if (!csvFile) return c.json({ error: "CSV required" }, 400);

    const text = await csvFile.text();
    const user = c.get("user");
    const result = await BulkImportService.processCsv(text, user.id);
    return c.json(result);
});

app.get("/api/conversations", (c) => {
    const rows = db
        .prepare(
            "SELECT * FROM conversations ORDER BY last_activity_at DESC LIMIT 50",
        )
        .all();
    return c.json(rows);
});

app.post("/api/conversations/:phone/takeover", (c) => {
    db.prepare(
        "UPDATE conversations SET status = ? WHERE phone_number = ?",
    ).run("human_takeover", c.req.param("phone"));
    return c.json({ success: true });
});

app.post("/api/conversations/:phone/message", async (c) => {
    const { content } = await c.req.json();
    await WhatsAppService.sendMessage(c.req.param("phone"), content);
    return c.json({ success: true });
});

app.get("/api/reports/daily", (c) => {
    const buffer = ReportService.generateDailyReport();
    c.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    c.header(
        "Content-Disposition",
        `attachment; filename="report-${new Date().toISOString().split("T")[0]}.xlsx"`,
    );
    return c.body(buffer);
});

app.get("/api/health", (c) => {
    const health = getProvidersHealth();
    const allHealthy = health.fnb.available && health.gaso.available;

    return c.json({
        status: allHealthy ? "healthy" : "degraded",
        providers: health,
        timestamp: new Date().toISOString(),
    });
});

app.get("/api/providers/:dni", async (c) => {
    const dni = c.req.param("dni");

    if (!dni) {
        return c.json({ error: "DNI es requerido" }, 400);
    }

    if (!/^\d{8}$/.test(dni)) {
        return c.json({ error: "DNI debe tener 8 dígitos" }, 400);
    }

    const { FNBProvider, GasoProvider } = await import("./services/providers");
    const healthStatus = getProvidersHealth();

    try {
        // Try FNB first (if available)
        let fnbResult = null;
        if (healthStatus.fnb.available) {
            fnbResult = await FNBProvider.checkCredit(dni);
            if (fnbResult.eligible) {
                return c.json({
                    provider: "fnb",
                    dni,
                    result: fnbResult,
                    providersChecked: ["fnb"],
                });
            }
        }

        // If not found in FNB, try Gaso (if available)
        let gasoResult = null;
        if (healthStatus.gaso.available) {
            gasoResult = await GasoProvider.checkEligibility(dni);
            if (gasoResult.eligible || gasoResult.reason !== "not_found") {
                const checked = healthStatus.fnb.available
                    ? ["fnb", "gaso"]
                    : ["gaso"];
                return c.json({
                    provider: "gaso",
                    dni,
                    result: gasoResult,
                    providersChecked: checked,
                });
            }
        }

        // Not found in either or both providers unavailable
        const checked: string[] = [];
        if (healthStatus.fnb.available) checked.push("fnb");
        if (healthStatus.gaso.available) checked.push("gaso");

        return c.json({
            provider: null,
            dni,
            result: { eligible: false, credit: 0, reason: "not_found" },
            providersChecked: checked,
            providersUnavailable:
                !healthStatus.fnb.available || !healthStatus.gaso.available
                    ? {
                          fnb: !healthStatus.fnb.available,
                          gaso: !healthStatus.gaso.available,
                      }
                    : undefined,
        });
    } catch (error) {
        console.error("Provider query error:", error);
        return c.json({ error: "Error al consultar proveedor" }, 500);
    }
});

app.get("/webhook", (c) => {
    if (
        c.req.query("hub.verify_token") ===
        process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    ) {
        return c.text(c.req.query("hub.challenge") || "");
    }
    return c.text("Forbidden", 403);
});

app.post("/webhook", async (c) => {
    const body = await c.req.json();
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== "text")
        return c.json({ status: "ignored" });

    const phone = message.from;
    const text = message.text.body;

    let conv = db
        .prepare("SELECT * FROM conversations WHERE phone_number = ?")
        .get(phone) as Conversation;
    if (!conv) {
        db.prepare("INSERT INTO conversations (phone_number) VALUES (?)").run(
            phone,
        );
        conv = {
            phone_number: phone,
            current_state: "INIT",
            status: "active",
        } as Conversation;
    }

    db.prepare(
        "INSERT INTO messages (id, phone_number, direction, type, content) VALUES (?, ?, ?, ?, ?)",
    ).run(message.id, phone, "inbound", "text", text);

    if (conv.status === "human_takeover")
        return c.json({ status: "human_active" });

    const result = await runAgent(conv.current_state, text, conv);

    const updates = Object.keys(result.updatedContext)
        .map((k) => `${k} = ?`)
        .join(", ");
    if (updates) {
        db.prepare(
            `UPDATE conversations SET ${updates}, current_state = ?, last_activity_at = CURRENT_TIMESTAMP WHERE phone_number = ?`,
        ).run(...Object.values(result.updatedContext), result.nextState, phone);
    } else {
        db.prepare(
            "UPDATE conversations SET current_state = ?, last_activity_at = CURRENT_TIMESTAMP WHERE phone_number = ?",
        ).run(result.nextState, phone);
    }

    for (const msg of result.messages)
        await WhatsAppService.sendMessage(phone, msg);
    if (result.actions) {
        for (const act of result.actions)
            if (act.type === "SEND_IMAGE")
                await WhatsAppService.sendImage(phone, act.path);
    }

    return c.json({ status: "processed" });
});

export default { port: 3000, fetch: app.fetch };
