import { startServer } from "./server.ts";
import { initializeWhatsAppClient } from "./client.ts";
import { appLogger } from "./logger.ts";

appLogger.info("Starting notifier service...");

try {
  await initializeWhatsAppClient();
  await startServer();
  appLogger.info("Notifier service is up");
} catch (error) {
  appLogger.error({ error }, "Failed to start notifier service");
  process.exit(1);
}
