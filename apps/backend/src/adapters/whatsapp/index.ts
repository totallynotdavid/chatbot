import process from "node:process";
import type { ChannelAccount, ConversationRef } from "@totem/types";
import type { ConversationMessage, StoredMessageType } from "./types.ts";
import { CloudApiAdapter } from "./cloud-api.ts";
import { DevAdapter } from "./dev-adapter.ts";
import { MessageStore } from "./message-store.ts";
import { ChannelAccountService } from "../../domains/channels/accounts.ts";
import { TenantService } from "../../domains/tenants/index.ts";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("whatsapp");

const IS_DEV = process.env.NODE_ENV === "development";

function getAdapter() {
  if (IS_DEV) {
    return DevAdapter;
  }
  return CloudApiAdapter;
}

const adapter = getAdapter();

/**
 * Thrown when a send targets a `pending` or `disabled` channel account of an
 * open tenant. The aggregator leaves the inbox row pending and the maintenance
 * sweep leaves the held row held, so switching a number off pauses its
 * conversations.
 */
export class ChannelUnavailableError extends Error {
  constructor(
    readonly ref: ConversationRef,
    readonly status: ChannelAccount["status"],
  ) {
    super(
      `Channel account ${ref.channelAccountId} is ${status}, not active: nothing was sent`,
    );
    this.name = "ChannelUnavailableError";
  }
}

/**
 * `unsendable` holds the account when its tenant is open and the ref matches it,
 * but the account is not active. The caller turns that into a throw. It is null
 * for a permanent refusal (suspended tenant, missing account, ref built from two
 * tenants), which is logged and not thrown.
 */
type SendTarget =
  | { account: ChannelAccount }
  | { unsendable: ChannelAccount | null };

function resolveAccount(ref: ConversationRef): SendTarget {
  const account = ChannelAccountService.getById(ref.channelAccountId);

  if (!account) {
    logger.error(
      { channelAccountId: ref.channelAccountId, tenantId: ref.tenantId },
      "Channel account not found for conversation",
    );
    return { unsendable: null };
  }

  if (!TenantService.isOpen(account.tenant_id)) {
    // A suspended tenant sends nothing to customers. `sendDirect` skips this
    // check so platform alerts about a closed business still go out.
    logger.warn(
      { channelAccountId: account.id, tenantId: account.tenant_id },
      "Refusing to send for a tenant that is not active",
    );
    return { unsendable: null };
  }

  if (account.tenant_id !== ref.tenantId) {
    // A mismatch means the conversation ref was assembled from two tenants.
    // Refuse it instead of sending on the wrong account.
    logger.error(
      {
        channelAccountId: account.id,
        accountTenantId: account.tenant_id,
        refTenantId: ref.tenantId,
      },
      "Channel account does not belong to the conversation's tenant",
    );
    return { unsendable: null };
  }

  // This check runs after the tenant check. A suspended business whose number
  // is also switched off is refused as suspended, which does not throw.
  if (account.status !== "active") {
    logger.warn(
      {
        channelAccountId: account.id,
        tenantId: account.tenant_id,
        status: account.status,
      },
      "Refusing to send on a channel account that is not active",
    );
    return { unsendable: account };
  }

  return { account };
}

export const WhatsAppService = {
  async sendMessage(ref: ConversationRef, content: string): Promise<void> {
    const target = resolveAccount(ref);
    if (!("account" in target)) {
      MessageStore.log(ref, "outbound", "text", content, "failed");
      if (target.unsendable) {
        throw new ChannelUnavailableError(ref, target.unsendable.status);
      }
      return;
    }
    const { account } = target;

    const messageId = await adapter.sendMessage(
      account,
      ref.phoneNumber,
      content,
    );
    const status = messageId ? "sent" : "failed";
    MessageStore.log(
      ref,
      "outbound",
      "text",
      content,
      status,
      messageId ?? undefined,
    );
  },

  async sendImage(
    ref: ConversationRef,
    imagePath: string,
    caption?: string,
    productId?: string,
  ): Promise<void> {
    const target = resolveAccount(ref);
    if (!("account" in target)) {
      MessageStore.log(
        ref,
        "outbound",
        "image",
        imagePath,
        "failed",
        undefined,
        productId,
      );
      if (target.unsendable) {
        throw new ChannelUnavailableError(ref, target.unsendable.status);
      }
      return;
    }
    const { account } = target;

    const messageId = await adapter.sendImage(
      account,
      ref.phoneNumber,
      imagePath,
      caption,
    );
    const status = messageId ? "sent" : "failed";
    MessageStore.log(
      ref,
      "outbound",
      "image",
      imagePath,
      status,
      messageId ?? undefined,
      productId,
    );
  },

  /**
   * Send to a number that is not a customer conversation (an agent's phone, a
   * WhatsApp group). Nothing is written to `messages`: these are not part of a
   * conversation thread, and notification delivery is recorded separately in
   * `notification_traces`.
   */
  async sendDirect(
    account: ChannelAccount,
    to: string,
    content: string,
  ): Promise<boolean> {
    const messageId = await adapter.sendMessage(account, to, content);
    return messageId !== null;
  },

  /**
   * Unlike the send methods, this does not throw for an account that is not
   * active. It runs before the reply is worked out, including for simulated
   * conversations, which use whichever number the tenant has.
   */
  async markAsReadAndShowTyping(
    ref: ConversationRef,
    messageId: string,
  ): Promise<void> {
    const target = resolveAccount(ref);
    if (!("account" in target)) return;
    await adapter.markAsRead(target.account, messageId);
  },

  logMessage(
    ref: ConversationRef,
    direction: "inbound" | "outbound",
    type: StoredMessageType,
    content: string,
    status: string = "sent",
  ): void {
    MessageStore.log(ref, direction, type, content, status);
  },

  getMessageHistory(
    ref: ConversationRef,
    limit: number = 50,
  ): ConversationMessage[] {
    return MessageStore.getHistory(ref, limit);
  },

  clearMessageHistory(ref: ConversationRef): void {
    MessageStore.clear(ref);
  },

  findProductByQuotedMessage(
    ref: ConversationRef,
    whatsappMessageId: string,
  ): string | null {
    return MessageStore.findProductByMessageId(ref, whatsappMessageId);
  },

  getMessageById(
    ref: ConversationRef,
    whatsappMessageId: string,
  ): ConversationMessage | null {
    return MessageStore.getMessageById(ref, whatsappMessageId);
  },
};
