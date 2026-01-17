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
    const mockBundle = { id: "1", name: "Test Bundle", price: 100 };
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
