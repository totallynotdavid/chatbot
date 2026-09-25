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
  const message = error instanceof Error ? error.message : String(error);
  logger.error(
    {
      err: error,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    },
    "Failed to start notifier service",
  );
  console.error(message);
  process.exit(1);
}
