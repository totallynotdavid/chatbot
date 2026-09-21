import { Hono } from "hono";
import { enqueueMessage } from "./queue.ts";
import { sendDirectMessage, sendDirectImage } from "./direct-messaging.ts";
import { client } from "./whatsapp-client.ts";
import process from "node:process";
import { createLogger } from "./logger.ts";

const logger = createLogger("server");

const app = new Hono();

// Direct message endpoint (used by backend dev adapter)
app.post("/send", async (c) => {
  const { phoneNumber, content } = await c.req.json();

  if (!phoneNumber || !content) {
    return c.json({ error: "phoneNumber and content required" }, 400);
  }

  try {
    const messageId = await sendDirectMessage(phoneNumber, content);
    return c.json({ status: "sent", messageId });
  } catch (error) {
    logger.error({ error, phoneNumber }, "Direct message send failed");
    return c.json({ error: "Failed to send message" }, 500);
  }
});

// Direct image endpoint (used by backend dev adapter)
app.post("/send-image", async (c) => {
  const { phoneNumber, imageUrl, caption } = await c.req.json();

  if (!phoneNumber || !imageUrl) {
    return c.json({ error: "phoneNumber and imageUrl required" }, 400);
  }

  try {
    const messageId = await sendDirectImage(phoneNumber, imageUrl, caption);
    return c.json({ status: "sent", messageId });
  } catch (error) {
    logger.error({ error, phoneNumber, imageUrl }, "Direct image send failed");
    return c.json({ error: "Failed to send image" }, 500);
  }
});

// Team notifications endpoint (existing)
app.post("/notify", async (c) => {
  const { channel, message, phoneNumber } = await c.req.json();

  if (!channel || !message) {
    return c.json({ error: "channel and message required" }, 400);
  }

  // Support direct messaging to specific phone numbers
  if (channel === "direct") {
    if (!phoneNumber) {
      return c.json({ error: "phoneNumber required for direct channel" }, 400);
    }
    enqueueMessage("direct", message, phoneNumber);
    return c.json({ status: "queued" });
  }

  if (channel !== "agent" && channel !== "dev" && channel !== "sales") {
    return c.json(
      { error: "channel must be 'agent', 'dev', 'sales', or 'direct'" },
      400,
    );
  }

  enqueueMessage(channel, message);

  return c.json({ status: "queued" });
});

app.get("/health", (c) => {
  const isReady = client?.info !== undefined;

  return c.json({
    status: isReady ? "ready" : "initializing",
    timestamp: new Date().toISOString(),
  });
});

export async function startServer() {
  const port = parseInt(process.env.NOTIFIER_PORT || "3001", 10);

  // The endpoints above take no credential, so only this machine may reach them.
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: app.fetch,
  });

  logger.info({ hostname: "127.0.0.1", port }, "HTTP server listening");
}
