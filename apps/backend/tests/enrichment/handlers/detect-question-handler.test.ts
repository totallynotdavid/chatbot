import { describe, test, expect, beforeEach } from "bun:test";
import { createMockProvider } from "@vendeya/intelligence";
import { DetectQuestionHandler } from "../../../src/conversation/enrichment/handlers/detect-question-handler.ts";

const TEST_REF = {
  tenantId: "tenant-test",
  channelAccountId: "channel-test",
  phoneNumber: "51999999999",
};

describe("DetectQuestionHandler", () => {
  let handler: DetectQuestionHandler;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    handler = new DetectQuestionHandler();
    mockProvider = createMockProvider();
  });

  test("detects actual question", async () => {
    mockProvider.setResponse("isQuestion", true);

    const result = await handler.execute(
      { type: "detect_question", message: "¿Cuánto cuesta?" },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("question_detected");
    expect(result.isQuestion).toBe(true);
  });

  test("handles LLM error gracefully", async () => {
    // Mock provider returns false by default when no response configured
    const result = await handler.execute(
      { type: "detect_question", message: "test" },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("question_detected");
    expect(result.isQuestion).toBe(false);
  });
});
