import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockProvider } from "@vendeya/intelligence";
import { AnswerQuestionHandler } from "../../../src/conversation/enrichment/handlers/answer-question-handler.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "../../helpers/tenancy.ts";

describe("AnswerQuestionHandler", () => {
  let handler: AnswerQuestionHandler;
  let mockProvider: ReturnType<typeof createMockProvider>;
  let tenant: TenantFixture;
  let TEST_REF: ReturnType<TenantFixture["ref"]>;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("answer-handler");
    TEST_REF = tenant.ref("51999999999");
    handler = new AnswerQuestionHandler();
    mockProvider = createMockProvider();
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  test("returns non-empty answer for valid question", async () => {
    mockProvider.setResponse(
      "answerQuestion",
      "Ofrecemos celulares, cocinas y laptops.",
    );

    const result = await handler.execute(
      {
        type: "answer_question",
        message: "¿Qué productos tienen?",
        context: {
          phase: "offering_products",
          availableCategories: ["celulares", "cocinas", "laptops"],
        },
      },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("question_answered");
    expect(result.answer).toBe("Ofrecemos celulares, cocinas y laptops.");
    expect(result.answer.length).toBeGreaterThan(0);
  });

  test("handles LLM error with fallback", async () => {
    // Mock provider returns default fallback when no response set
    const result = await handler.execute(
      {
        type: "answer_question",
        message: "test",
        context: {
          phase: "greeting",
          availableCategories: [],
        },
      },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("question_answered");
    expect(typeof result.answer).toBe("string");
    expect(result.answer.length).toBeGreaterThan(0);
  });
});
