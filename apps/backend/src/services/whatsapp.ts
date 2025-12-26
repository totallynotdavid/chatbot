import { db } from "../db/index.ts";
import process from "node:process";
import type { Message } from "@totem/types";

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

export const WhatsAppService = {
    async sendMessage(to: string, content: string): Promise<void> {
        if (!TOKEN || !PHONE_ID) {
            console.warn("WhatsApp not configured, message not sent");
            this.logMessage(to, "outbound", "text", content, "skipped");
            return;
        }

        try {
            const response = await fetch(
                `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`,
                {
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
                },
            );

            if (!response.ok) {
                const error = await response.json();
                console.error("WhatsApp API error:", error);
            }

            const status = response.ok ? "sent" : "failed";
            this.logMessage(to, "outbound", "text", content, status);
        } catch (error) {
            console.error("WhatsApp send error:", error);
            this.logMessage(to, "outbound", "text", content, "failed");
        }
    },

    async markAsReadAndShowTyping(messageId: string): Promise<void> {
        if (!TOKEN || !PHONE_ID) {
            return;
        }

        try {
            await fetch(
                `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${TOKEN}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        messaging_product: "whatsapp",
                        status: "read",
                        message_id: messageId,
                        typing_indicator: {
                            type: "text"
                        }
                    }),
                },
            );
        } catch (error) {
            // Non-critical, don't log
        }
    },

    async sendImage(
        to: string,
        imagePath: string,
        caption?: string,
    ): Promise<void> {
        if (!TOKEN || !PHONE_ID) {
            console.warn("WhatsApp not configured, image not sent:", imagePath);
            this.logMessage(to, "outbound", "image", imagePath, "skipped");
            return;
        }

        const link = `${PUBLIC_URL}/static/${imagePath}`;

        try {
            const payload: any = {
                messaging_product: "whatsapp",
                to,
                type: "image",
                image: { link },
            };

            if (caption) {
                payload.image.caption = caption;
            }

            const response = await fetch(
                `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${TOKEN}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                },
            );

            const status = response.ok ? "sent" : "failed";
            this.logMessage(to, "outbound", "image", imagePath, status);
        } catch (error) {
            console.error("WhatsApp send image error:", error);
            this.logMessage(to, "outbound", "image", imagePath, "failed");
        }
    },

    logMessage(
        phoneNumber: string,
        direction: "inbound" | "outbound",
        type: "text" | "image",
        content: string,
        status: string = "sent",
    ): void {
        const id = crypto.randomUUID();
        db.prepare(
            `INSERT INTO messages (id, phone_number, direction, type, content, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, phoneNumber, direction, type, content, status);
    },

    getMessageHistory(
        phoneNumber: string,
        limit: number = 50,
    ): Message[] {
        return db
            .prepare(
                `SELECT * FROM messages 
         WHERE phone_number = ? 
         ORDER BY created_at DESC, ROWID DESC 
         LIMIT ?`,
            )
            .all(phoneNumber, limit) as Message[];
    },

    clearMessageHistory(phoneNumber: string): void {
        db.prepare(`DELETE FROM messages WHERE phone_number = ?`).run(
            phoneNumber,
        );
    },
};
