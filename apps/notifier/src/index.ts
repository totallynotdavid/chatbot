import { startServer } from "./server.ts";
import { initializeWhatsAppClient } from "./whatsapp-client.ts";
import { loadGroupMapping } from "./group-registry.ts";
import { appLogger } from "./logger.ts";

appLogger.info("Starting notifier service...");

try {
  loadGroupMapping();
  await initializeWhatsAppClient();
  await startServer();
  appLogger.info("Notifier service is up");
} catch (error) {
  appLogger.error({ error }, "Failed to start notifier service");
  process.exit(1);
}
