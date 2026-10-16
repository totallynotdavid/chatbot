import { describe, test, expect } from "bun:test";
import { createMockProvider } from "@vendeya/intelligence";

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

  test("returns configured response for answerQuestion", async () => {
    const provider = createMockProvider();
    provider.setResponse("answerQuestion", "Esta es la respuesta");

    const result = await provider.answerQuestion("¿Cómo funciona?", {
      businessName: "Casa Lima",
      phase: "offering_products",
      availableCategories: [],
    });
    expect(result).toBe("Esta es la respuesta");
  });

  test("returns default answer for unconfigured answerQuestion", async () => {
    const provider = createMockProvider();
    const result = await provider.answerQuestion("¿Cómo funciona?", {
      businessName: "Casa Lima",
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

  test("recoverUnclearResponse returns default message", async () => {
    const provider = createMockProvider();
    const result = await provider.recoverUnclearResponse("mmm", {
      phase: "offering_products",
    });
    expect(result).toBe("Disculpa, no te entendí. ¿Puedes repetirlo?");
  });
});
