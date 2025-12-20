import { Hono } from "hono";
import { db } from "../db/index.ts";
import { WhatsAppService } from "../services/whatsapp.ts";
import { getEventsByPhone } from "../services/analytics.ts";
import { logAction } from "../services/audit.ts";
import type { Conversation } from "@totem/types";

const conversations = new Hono();

// List all conversations
conversations.get("/", (c) => {
    const status = c.req.query("status");
    let query = "SELECT * FROM conversations ORDER BY last_activity_at DESC LIMIT 100";
    let params: any[] = [];

    if (status) {
        query =
            "SELECT * FROM conversations WHERE status = ? ORDER BY last_activity_at DESC LIMIT 100";
        params = [status];
    }

    const rows = db.prepare(query).all(...params) as Conversation[];
    return c.json(rows);
});

// Get conversation detail with messages
conversations.get("/:phone", (c) => {
    const phoneNumber = c.req.param("phone");

    const conv = db
        .prepare("SELECT * FROM conversations WHERE phone_number = ?")
        .get(phoneNumber) as Conversation | undefined;

    if (!conv) {
        return c.json({ error: "Conversation not found" }, 404);
    }

    const messages = WhatsAppService.getMessageHistory(phoneNumber, 100);
    const events = getEventsByPhone(phoneNumber);

    return c.json({
        conversation: conv,
        messages: messages.reverse(),
        events,
    });
});

// Manual takeover
conversations.post("/:phone/takeover", (c) => {
    const phoneNumber = c.req.param("phone");
    const user = c.get("user");

    db.prepare(
        `UPDATE conversations
         SET status = 'human_takeover',
             handover_reason = 'Manual takeover by agent',
             last_activity_at = CURRENT_TIMESTAMP
         WHERE phone_number = ?`,
    ).run(phoneNumber);

    logAction(user.id, "takeover", "conversation", phoneNumber, {
        agent: user.username,
    });

    return c.json({ success: true });
});

// Send manual message
conversations.post("/:phone/message", async (c) => {
    const phoneNumber = c.req.param("phone");
    const { content } = await c.req.json();
    const user = c.get("user");

    if (!content) {
        return c.json({ error: "content required" }, 400);
    }

    await WhatsAppService.sendMessage(phoneNumber, content);

    logAction(user.id, "send_message", "conversation", phoneNumber, {
        message: content,
    });

    return c.json({ success: true });
});

// Release conversation back to bot
conversations.post("/:phone/release", (c) => {
    const phoneNumber = c.req.param("phone");
    const user = c.get("user");

    db.prepare(
        `UPDATE conversations
         SET status = 'active',
             handover_reason = NULL
         WHERE phone_number = ?`,
    ).run(phoneNumber);

    logAction(user.id, "release", "conversation", phoneNumber);

    return c.json({ success: true });
});

export default conversations;
