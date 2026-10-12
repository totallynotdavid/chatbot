/** The executor persists the phase after sends, not during enrichment. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  ConversationMetadata,
  ConversationPhase,
  EnrichmentRequest,
} from "@vendeya/core";
import { createMockProvider } from "@vendeya/intelligence";

import { db } from "../src/db/index.ts";
import { enrichmentRegistry } from "../src/conversation/enrichment/registry.ts";
import { runEnrichmentLoop } from "../src/conversation/handler/enrichment-loop.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

const CUSTOMER = "51900777999";

describe("a turn that needs enrichment", () => {
  let tenant: TenantFixture;
  let metadata: ConversationMetadata;
  /** Captures the stored conversation while the eligibility handler runs. */
  let storedDuringCheck: StoredConversation | undefined;

  type StoredConversation = {
    phase: ConversationPhase;
    metadata: ConversationMetadata;
  };

  function stored(): StoredConversation {
    const row = db
      .prepare(
        `SELECT context_data FROM conversations
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
      )
      .get(tenant.tenantId, tenant.channelAccountId, CUSTOMER) as {
      context_data: string;
    };
    return JSON.parse(row.context_data);
  }

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("loop-persistence");
    insertConversation(tenant.ref(CUSTOMER), {
      contextData: {
        phase: { phase: "collecting_dni" },
        metadata: { createdAt: 1, lastActivityAt: 1 },
      },
    });
    metadata = { createdAt: 1, lastActivityAt: 1 };
    storedDuringCheck = undefined;

    enrichmentRegistry.clear();
    enrichmentRegistry.register({
      type: "check_eligibility",
      async execute(
        _request: Extract<EnrichmentRequest, { type: "check_eligibility" }>,
      ) {
        storedDuringCheck = stored();
        return { type: "eligibility_result", status: "not_eligible" };
      },
    });
  });

  afterEach(() => {
    enrichmentRegistry.clear();
    dropTenantFixture(tenant);
  });

  test("leaves the stored phase alone while its handler runs and after the loop returns", async () => {
    const result = await runEnrichmentLoop(
      { phase: "collecting_dni" },
      "11111111",
      metadata,
      tenant.ref(CUSTOMER),
      createMockProvider(),
    );

    expect(result.type).toBe("update");
    expect(storedDuringCheck?.phase).toEqual({ phase: "collecting_dni" });
    expect(stored().phase).toEqual({ phase: "collecting_dni" });
  });

  test("a handler that throws leaves the conversation where the customer left it", async () => {
    enrichmentRegistry.clear();
    enrichmentRegistry.register({
      type: "check_eligibility",
      async execute() {
        throw new Error("provider down");
      },
    });

    await expect(
      runEnrichmentLoop(
        { phase: "collecting_dni" },
        "11111111",
        metadata,
        tenant.ref(CUSTOMER),
        createMockProvider(),
      ),
    ).rejects.toThrow("provider down");

    expect(stored().phase).toEqual({ phase: "collecting_dni" });
  });
});
