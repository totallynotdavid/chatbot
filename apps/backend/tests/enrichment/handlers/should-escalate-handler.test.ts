import { describe, test, expect, beforeEach } from "bun:test";
import { createMockProvider } from "@totem/intelligence";
import { ShouldEscalateHandler } from "../../../src/conversation/enrichment/handlers/should-escalate-handler.ts";

const TEST_REF = {
  tenantId: "tenant-test",
  channelAccountId: "channel-test",
  phoneNumber: "51999999999",
};

describe("ShouldEscalateHandler", () => {
  let handler: ShouldEscalateHandler;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    handler = new ShouldEscalateHandler();
    mockProvider = createMockProvider();
  });

  test("escalates on explicit request", async () => {
    mockProvider.setResponse("shouldEscalate", true);

    const result = await handler.execute(
      { type: "should_escalate", message: "Quiero hablar con un humano" },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("escalation_needed");
    expect(result.shouldEscalate).toBe(true);
  });

  test("handles empty message gracefully", async () => {
    mockProvider.setResponse("shouldEscalate", false);

    const result = await handler.execute(
      { type: "should_escalate", message: "" },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("escalation_needed");
    expect(result.shouldEscalate).toBe(false);
  });
});
