/**
 * Turns in and around a price objection, through the real enrichment loop and
 * handlers with a mock LLM, so the cost of a turn and what the answer prompt
 * receives are what production would see.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildAnswerQuestionPrompt,
  type ConversationMetadata,
  type ConversationPhase,
} from "@vendeya/core";
import { createMockProvider } from "@vendeya/intelligence";
import type { AnswerContext } from "@vendeya/intelligence";
import type { DomainEvent } from "@vendeya/types";

import { runEnrichmentLoop } from "../src/conversation/handler/enrichment-loop.ts";
import { handleMessage } from "../src/conversation/handler/index.ts";
import { initializeEnrichmentRegistry } from "../src/conversation/enrichment/index.ts";
import { enrichmentRegistry } from "../src/conversation/enrichment/registry.ts";
import type { CheckEligibilityHandler } from "../src/domains/eligibility/handlers/check-eligibility-handler.ts";
import { eventBus } from "../src/shared/events/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

const CUSTOMER = "51900777999";

const objection: ConversationPhase = {
  phase: "handling_objection",
  segment: "fnb",
  credit: 3000,
  name: "Ana",
  objectionCount: 1,
};

/** A mock LLM that counts its calls and keeps the answer contexts it got. */
function countingProvider() {
  const provider = createMockProvider();
  const calls: Record<string, number> = {};
  const answerContexts: AnswerContext[] = [];
  const counted = { ...provider };
  for (const name of Object.keys(provider) as Array<keyof typeof provider>) {
    if (name === "setResponse" || name === "reset") continue;
    const original = provider[name] as (...args: unknown[]) => unknown;
    (counted as Record<string, unknown>)[name] = (...args: unknown[]) => {
      calls[name] = (calls[name] ?? 0) + 1;
      if (name === "answerQuestion") {
        answerContexts.push(args[1] as AnswerContext);
      }
      return original(...args);
    };
  }
  return { provider: counted, calls, answerContexts };
}

describe("a turn during a price objection", () => {
  let tenant: TenantFixture;
  let metadata: ConversationMetadata;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("objection");
    insertConversation(tenant.ref(CUSTOMER), {
      contextData: { phase: objection, metadata: {} },
    });
    metadata = { createdAt: Date.now(), lastActivityAt: Date.now() };
    enrichmentRegistry.clear();
    initializeEnrichmentRegistry({} as CheckEligibilityHandler);
  });

  afterEach(() => {
    enrichmentRegistry.clear();
    dropTenantFixture(tenant);
  });

  test("a message that matches nothing costs one LLM call and gets a reply", async () => {
    const { provider, calls } = countingProvider();

    const result = await runEnrichmentLoop(
      objection,
      "mmm lo voy a pensar",
      metadata,
      tenant.ref(CUSTOMER),
      provider,
    );

    expect(calls).toEqual({ isQuestion: 1 });
    expect(result.type).toBe("update");
    if (result.type !== "update") return;
    expect(result.nextPhase).toEqual(objection);
    expect(result.commands).toEqual([
      { type: "SEND_MESSAGE", text: "¿Te gustaría ver alguna otra opción?" },
    ]);
  });

  test("a question is answered with the customer's credit in the prompt", async () => {
    const { provider, calls, answerContexts } = countingProvider();
    provider.setResponse("isQuestion", true);
    provider.setResponse("answerQuestion", "Sí, llegamos a Callao.");

    const result = await runEnrichmentLoop(
      objection,
      "¿llegan a Callao?",
      metadata,
      tenant.ref(CUSTOMER),
      provider,
    );

    expect(calls).toEqual({
      isQuestion: 1,
      shouldEscalate: 1,
      answerQuestion: 1,
    });
    expect(result.type === "update" && result.commands[0]).toEqual({
      type: "SEND_MESSAGE",
      text: "Sí, llegamos a Callao.\n\n¿Te gustaría ver alguna otra opción?",
    });
    expect(buildAnswerQuestionPrompt(answerContexts[0]!)).toContain(
      "Línea de crédito disponible: S/ 3000.",
    );
  });

  test("nada que ver, está caro is a rejection, not acceptance", async () => {
    const { provider } = countingProvider();

    const result = await runEnrichmentLoop(
      objection,
      "nada que ver, está caro",
      metadata,
      tenant.ref(CUSTOMER),
      provider,
    );

    expect(result.type === "update" && result.nextPhase).toMatchObject({
      phase: "handling_objection",
      objectionCount: 2,
    });
  });
});

describe("a question while browsing products", () => {
  let tenant: TenantFixture;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("browsing");
    insertConversation(tenant.ref(CUSTOMER));
    enrichmentRegistry.clear();
    initializeEnrichmentRegistry({} as CheckEligibilityHandler);
  });

  afterEach(() => {
    enrichmentRegistry.clear();
    dropTenantFixture(tenant);
  });

  test("reaches the answer prompt with the customer's credit", async () => {
    const { provider, answerContexts } = countingProvider();
    provider.setResponse("isQuestion", true);

    await runEnrichmentLoop(
      {
        phase: "offering_products",
        segment: "fnb",
        credit: 3000,
        name: "Ana",
        availableCategories: ["celulares"],
      },
      "¿cuántas cuotas son?",
      { createdAt: Date.now(), lastActivityAt: Date.now() },
      tenant.ref(CUSTOMER),
      provider,
    );

    expect(answerContexts).toHaveLength(1);
    expect(buildAnswerQuestionPrompt(answerContexts[0]!)).toContain(
      "Línea de crédito disponible: S/ 3000.",
    );
  });
});

describe("escalation from a phase", () => {
  let tenant: TenantFixture;
  let escalations: DomainEvent[];
  const onEscalation = (event: DomainEvent) => {
    escalations.push(event);
  };
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("escalation");
    insertConversation(tenant.ref(CUSTOMER), {
      contextData: {
        phase: { ...objection, objectionCount: 2 },
        metadata: { createdAt: Date.now(), lastActivityAt: Date.now() },
      },
      isSimulation: true,
    });
    escalations = [];
    eventBus.on("escalation_triggered", onEscalation);
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("{}")) as unknown as typeof fetch;
  });

  afterEach(() => {
    eventBus.off("escalation_triggered", onEscalation);
    globalThis.fetch = originalFetch;
    dropTenantFixture(tenant);
  });

  test("emits escalation_triggered once", async () => {
    await handleMessage({
      ref: tenant.ref(CUSTOMER),
      content: "no",
      timestamp: Date.now() - 11 * 60 * 1000,
      messageId: `wamid-${crypto.randomUUID()}`,
    });
    // `handleMessage` does not await its own emit.
    await Bun.sleep(10);

    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      payload: { reason: "multiple_objections", phoneNumber: CUSTOMER },
    });
  });
});
