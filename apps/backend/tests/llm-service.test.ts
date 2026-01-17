import { describe, test, expect } from "bun:test";
import { createMockProvider } from "@totem/intelligence";

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

  describe("Product request detection", () => {
    test("detects product request", async () => {
      const provider = createMockProvider();
      provider.setResponse("isProductRequest", true);

      const result = await provider.isProductRequest("Quiero ver celulares");
      expect(result).toBe(true);
    });

    test("does not detect non-product messages", async () => {
      const provider = createMockProvider();
      provider.setResponse("isProductRequest", false);

      const result = await provider.isProductRequest("Hola, buenos días");
      expect(result).toBe(false);
    });
  });

  describe("Bundle intent extraction", () => {
    test("extracts bundle with confidence", async () => {
      const mockBundle = {
        id: "bundle-e4976160c1e346b8",
        period_id: "period-2026-01",
        name: "Celular a elección + Cocineta 2Q",
        price: 1799,
        primary_category: "celulares",
        categories_json: '["celulares", "cocinas"]',
        image_id: "e4976160c1e346b8",
        composition_json:
          '{"fixed":[{"id":"cocineta_2q_gas","name":"Cocineta 2 Quemadores Gas","specs":{}}],"choices":[{"label":"01 celular a elección","pick":1,"options":[{"id":"xiaomi_redmi_15c","name":"Xiaomi Redmi 15C","specs":{}},{"id":"honor_x6c","name":"Honor X6C","specs":{}},{"id":"samsung_a17_5g","name":"Samsung Galaxy A17 5G","specs":{}}]}]}',
        installments_json:
          '{"3m":643.3,"6m":339.58,"9m":238.58,"12m":188.26,"18m":138.29}',
        notes: "01 año de garantía, delivery gratuito, cero cuota inicial",
        is_active: 1,
        stock_status: "in_stock" as const,
        created_by: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      };

      const provider = createMockProvider();
      provider.setResponse("extractBundleIntent", {
        bundle: mockBundle,
        confidence: 0.95,
      });

      const result = await provider.extractBundleIntent("quiero el primero", [
        mockBundle,
      ]);

      expect(result.bundle).toEqual(mockBundle);
      expect(result.confidence).toBe(0.95);
    });

    test("returns null for no match", async () => {
      const provider = createMockProvider();
      provider.setResponse("extractBundleIntent", {
        bundle: null,
        confidence: 0.1,
      });

      const result = await provider.extractBundleIntent("no sé", []);
      expect(result.bundle).toBeNull();
      expect(result.confidence).toBe(0.1);
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

  describe("Backlog apologies", () => {
    test("handles backlog gracefully", async () => {
      const provider = createMockProvider();
      provider.setResponse(
        "handleBacklogResponse",
        "Disculpa la demora de 30 minutos. ¿En qué puedo ayudarte?",
      );

      const result = await provider.handleBacklogResponse(
        "Hola, quiero ver productos",
        30,
      );

      expect(typeof result).toBe("string");
      expect(result).toContain("30");
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

    test("returns fallback for extractBundleIntent", async () => {
      const provider = createMockProvider();
      const result = await provider.extractBundleIntent("test", []);
      expect(result.bundle).toBeNull();
      expect(result.confidence).toBe(0);
    });

    test("returns fallback for answerQuestion", async () => {
      const provider = createMockProvider();
      const result = await provider.answerQuestion("test", TEST_CONTEXT);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
