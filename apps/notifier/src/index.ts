import { startServer } from "./server.ts";
import { initializeWhatsAppClient } from "./whatsapp-client.ts";
import { loadGroupMapping } from "./group-registry.ts";
import { createLogger } from "./logger.ts";

const logger = createLogger("notifier");

logger.info("Starting notifier service");

try {
  loadGroupMapping();
  await initializeWhatsAppClient();
  await startServer();
  logger.info("Notifier service ready");
} catch (error) {
  logger.error({ error }, "Failed to start notifier service");
  process.exit(1);
}
