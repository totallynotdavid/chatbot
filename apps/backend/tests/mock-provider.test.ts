import { describe, test, expect } from "bun:test";
import { createMockProvider } from "@totem/intelligence";

describe("MockProvider", () => {
  test("returns configured response for isQuestion", async () => {
    const provider = createMockProvider();
    provider.setResponse("isQuestion", true);

    const result = await provider.isQuestion("¿Cuánto cuesta?");
    expect(result).toBe(true);
  });

  test("returns default false for unconfigured isQuestion", async () => {
    const provider = createMockProvider();
    const result = await provider.isQuestion("¿Cuánto cuesta?");
    expect(result).toBe(false);
  });

  test("returns configured response for shouldEscalate", async () => {
    const provider = createMockProvider();
    provider.setResponse("shouldEscalate", true);

    const result = await provider.shouldEscalate("Quiero hablar con un humano");
    expect(result).toBe(true);
  });

  test("returns configured response for extractBundleIntent", async () => {
    const provider = createMockProvider();
    const mockBundle = {
      id: "fnb-e0945b55ea90479f",
      period_id: "period-2026-01",
      name: "Samsung Galaxy A26",
      price: 1899,
      primary_category: "celulares",
      categories_json: '["celulares"]',
      image_id: "e0945b55ea90479f",
      composition_json:
        '{"fixed":[{"id":"samsung_a26","name":"Samsung Galaxy A26","specs":{}}],"choices":[]}',
      installments_json:
        '{"3m":682.11,"6m":361.68,"9m":255.24,"12m":202.3,"18m":149.92,"24m":124.29}',
      notes: "01 año de garantía, delivery gratuito, cero cuota inicial",
      is_active: 1,
      stock_status: "in_stock" as const,
      created_by: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    provider.setResponse("extractBundleIntent", {
      bundle: mockBundle,
      confidence: 0.9,
    });

    const result = await provider.extractBundleIntent("quiero ese", []);
    expect(result.bundle).toEqual(mockBundle);
    expect(result.confidence).toBe(0.9);
  });

  test("returns null bundle for unconfigured extractBundleIntent", async () => {
    const provider = createMockProvider();
    const result = await provider.extractBundleIntent("quiero ese", []);
    expect(result.bundle).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test("returns configured response for answerQuestion", async () => {
    const provider = createMockProvider();
    provider.setResponse("answerQuestion", "Esta es la respuesta");

    const result = await provider.answerQuestion("¿Cómo funciona?", {
      phase: "offering_products",
      availableCategories: [],
    });
    expect(result).toBe("Esta es la respuesta");
  });

  test("returns default answer for unconfigured answerQuestion", async () => {
    const provider = createMockProvider();
    const result = await provider.answerQuestion("¿Cómo funciona?", {
      phase: "offering_products",
      availableCategories: [],
    });
    expect(result).toBe("Déjame ayudarte con eso.");
  });

  test("reset() clears all configured responses", async () => {
    const provider = createMockProvider();
    provider.setResponse("isQuestion", true);
    provider.setResponse("shouldEscalate", true);

    provider.reset();

    const q = await provider.isQuestion("test");
    const e = await provider.shouldEscalate("test");
    expect(q).toBe(false);
    expect(e).toBe(false);
  });

  test("suggestAlternative uses fallback with available categories", async () => {
    const provider = createMockProvider();
    const result = await provider.suggestAlternative("laptops", [
      "celulares",
      "tv",
    ]);
    expect(result).toContain("laptops");
    expect(result).toContain("celulares");
  });

  test("recoverUnclearResponse returns default message", async () => {
    const provider = createMockProvider();
    const result = await provider.recoverUnclearResponse("mmm", {
      phase: "offering_products",
    });
    expect(result).toBe("Disculpa, no te entendí. ¿Puedes repetirlo?");
  });

  test("handleBacklogResponse returns default apology", async () => {
    const provider = createMockProvider();
    const result = await provider.handleBacklogResponse("hola", 30);
    expect(result).toBe("Disculpa la demora, recién vi tu mensaje.");
  });

  test("extractProductData returns null data by default", async () => {
    const provider = createMockProvider();
    const buffer = Buffer.from("fake image");
    const result = await provider.extractProductData(buffer);

    expect(result.name).toBeNull();
    expect(result.price).toBeNull();
    expect(result.installments).toBeNull();
    expect(result.category).toBeNull();
    expect(result.description).toBeNull();
  });

  test("extractProductData returns configured data", async () => {
    const provider = createMockProvider();
    const mockData = {
      name: "Samsung Galaxy",
      price: 2999,
      installments: 12,
      category: "celulares",
      description: "Smartphone premium",
    };
    provider.setResponse("extractProductData", mockData);

    const buffer = Buffer.from("fake image");
    const result = await provider.extractProductData(buffer);

    expect(result).toEqual(mockData);
  });
});
