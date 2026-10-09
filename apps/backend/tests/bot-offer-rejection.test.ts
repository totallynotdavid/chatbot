import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConversationPhase } from "@vendeya/core";
import { createMockProvider } from "@vendeya/intelligence";

import { runEnrichmentLoop } from "../src/conversation/handler/enrichment-loop.ts";
import { initializeEnrichmentRegistry } from "../src/conversation/enrichment/index.ts";
import { enrichmentRegistry } from "../src/conversation/enrichment/registry.ts";
import type { CheckEligibilityHandler } from "../src/domains/eligibility/handlers/check-eligibility-handler.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

const CUSTOMER = "51900666001";

const browsing: ConversationPhase = {
  phase: "offering_products",
  segment: "fnb",
  credit: 3000,
  name: "Ana",
  availableCategories: ["celulares"],
};

describe("turning down the offer while browsing", () => {
  let tenant: TenantFixture;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("rejection");
    insertConversation(tenant.ref(CUSTOMER));
    enrichmentRegistry.clear();
    initializeEnrichmentRegistry({} as CheckEligibilityHandler);
  });

  afterEach(() => {
    enrichmentRegistry.clear();
    dropTenantFixture(tenant);
  });

  async function turn(message: string, isQuestion: boolean) {
    const provider = createMockProvider();
    provider.setResponse("isQuestion", isQuestion);
    return runEnrichmentLoop(
      browsing,
      message,
      { createdAt: Date.now(), lastActivityAt: Date.now() },
      tenant.ref(CUSTOMER),
      provider,
    );
  }

  test.each([
    "no gracias",
    "nada",
    "paso",
    "No quiero, gracias",
    "paso, gracias",
    "por ahora nada",
    "no por ahora",
  ])("%j closes the conversation", async (message) => {
    const result = await turn(message, false);

    expect(result.type === "update" && result.nextPhase).toEqual({
      phase: "closing",
      purchaseConfirmed: false,
    });
  });

  test.each([
    "¿cuáles son los pasos para comprar?",
    "¿cuántos pasos tiene el contrato?",
    "¿envían a Granada?",
  ])("%j is a question, not a rejection", async (message) => {
    const result = await turn(message, true);

    expect(result.type === "update" && result.nextPhase).toEqual(browsing);
  });
});
