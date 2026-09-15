import { describe, test, expect, beforeEach } from "bun:test";
import { createMockProvider } from "@totem/intelligence";
import { ExtractBundleIntentHandler } from "../../../src/conversation/enrichment/handlers/extract-bundle-intent-handler.ts";
import type { Bundle } from "@totem/types";

const TEST_REF = {
  tenantId: "tenant-test",
  channelAccountId: "channel-test",
  phoneNumber: "51999999999",
};

const mockBundle: Bundle = {
  id: "bundle-test123",
  tenant_id: "tenant-test",
  period_id: "period-2026-01",
  name: "Celular + Laptop",
  price: 2500,
  primary_category: "celulares",
  segment: "gaso" as const,
  categories_json: '["celulares", "laptops"]',
  image_id: "test123",
  composition_json: '{"fixed":[],"choices":[]}',
  installments_json: '{"6m":450,"12m":240}',
  notes: "Test bundle",
  is_active: 1,
  stock_status: "in_stock" as const,
  created_by: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("ExtractBundleIntentHandler", () => {
  let handler: ExtractBundleIntentHandler;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    handler = new ExtractBundleIntentHandler();
    mockProvider = createMockProvider();
  });

  test("extracts bundle with high confidence", async () => {
    mockProvider.setResponse("extractBundleIntent", {
      bundle: mockBundle,
      confidence: 0.95,
    });

    const result = await handler.execute(
      {
        type: "extract_bundle_intent",
        message: "Quiero el primero",
        affordableBundles: [mockBundle],
      },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("bundle_intent_extracted");
    expect(result.bundle).toEqual(mockBundle);
    expect(result.confidence).toBe(0.95);
  });

  test("returns null for no match", async () => {
    mockProvider.setResponse("extractBundleIntent", {
      bundle: null,
      confidence: 0.1,
    });

    const result = await handler.execute(
      {
        type: "extract_bundle_intent",
        message: "No sé",
        affordableBundles: [mockBundle],
      },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("bundle_intent_extracted");
    expect(result.bundle).toBeNull();
    expect(result.confidence).toBe(0.1);
  });

  test("handles empty bundles array", async () => {
    mockProvider.setResponse("extractBundleIntent", {
      bundle: null,
      confidence: 0,
    });

    const result = await handler.execute(
      {
        type: "extract_bundle_intent",
        message: "Quiero algo",
        affordableBundles: [],
      },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("bundle_intent_extracted");
    expect(result.bundle).toBeNull();
  });

  test("respects low confidence threshold", async () => {
    mockProvider.setResponse("extractBundleIntent", {
      bundle: null,
      confidence: 0.3,
    });

    const result = await handler.execute(
      {
        type: "extract_bundle_intent",
        message: "tal vez",
        affordableBundles: [mockBundle],
      },
      { ref: TEST_REF, provider: mockProvider },
    );

    expect(result.type).toBe("bundle_intent_extracted");
    expect(result.confidence).toBeLessThan(0.5);
  });
});
