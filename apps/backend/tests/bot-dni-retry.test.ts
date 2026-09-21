/**
 * The DNI retry flow through the real enrichment loop, so `triedDnis` is filled
 * the way the backend fills it: the current DNI is already in the list when
 * core reads the eligibility result.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  ConversationMetadata,
  ConversationPhase,
  EnrichmentRequest,
  TransitionResult,
} from "@vendeya/core";
import { createMockProvider } from "@vendeya/intelligence";

import { runEnrichmentLoop } from "../src/conversation/handler/enrichment-loop.ts";
import { enrichmentRegistry } from "../src/conversation/enrichment/registry.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

const CUSTOMER = "51900777888";

describe("DNI retry", () => {
  let tenant: TenantFixture;
  let checked: string[];
  let phase: ConversationPhase;
  let metadata: ConversationMetadata;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("dni-retry");
    insertConversation(tenant.ref(CUSTOMER));
    checked = [];
    phase = { phase: "collecting_dni" };
    metadata = { createdAt: Date.now(), lastActivityAt: Date.now() };

    enrichmentRegistry.clear();
    enrichmentRegistry.register({
      type: "check_eligibility",
      async execute(
        request: Extract<EnrichmentRequest, { type: "check_eligibility" }>,
      ) {
        checked.push(request.dni);
        return { type: "eligibility_result", status: "not_eligible" };
      },
    });
  });

  afterEach(() => {
    enrichmentRegistry.clear();
    dropTenantFixture(tenant);
  });

  async function say(message: string): Promise<TransitionResult> {
    const result = await runEnrichmentLoop(
      phase,
      message,
      metadata,
      tenant.ref(CUSTOMER),
      createMockProvider(),
    );
    if (result.type === "update") phase = result.nextPhase;
    return result;
  }

  test("a customer gets three DNI attempts", async () => {
    await say("11111111");
    expect(phase.phase).toBe("offering_dni_retry");
    await say("sí");
    await say("22222222");
    expect(phase.phase).toBe("offering_dni_retry");
    await say("sí");
    await say("33333333");
    expect(phase.phase).toBe("closing");
    expect(checked).toEqual(["11111111", "22222222", "33333333"]);
  });

  test("a DNI sent in reply to the retry offer is checked", async () => {
    await say("11111111");
    expect(phase.phase).toBe("offering_dni_retry");
    await say("mejor prueba con 22222222");
    expect(checked).toEqual(["11111111", "22222222"]);
    expect(phase.phase).toBe("offering_dni_retry");
  });

  test("a DNI already tried, sent to the retry offer, is refused", async () => {
    await say("11111111");
    const result = await say("11111111");
    expect(checked).toEqual(["11111111"]);
    expect(phase.phase).toBe("collecting_dni");
    expect(result.type === "update" && result.commands).toContainEqual({
      type: "SEND_MESSAGE",
      text: expect.any(String),
    });
  });
});
