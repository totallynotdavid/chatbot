/**
 * A reply the bot could not send is kept instead of lost. The turn's callers
 * ask for that with `retry`; an agent's manual reply does not, because the
 * agent is looking at the error. The only fake is the network.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import process from "node:process";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import type { ConversationRef } from "@totem/types";

import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";
import { WhatsAppService } from "../src/adapters/whatsapp/index.ts";
import type { OutboxRow } from "../src/conversation/outbox.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import { sendManualMessage } from "../src/domains/conversations/write.ts";

const CUSTOMER = "51900777001";

describe("a send the turn asked to keep", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let ref: ConversationRef;
  let agent: string;
  let originalFetch: typeof globalThis.fetch;
  let requests: number;
  let answer: () => Response;

  const accepted = () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), {
      headers: { "Content-Type": "application/json" },
    });
  /** A 502 with an HTML body: the adapter classifies it `transient`. */
  const unreachable = () =>
    new Response("<html>Bad gateway</html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });
  /** Meta's re-engagement error: the adapter classifies it `permanent`. */
  const refused = () =>
    new Response(JSON.stringify({ error: { code: 131047 } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

  function outboxRows(): OutboxRow[] {
    return db
      .prepare(
        `SELECT * FROM outbox
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
         ORDER BY id`,
      )
      .all(ref.tenantId, ref.channelAccountId, ref.phoneNumber) as OutboxRow[];
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e5".repeat(32);

    applySchema();
    tenant = createTenantFixture("outbox-service");
    // A number that genuinely sends, so the adapter reaches the fake network.
    db.prepare("DELETE FROM channel_accounts WHERE id = ?").run(
      tenant.channelAccountId,
    );
    const account = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: tenant.phoneNumberId,
      accessToken: "EAAG-a-real-looking-token",
    });
    tenant.channelAccountId = account.id;
    ref = {
      tenantId: tenant.tenantId,
      channelAccountId: account.id,
      phoneNumber: CUSTOMER,
    };
    insertConversation(ref);
    agent = createMember(tenant, "sales_agent").userId;

    requests = 0;
    answer = accepted;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      requests++;
      return answer();
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    db.prepare("DELETE FROM audit_log WHERE user_id = ?").run(agent);
    dropTenantFixture(tenant);
  });

  it("queues a text WhatsApp could not take, and marks its message queued", async () => {
    answer = unreachable;

    const result = await WhatsAppService.sendMessage(ref, "hola", {
      retry: true,
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "transient",
      queued: true,
    });
    const rows = outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "text",
      content: "hola",
      status: "pending",
      attempts: 1,
      ambiguous_attempts: 0,
      last_kind: "transient",
      last_reason: "http_502",
      handed_off_at: null,
    });
    expect(rows[0]!.next_attempt_at).toBe(rows[0]!.created_at + 5000);

    const history = MessageStore.getHistory(ref);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "queued", content: "hola" });
    expect(history[0]!.id).toBe(rows[0]!.message_id);
  });

  it("queues an image with its caption, and leaves the product on the message row", async () => {
    answer = unreachable;

    const result = await WhatsAppService.sendImage(
      ref,
      "images/img-1.jpg",
      "Cocina 4 hornillas",
      "bundle-1",
      { retry: true },
    );

    expect(result).toMatchObject({ queued: true });
    expect(outboxRows()[0]).toMatchObject({
      type: "image",
      content: "images/img-1.jpg",
      caption: "Cocina 4 hornillas",
      status: "pending",
    });
    expect(MessageStore.getHistory(ref)[0]).toMatchObject({
      type: "image",
      status: "queued",
      product_id: "bundle-1",
    });
  });

  it("keeps a permanently refused text as a failed row, and does not queue it", async () => {
    answer = refused;

    const result = await WhatsAppService.sendMessage(ref, "hola", {
      retry: true,
    });

    expect(result).toMatchObject({ ok: false, kind: "permanent" });
    expect(result.queued).toBeUndefined();
    expect(outboxRows()[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      last_kind: "permanent",
      last_reason: "http_400:131047",
      handed_off_at: null,
    });
    expect(MessageStore.getHistory(ref)[0]).toMatchObject({ status: "failed" });
  });

  it("writes no row and no second message for an accepted send", async () => {
    const result = await WhatsAppService.sendMessage(ref, "hola", {
      retry: true,
    });

    expect(result).toEqual({ ok: true, messageId: "wamid.OK" });
    expect(outboxRows()).toEqual([]);
    const history = MessageStore.getHistory(ref);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      status: "sent",
      whatsapp_message_id: "wamid.OK",
    });
  });

  it("queues behind a reply already waiting, without asking WhatsApp", async () => {
    answer = unreachable;
    await WhatsAppService.sendMessage(ref, "primero", { retry: true });
    const requestsAfterFirst = requests;
    answer = accepted;

    const result = await WhatsAppService.sendMessage(ref, "segundo", {
      retry: true,
    });

    expect(requests).toBe(requestsAfterFirst);
    expect(result).toMatchObject({ ok: false, queued: true });
    const rows = outboxRows();
    expect(rows.map((row) => row.content)).toEqual(["primero", "segundo"]);
    expect(rows[1]).toMatchObject({
      status: "pending",
      attempts: 0,
      ambiguous_attempts: 0,
      last_kind: null,
      last_reason: null,
    });
    expect(rows[1]!.next_attempt_at).toBe(rows[1]!.created_at);
    expect(rows[1]!.id).toBeGreaterThan(rows[0]!.id);
  });

  it("queues behind a reply already waiting even when it is being sent", async () => {
    answer = unreachable;
    await WhatsAppService.sendMessage(ref, "primero", { retry: true });
    db.prepare("UPDATE outbox SET status = 'sending' WHERE tenant_id = ?").run(
      ref.tenantId,
    );
    const requestsAfterFirst = requests;
    answer = accepted;

    await WhatsAppService.sendMessage(ref, "segundo", { retry: true });

    expect(requests).toBe(requestsAfterFirst);
    expect(outboxRows().map((row) => row.status)).toEqual([
      "sending",
      "pending",
    ]);
  });

  it("queues nothing for a conversation of another number", async () => {
    answer = unreachable;
    await WhatsAppService.sendMessage(ref, "primero", { retry: true });

    const other = { ...ref, phoneNumber: "51900777002" };
    insertConversation(other);
    answer = accepted;

    const result = await WhatsAppService.sendMessage(other, "hola", {
      retry: true,
    });

    expect(result).toEqual({ ok: true, messageId: "wamid.OK" });
    expect(outboxRows()).toHaveLength(1);
  });

  it("keeps nothing when the caller did not ask for it", async () => {
    answer = unreachable;

    const result = await WhatsAppService.sendMessage(ref, "hola");

    expect(result).toMatchObject({ ok: false, kind: "transient" });
    expect(result.queued).toBeUndefined();
    expect(outboxRows()).toEqual([]);
    expect(MessageStore.getHistory(ref)[0]).toMatchObject({ status: "failed" });
  });

  it("keeps nothing for an agent's manual reply", async () => {
    answer = unreachable;

    const result = await sendManualMessage(ref, "Hola, soy Ana", agent);

    expect(result.success).toBe(false);
    expect(outboxRows()).toEqual([]);
    expect(MessageStore.getHistory(ref)[0]).toMatchObject({ status: "failed" });
  });

  it("keeps nothing for a suspended tenant, whose refusal is permanent", async () => {
    db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(
      tenant.tenantId,
    );

    const result = await WhatsAppService.sendMessage(ref, "hola", {
      retry: true,
    });

    expect(result).toEqual({
      ok: false,
      kind: "permanent",
      reason: "tenant_not_active",
    });
    expect(requests).toBe(0);
    expect(outboxRows()).toEqual([]);
  });

  it("still throws for a number switched off, and queues nothing", async () => {
    ChannelAccountService.updateStatus(ref.channelAccountId, "disabled");

    await expect(
      WhatsAppService.sendMessage(ref, "hola", { retry: true }),
    ).rejects.toThrow("is disabled, not active");
    expect(requests).toBe(0);
    expect(outboxRows()).toEqual([]);
  });
});
