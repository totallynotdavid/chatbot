import { db } from "../db";

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

export const WhatsAppService = {
    async sendMessage(to: string, content: string) {
        if (!TOKEN) return;

        await fetch(`https://graph.facebook.com/v17.0/${PHONE_ID}/messages`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to,
                type: "text",
                text: { body: content },
            }),
        });

        db.prepare(
            "INSERT INTO messages (id, phone_number, direction, type, content) VALUES (?, ?, ?, ?, ?)",
        ).run(crypto.randomUUID(), to, "outbound", "text", content);
    },

    async sendImage(to: string, imagePath: string) {
        if (!TOKEN) return;
        const link = `${process.env.PUBLIC_URL}/static/${imagePath}`;

        await fetch(`https://graph.facebook.com/v17.0/${PHONE_ID}/messages`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to,
                type: "image",
                image: { link },
            }),
        });

        db.prepare(
            "INSERT INTO messages (id, phone_number, direction, type, content) VALUES (?, ?, ?, ?, ?)",
        ).run(crypto.randomUUID(), to, "outbound", "image", imagePath);
    },
};
