import { createLogger } from "../../lib/logger.ts";
import { getNotifierUrl } from "@vendeya/utils";
import { createAbortTimeout, TIMEOUTS } from "../../config/timeouts.ts";

const logger = createLogger("notifier");

const notifierUrl = getNotifierUrl();

type NotifyRequest = {
  channel: "agent" | "dev" | "sales" | "direct";
  message: string;
  phoneNumber?: string;
};

export async function notifyTeam(
  channel: "agent" | "dev" | "sales" | "direct",
  message: string,
  options?: { phoneNumber?: string },
): Promise<boolean> {
  const { signal, cleanup } = createAbortTimeout(TIMEOUTS.NOTIFIER);

  try {
    const payload: NotifyRequest = { channel, message };
    if (options?.phoneNumber) {
      payload.phoneNumber = options.phoneNumber;
    }

    const response = await fetch(`${notifierUrl}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    cleanup();

    return response.ok;
  } catch (error) {
    cleanup();

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        logger.error(
          { channel, timeoutMs: TIMEOUTS.NOTIFIER },
          "Notifier timeout",
        );
      } else {
        logger.error({ error, channel }, "Notifier service error");
      }
    }

    return false;
  }
}

export async function checkNotifierHealth(): Promise<boolean> {
  const { signal, cleanup } = createAbortTimeout(3000); // Shorter timeout for health check

  try {
    const response = await fetch(`${notifierUrl}/health`, {
      method: "GET",
      signal,
    });

    cleanup();
    return response.ok;
  } catch {
    cleanup();
    return false;
  }
}
