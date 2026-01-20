import { Hono } from "hono";
import { isOk } from "../../shared/result/index.ts";
import { RetryEligibilityHandler } from "../../domains/recovery/handlers/index.ts";
import { countWaitingForRecovery } from "../../domains/recovery/store/index.ts";
import {
  processHeldMessages,
  countHeldMessages,
} from "../../conversation/index.ts";
import { logAction } from "../../platform/audit/logger.ts";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("admin-operations");

const operations = new Hono();

operations.get("/held-messages-status", (c) => {
  const count = countHeldMessages();
  return c.json({ pendingCount: count });
});

// Process held messages from maintenance mode
operations.post("/process-held-messages", async (c) => {
  const user = c.get("user");
  const pendingCount = countHeldMessages();

  if (pendingCount === 0) {
    return c.json({
      success: true,
      message: "No held messages to process",
      stats: { usersProcessed: 0, messagesProcessed: 0, errors: 0 },
    });
  }

  logger.info(
    { username: user.username, pendingCount },
    "Admin triggered held messages processing",
  );

  const result = await processHeldMessages();

  logAction(user.id, "process_held_messages", "system", null, result);

  const userWord = result.usersProcessed === 1 ? "usuario" : "usuarios";
  const messageWord = result.messagesProcessed === 1 ? "mensaje" : "mensajes";

  return c.json({
    success: true,
    message: `Procesados ${result.messagesProcessed} ${messageWord} de ${result.usersProcessed} ${userWord}`,
    stats: result,
  });
});

operations.get("/outage-status", (c) => {
  const waitingCount = countWaitingForRecovery();
  return c.json({ waitingCount });
});

// Retry eligibility for waiting users
operations.post("/retry-eligibility", async (c) => {
  const user = c.get("user");
  const handler = new RetryEligibilityHandler();

  const result = await handler.execute();

  if (isOk(result)) {
    const stats = result.value;
    logAction(user.id, "retry_eligibility", "system", null, stats);

    return c.json({
      success: true,
      message: `Recuperados ${stats.recoveredCount}, fallando ${stats.stillFailingCount}, errores ${stats.errors}`,
      stats,
    });
  }

  logger.error({ error: result.error }, "Retry eligibility failed");
  return c.json({ error: result.error.message }, 500);
});

export default operations;
