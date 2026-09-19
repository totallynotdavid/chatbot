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
 * A send refused because the number it would have gone out on is not active.
 *
 * This one failure is thrown rather than recorded and swallowed, because the
 * queues above this layer decide what to do with the customer's message on the
 * strength of whether the send threw. A `pending` or `disabled` account is
 * somebody's reversible decision about a number, not a dead conversation: the
 * aggregator leaves the inbox row pending and the maintenance sweep leaves the
 * held row held, so switching a number off pauses its conversations instead of
 * swallowing them. Everything else that can go wrong here - a tenant that was
 * suspended, an account that no longer exists, a reference assembled from two
 * tenants - is permanent for this conversation, and stays a logged failure.
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

/** The account to send on, or why there is none to send on. */
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
    // Every customer-facing send lands here, so this is where suspension stops
    // being a login rule and starts being a silence. `sendDirect` deliberately
    // does not pass through: platform alerts about a business are still worth
    // delivering after it is closed.
    logger.warn(
      { channelAccountId: account.id, tenantId: account.tenant_id },
      "Refusing to send for a tenant that is not active",
    );
    return { unsendable: null };
  }

  if (account.tenant_id !== ref.tenantId) {
    // A mismatch means a conversation reference was assembled from two
    // different tenants; refuse rather than send on the wrong account.
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

  // Checked last, so a suspended business stays the reason a send did not
  // happen even when its number is also switched off: suspension is the wider
  // fact, and it is already what keeps these messages off the queue.
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
   * Read receipts and the typing indicator are courtesies, so this one does not
   * throw on an account it cannot use: it is called before any work is done,
   * including on simulated conversations, which run on whichever number the
   * tenant has and never send anything at all.
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
