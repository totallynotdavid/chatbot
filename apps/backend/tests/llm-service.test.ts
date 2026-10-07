import { describe, test, expect } from "bun:test";
import { createMockProvider } from "@vendeya/intelligence";

const TEST_CONTEXT = {
  phase: "offering_products",
  availableCategories: ["celulares", "cocinas", "laptops"],
};

describe("Intelligence Provider (MockProvider)", () => {
  describe("Question detection", () => {
    test("detects question with ?", async () => {
      const provider = createMockProvider();
      provider.setResponse("isQuestion", true);

      const result = await provider.isQuestion("¿Cuánto cuesta?");
      expect(result).toBe(true);
    });

    test("does not detect affirmation as question", async () => {
      const provider = createMockProvider();
      provider.setResponse("isQuestion", false);

      const result = await provider.isQuestion("Sí, me interesa");
      expect(result).toBe(false);
    });

    test("does not detect negation as question", async () => {
      const provider = createMockProvider();
      provider.setResponse("isQuestion", false);

      const result = await provider.isQuestion("No gracias");
      expect(result).toBe(false);
    });
  });

  describe("Escalation detection", () => {
    test("escalates on exact amount question", async () => {
      const provider = createMockProvider();
      provider.setResponse("shouldEscalate", true);

      const result = await provider.shouldEscalate(
        "¿Cuánto exactamente en soles pago por cuota?",
      );
      expect(result).toBe(true);
    });

    test("escalates on complaint", async () => {
      const provider = createMockProvider();
      provider.setResponse("shouldEscalate", true);

      const result = await provider.shouldEscalate(
        "Quiero hacer un reclamo formal",
      );
      expect(result).toBe(true);
    });

    test("does not escalate general questions", async () => {
      const provider = createMockProvider();
      provider.setResponse("shouldEscalate", false);

      const result = await provider.shouldEscalate("¿Cómo funciona el pago?");
      expect(result).toBe(false);
    });
  });

  describe("Question answering", () => {
    test("returns string answer", async () => {
      const provider = createMockProvider();
      provider.setResponse(
        "answerQuestion",
        "Ofrecemos crédito con cuotas mensuales.",
      );

      const result = await provider.answerQuestion(
        "¿Cómo funciona?",
        TEST_CONTEXT,
      );

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      expect(result).toBe("Ofrecemos crédito con cuotas mensuales.");
    });

    test("uses context in answers", async () => {
      const provider = createMockProvider();
      provider.setResponse(
        "answerQuestion",
        "Tenemos celulares, cocinas y laptops disponibles.",
      );

      const result = await provider.answerQuestion(
        "¿Qué productos tienen?",
        TEST_CONTEXT,
      );

      expect(typeof result).toBe("string");
      expect(result).toContain("celulares");
    });
  });

  describe("Alternative suggestions", () => {
    test("suggests alternative category", async () => {
      const provider = createMockProvider();
      provider.setResponse(
        "suggestAlternative",
        "No tenemos tablets, pero sí tenemos celulares y laptops",
      );

      const result = await provider.suggestAlternative("tablets", [
        "celulares",
        "laptops",
      ]);

      expect(result).toContain("tablets");
      expect(result).toContain("celulares");
    });
  });

  describe("Recovery responses", () => {
    test("recovers from unclear input", async () => {
      const provider = createMockProvider();
      provider.setResponse(
        "recoverUnclearResponse",
        "¿Quisieras ver nuestros productos o tienes alguna pregunta?",
      );

      const result = await provider.recoverUnclearResponse("mmm", {
        phase: "offering_products",
      });

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("Error handling (fallbacks)", () => {
    test("returns fallback for isQuestion", async () => {
      const provider = createMockProvider();
      // No response configured, should use default
      const result = await provider.isQuestion("test");
      expect(result).toBe(false);
    });

    test("returns fallback for shouldEscalate", async () => {
      const provider = createMockProvider();
      const result = await provider.shouldEscalate("test");
      expect(result).toBe(false);
    });

    test("returns fallback for answerQuestion", async () => {
      const provider = createMockProvider();
      const result = await provider.answerQuestion("test", TEST_CONTEXT);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
