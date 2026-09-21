import { describe, test, expect, beforeEach } from "bun:test";
import { createMockProvider } from "@vendeya/intelligence";
import { RecoverUnclearResponseHandler } from "../../../src/conversation/enrichment/handlers/recover-unclear-response-handler.ts";

const TEST_REF = {
  tenantId: "tenant-test",
  channelAccountId: "channel-test",
  phoneNumber: "51999999999",
};

describe("RecoverUnclearResponseHandler", () => {
  let handler: RecoverUnclearResponseHandler;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    handler = new RecoverUnclearResponseHandler();
    mockProvider = createMockProvider();
  });

  test("generates recovery text", async () => {
    mockProvider.setResponse(
      "recoverUnclearResponse",
      "¿Quisieras ver nuestros productos disponibles?",
    );

    const result = await handler.execute(
      {
        type: "recover_unclear_response",
        message: "mmm",
        context: { phase: "offering_products" },
      },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("recovery_response");
    expect(result.text).toBe("¿Quisieras ver nuestros productos disponibles?");
    expect(result.text.length).toBeGreaterThan(0);
  });
});
