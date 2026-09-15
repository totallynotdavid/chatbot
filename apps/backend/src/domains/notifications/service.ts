import { notifyTeam } from "../../adapters/notifier/client.ts";
import { templates, type NotificationContext } from "./templates.ts";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("notification-service");

type Channel = "agent" | "dev" | "sales" | "direct";

export class NotificationService {
  private static async send(
    channel: Channel,
    message: string,
    options?: { phoneNumber?: string },
  ): Promise<void> {
    try {
      // notifyTeam reports a refused or timed-out delivery by returning false
      // rather than throwing, so the answer has to be read to notice it.
      const sent = await notifyTeam(channel, message, options);

      if (!sent) {
        logger.error({ channel }, "Internal notification was not delivered");
      }
    } catch (error) {
      logger.error({ error, channel }, "Failed to send internal notification");
    }
  }

  static async notifyAgentAssignment(
    agentPhone: string,
    ctx: NotificationContext,
  ): Promise<void> {
    const message = templates.assignment(ctx);
    await NotificationService.send("direct", message, {
      phoneNumber: agentPhone,
    });
  }

  static async notifyNewOrder(
    ctx: NotificationContext,
    orderNumber: string,
    amount: number,
  ): Promise<void> {
    const message = templates.newOrder(ctx, orderNumber, amount);
    await NotificationService.send("sales", message);
  }

  static async notifyContractUploaded(ctx: NotificationContext): Promise<void> {
    const message = templates.contractUploaded(ctx);
    await NotificationService.send("sales", message);
  }

  static async notifySystemOutage(
    channel: "agent" | "dev",
    ctx: NotificationContext,
    errors: string[],
  ): Promise<void> {
    const message = templates.systemOutage(ctx, errors);
    await NotificationService.send(channel, message);
  }

  static async notifyDegradation(
    ctx: NotificationContext,
    failed: string,
    working: string,
  ): Promise<void> {
    const message = templates.degradation(ctx, failed, working);
    await NotificationService.send("dev", message);
  }

  static async notifySystemError(
    ctx: NotificationContext,
    error: string,
  ): Promise<void> {
    const message = templates.systemError(ctx, error);
    await NotificationService.send("dev", message);
  }
}
