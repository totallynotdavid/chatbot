import { describe, test, expect, beforeEach } from "bun:test";
import { createMockProvider } from "@totem/intelligence";
import { GenerateBacklogApologyHandler } from "../../../src/conversation/enrichment/handlers/generate-backlog-apology-handler.ts";

const TEST_REF = {
  tenantId: "tenant-test",
  channelAccountId: "channel-test",
  phoneNumber: "51999999999",
};

describe("GenerateBacklogApologyHandler", () => {
  let handler: GenerateBacklogApologyHandler;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    handler = new GenerateBacklogApologyHandler();
    mockProvider = createMockProvider();
  });

  test("generates apology text", async () => {
    mockProvider.setResponse(
      "handleBacklogResponse",
      "Disculpa la demora de 30 minutos. ¿En qué puedo ayudarte?",
    );

    const result = await handler.execute(
      {
        type: "generate_backlog_apology",
        message: "Hola",
        ageMinutes: 30,
      },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("backlog_apology");
    expect(result.apology).toBe(
      "Disculpa la demora de 30 minutos. ¿En qué puedo ayudarte?",
    );
    expect(result.apology.length).toBeGreaterThan(0);
  });
});
