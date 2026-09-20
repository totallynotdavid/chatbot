/**
 * A WhatsApp send reports what happened. `permanent` fails the same way if
 * repeated, `transient` never reached WhatsApp, and `ambiguous` may have been
 * accepted. The Cloud adapter classifies through one function for both text and
 * images, and the service turns the outcome into the `messages` row.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import process from "node:process";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import type { ChannelAccount, ConversationRef } from "@totem/types";

import { CloudApiAdapter } from "../src/adapters/whatsapp/cloud-api.ts";
import { WhatsAppService } from "../src/adapters/whatsapp/index.ts";
import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";
import type { SendOutcome } from "../src/adapters/whatsapp/types.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";

const CUSTOMER = "51900333444";
const TOKEN = "EAAG-secret-token-do-not-log";
const TEXT = "mensaje-privado-del-cliente";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const html = (status: number) =>
  new Response("<html><body>Bad gateway</body></html>", {
    status,
    headers: { "Content-Type": "text/html" },
  });

/** A `fetch` failure the way Node and Bun surface one: a code on the error. */
function failWith(name: string, code?: string): () => Response {
  return () => {
    const error = new Error(`${name} for ${TOKEN}`);
    error.name = name;
    if (code) Object.assign(error, { code });
    throw error;
  };
}

type Case = {
  name: string;
  respond: () => Response;
  expected: {
    ok: boolean;
    kind?: "permanent" | "transient" | "ambiguous";
    status?: number;
    reason?: string;
  };
};

const CASES: Case[] = [
  {
    name: "200 with a message id",
    respond: () => json(200, { messages: [{ id: "wamid.OK" }] }),
    expected: { ok: true },
  },
  {
    name: "200 without a message id",
    respond: () => json(200, { messaging_product: "whatsapp" }),
    expected: {
      ok: false,
      kind: "ambiguous",
      status: 200,
      reason: "no_message_id",
    },
  },
  {
    name: "400 with a Meta error body",
    respond: () =>
      json(400, {
        error: { message: `Re-engagement ${TEXT}`, code: 131047 },
      }),
    expected: {
      ok: false,
      kind: "permanent",
      status: 400,
      reason: "http_400:131047",
    },
  },
  {
    name: "401 for a bad token",
    respond: () => json(401, { error: { message: TOKEN, code: 190 } }),
    expected: {
      ok: false,
      kind: "permanent",
      status: 401,
      reason: "http_401:190",
    },
  },
  {
    name: "429",
    respond: () => json(429, { error: { code: 80007 } }),
    expected: {
      ok: false,
      kind: "transient",
      status: 429,
      reason: "http_429:80007",
    },
  },
  {
    name: "a throughput code on a 400",
    respond: () => json(400, { error: { code: 130429 } }),
    expected: {
      ok: false,
      kind: "transient",
      status: 400,
      reason: "http_400:130429",
    },
  },
  {
    name: "a pair rate-limit code on a 400",
    respond: () => json(400, { error: { code: 131056 } }),
    expected: {
      ok: false,
      kind: "transient",
      status: 400,
      reason: "http_400:131056",
    },
  },
  {
    name: "500",
    respond: () => json(500, { error: { code: 1 } }),
    expected: {
      ok: false,
      kind: "transient",
      status: 500,
      reason: "http_500:1",
    },
  },
  {
    name: "502 with an HTML body",
    respond: () => html(502),
    expected: {
      ok: false,
      kind: "transient",
      status: 502,
      reason: "http_502",
    },
  },
  {
    name: "400 with an HTML body",
    respond: () => html(400),
    expected: {
      ok: false,
      kind: "permanent",
      status: 400,
      reason: "http_400",
    },
  },
  {
    name: "an aborted request",
    respond: failWith("AbortError"),
    expected: { ok: false, kind: "ambiguous", reason: "timeout" },
  },
  {
    name: "a refused connection (Node)",
    respond: failWith("TypeError", "ECONNREFUSED"),
    expected: {
      ok: false,
      kind: "transient",
      reason: "network:ECONNREFUSED",
    },
  },
  {
    name: "a refused connection (Bun)",
    respond: failWith("TypeError", "ConnectionRefused"),
    expected: {
      ok: false,
      kind: "transient",
      reason: "network:ConnectionRefused",
    },
  },
  {
    name: "a DNS failure",
    respond: failWith("TypeError", "ENOTFOUND"),
    expected: { ok: false, kind: "transient", reason: "network:ENOTFOUND" },
  },
  {
    name: "a temporary DNS failure",
    respond: failWith("TypeError", "EAI_AGAIN"),
    expected: { ok: false, kind: "transient", reason: "network:EAI_AGAIN" },
  },
  {
    name: "a connection reset",
    respond: failWith("TypeError", "ECONNRESET"),
    expected: { ok: false, kind: "ambiguous", reason: "network:ECONNRESET" },
  },
  {
    name: "an error with no code",
    respond: failWith("Error"),
    expected: { ok: false, kind: "ambiguous", reason: "network_error" },
  },
];

describe("the Cloud API adapter classifies a send", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let account: ChannelAccount;
  let originalFetch: typeof globalThis.fetch;
  let respond: () => Response;

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e5".repeat(32);

    applySchema();
    tenant = createTenantFixture("send-outcome");
    account = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: `pnid-${crypto.randomUUID().slice(0, 8)}`,
      accessToken: TOKEN,
    });

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => respond()) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    dropTenantFixture(tenant);
  });

  const sends: Array<[string, () => Promise<SendOutcome>]> = [
    ["a text", () => CloudApiAdapter.sendMessage(account, CUSTOMER, TEXT)],
    [
      "an image",
      () => CloudApiAdapter.sendImage(account, CUSTOMER, "images/a.jpg", TEXT),
    ],
  ];

  for (const [what, send] of sends) {
    describe(`for ${what}`, () => {
      for (const c of CASES) {
        it(`${c.name}`, async () => {
          respond = c.respond;

          const outcome = await send();

          expect(outcome.ok).toBe(c.expected.ok);
          if (outcome.ok) {
            expect(outcome.messageId).toBe("wamid.OK");
            return;
          }
          expect(outcome.kind).toBe(c.expected.kind!);
          expect(outcome.status).toBe(c.expected.status);
          expect(outcome.reason).toBe(c.expected.reason!);

          const printed = JSON.stringify(outcome);
          expect(printed).not.toContain(TOKEN);
          expect(printed).not.toContain(TEXT);
          expect(printed).not.toContain(CUSTOMER);
        });
      }

      it("permanently refuses an account with no usable token", async () => {
        let requests = 0;
        respond = () => {
          requests++;
          return json(200, { messages: [{ id: "wamid.OK" }] });
        };
        const noToken = { ...account, access_token_secret_id: null };

        const outcome = await (what === "a text"
          ? CloudApiAdapter.sendMessage(noToken, CUSTOMER, TEXT)
          : CloudApiAdapter.sendImage(noToken, CUSTOMER, "images/a.jpg"));

        expect(outcome).toEqual({
          ok: false,
          kind: "permanent",
          reason: "no_token",
        });
        expect(requests).toBe(0);
      });
    });
  }
});

describe("WhatsAppService returns the outcome", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let ref: ConversationRef;
  let originalFetch: typeof globalThis.fetch;
  let respond: () => Response;

  function sendableRef(): ConversationRef {
    const account = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: `pnid-${crypto.randomUUID().slice(0, 8)}`,
      accessToken: TOKEN,
    });
    const created = {
      tenantId: tenant.tenantId,
      channelAccountId: account.id,
      phoneNumber: CUSTOMER,
    };
    insertConversation(created);
    return created;
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e5".repeat(32);

    applySchema();
    tenant = createTenantFixture("send-outcome-service");
    ref = sendableRef();

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => respond()) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    dropTenantFixture(tenant);
  });

  it("returns the message id and writes `sent` for an accepted text", async () => {
    respond = () => json(200, { messages: [{ id: "wamid.OK" }] });

    const outcome = await WhatsAppService.sendMessage(ref, TEXT);

    expect(outcome).toEqual({ ok: true, messageId: "wamid.OK" });
    expect(MessageStore.getHistory(ref)[0]).toMatchObject({
      status: "sent",
      whatsapp_message_id: "wamid.OK",
    });
  });

  it("returns the failure and writes `failed` for a refused text", async () => {
    respond = () => json(400, { error: { code: 131047 } });

    const outcome = await WhatsAppService.sendMessage(ref, TEXT);

    expect(outcome).toEqual({
      ok: false,
      kind: "permanent",
      reason: "http_400:131047",
      status: 400,
    });
    const history = MessageStore.getHistory(ref);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      direction: "outbound",
      status: "failed",
    });
  });

  it("returns the failure and writes `failed` for a refused image", async () => {
    respond = () => html(502);

    const outcome = await WhatsAppService.sendImage(
      ref,
      "images/a.jpg",
      "caption",
      "prod-1",
    );

    expect(outcome).toMatchObject({
      ok: false,
      kind: "transient",
      reason: "http_502",
    });
    expect(MessageStore.getHistory(ref)[0]).toMatchObject({
      type: "image",
      status: "failed",
    });
  });

  it("returns a permanent outcome after the `failed` row for a suspended tenant", async () => {
    let requests = 0;
    respond = () => {
      requests++;
      return json(200, { messages: [{ id: "wamid.OK" }] });
    };
    db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(
      tenant.tenantId,
    );

    const outcome = await WhatsAppService.sendMessage(ref, TEXT);

    expect(outcome).toEqual({
      ok: false,
      kind: "permanent",
      reason: "tenant_not_active",
    });
    expect(requests).toBe(0);
    expect(MessageStore.getHistory(ref)[0]).toMatchObject({ status: "failed" });
  });

  it("still throws for a pending account of an open tenant", async () => {
    let requests = 0;
    respond = () => {
      requests++;
      return json(200, { messages: [{ id: "wamid.OK" }] });
    };
    ChannelAccountService.updateStatus(ref.channelAccountId, "pending");

    await expect(WhatsAppService.sendMessage(ref, TEXT)).rejects.toThrow(
      "is pending, not active",
    );
    expect(requests).toBe(0);
    expect(MessageStore.getHistory(ref)[0]).toMatchObject({ status: "failed" });
  });
});
