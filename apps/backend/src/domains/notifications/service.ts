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
      await notifyTeam(channel, message, options);
    } catch (error) {
      logger.error({ error, channel }, "Failed to send internal notification");
    }
  }

  static async notifyAgentAssignment(
    agentPhone: string,
    ctx: NotificationContext,
  ): Promise<void> {
    const message = templates.assignment(ctx);
    await this.send("direct", message, { phoneNumber: agentPhone });
  }

  static async notifyNewOrder(
    ctx: NotificationContext,
    orderNumber: string,
    amount: number,
  ): Promise<void> {
    const message = templates.newOrder(ctx, orderNumber, amount);
    await this.send("sales", message);
  }

  static async notifyContractUploaded(
    ctx: NotificationContext,
    agentName: string,
  ): Promise<void> {
    const message = templates.contractUploaded(ctx, agentName);
    await this.send("sales", message);
  }

  static async notifySystemOutage(
    channel: "agent" | "dev",
    ctx: NotificationContext,
    errors: string[],
  ): Promise<void> {
    const message = templates.systemOutage(ctx, errors);
    await this.send(channel, message);
  }

  static async notifyDegradation(
    ctx: NotificationContext,
    details: string,
  ): Promise<void> {
    const message = templates.degradation(ctx, details);
    await this.send("dev", message);
  }

  static async notifyError(
    ctx: NotificationContext,
    errorDetails: string,
  ): Promise<void> {
    const message = templates.error(ctx, errorDetails);
    await this.send("dev", message);
  }
  static async notifyGeneric(
    channel: Channel,
    ctx: NotificationContext,
    message: string,
  ): Promise<void> {
    const formattedMessage = templates.generic(ctx, message);
    await this.send(channel, formattedMessage);
  }
}
