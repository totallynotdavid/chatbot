import { describe, test, expect } from "bun:test";
import { transition } from "../src/conversation";
import type {
  ConversationMetadata,
  EnrichmentResult,
} from "../src/conversation/types";

function createMetadata(
  overrides: Partial<ConversationMetadata> = {},
): ConversationMetadata {
  const now = Date.now();
  return {
    createdAt: now,
    lastActivityAt: now,
    ...overrides,
  };
}

describe("Offering products (user experience)", () => {
  const basePhase = {
    phase: "offering_products" as const,
    segment: "fnb" as const,
    credit: 5000,
    name: "Juan",
    availableCategories: ["celulares", "tv", "refrigeradoras"],
    categoryDisplayNames: ["celulares", "televisores", "refrigeradoras"],
  };

  describe("UX issue: User says 'sí' without context", () => {
    test("should NOT confirm purchase when no products have been shown yet", () => {
      // User says "sí" but we haven't shown them anything yet
      const result = transition({
        phase: basePhase,
        message: "sí",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        // Should stay in offering_products and ask what they want
        expect(result.nextPhase.phase).toBe("offering_products");
        const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
        expect(msg).toBeDefined();
        if (msg?.type === "SEND_MESSAGE") {
          // Should ask what they want to see
          expect(msg.text.toLowerCase()).toMatch(/qu[eé]|celulares|productos/);
        }
      }
    });

    test("should NOT confirm purchase when user said 'sí' to vague question", () => {
      // This catches when bot asks "¿Te interesa?" and user says "sí", but to what?
      const result = transition({
        phase: {
          ...basePhase,
          // No lastShownCategory, no sentProducts
        },
        message: "Sí, me interesa",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("offering_products");
        // Should ask for clarification
        const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
        expect(msg).toBeDefined();
      }
    });
  });

  describe("UX issue: confusing product selection", () => {
    test("should handle when user says product name without seeing products first", () => {
      const result = transition({
        phase: basePhase,
        message: "quiero el Samsung",
        metadata: createMetadata(),
      });

      // Should try to extract category or ask for enrichment
      const isUpdate = result.type === "update";
      const needsEnrichment = result.type === "need_enrichment";

      expect(isUpdate || needsEnrichment).toBe(true);

      // If it's an update, it should show products or ask for clarification
      if (result.type === "update") {
        expect(result.commands.length).toBeGreaterThan(0);
      }
    });

    test("should ask for clarification when user is ambiguous after showing products", () => {
      const sentProducts = [
        {
          name: "Samsung Galaxy A54",
          position: 1,
          productId: "1",
          price: 1200,
        },
        {
          name: "Samsung Galaxy S23",
          position: 2,
          productId: "2",
          price: 3000,
        },
      ];

      const result = transition({
        phase: {
          ...basePhase,
          sentProducts,
          lastShownCategory: "celulares",
        },
        message: "el Samsung",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        // Should ask which Samsung
        expect(result.nextPhase.phase).toBe("offering_products");
        const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
        expect(msg).toBeDefined();
        if (msg?.type === "SEND_MESSAGE") {
          expect(msg.text).toContain("Samsung");
        }
      }
    });
  });

  describe("UX issue: user changes mind frequently", () => {
    test("should allow user to explore multiple categories without getting stuck", () => {
      // First show celulares
      let result = transition({
        phase: basePhase,
        message: "celulares",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type !== "update") return;
      expect(result.nextPhase.phase).toBe("offering_products");

      const phase1 = result.nextPhase;
      if (phase1.phase !== "offering_products") return;

      // Now user changes mind to TV
      result = transition({
        phase: phase1,
        message: "mejor muéstrame televisores",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type !== "update") return;
      expect(result.nextPhase.phase).toBe("offering_products");

      // Should show TV category
      const imgCommand = result.commands.find((c) => c.type === "SEND_IMAGES");
      expect(imgCommand).toBeDefined();
    });

    test("should remind user of interested product after browsing 2 other categories", () => {
      const interestedProduct = {
        name: "Samsung Galaxy A54",
        price: 1200,
        productId: "1",
        exploredCategoriesCount: 1,
      };

      const result = transition({
        phase: {
          ...basePhase,
          interestedProduct,
          lastShownCategory: "tv",
        },
        message: "refrigeradoras",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        // After viewing 2 different categories (now at exploredCount = 2), should remind
        const msgs = result.commands.filter((c) => c.type === "SEND_MESSAGE");
        const hasReminder = msgs.some(
          (c) =>
            c.type === "SEND_MESSAGE" && c.text.includes("Samsung Galaxy A54"),
        );
        expect(hasReminder).toBe(true);
      }
    });
  });

  describe("UX issue: price concerns not handled gracefully", () => {
    test("should NOT close conversation when user says 'está caro'", () => {
      const result = transition({
        phase: {
          ...basePhase,
          lastShownCategory: "celulares",
        },
        message: "está muy caro",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        // Should go to objection handling, not closing
        expect(result.nextPhase.phase).toBe("handling_objection");
      }
    });

    test("should offer financing when user expresses price concern", () => {
      const result = transition({
        phase: {
          ...basePhase,
          lastShownCategory: "tv",
        },
        message: "no tengo tanta plata",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("handling_objection");
        // Should have sent a message addressing cost
        const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
        expect(msg).toBeDefined();
      }
    });
  });

  describe("UX issue: rejection vs exploration confusion", () => {
    test("should NOT close when user says 'no me convence este' (specific product rejection)", () => {
      const sentProducts = [
        {
          name: "Samsung Galaxy A54",
          position: 1,
          productId: "1",
          price: 1200,
        },
      ];

      const result = transition({
        phase: {
          ...basePhase,
          sentProducts,
          lastShownCategory: "celulares",
        },
        message: "no me convence este modelo",
        metadata: createMetadata(),
      });

      // Bot should either stay in offering OR ask for enrichment to understand better
      if (result.type === "update") {
        expect(result.nextPhase.phase).not.toBe("closing");
      } else if (result.type === "need_enrichment") {
        // Asking for help to understand unclear rejection is also valid
        expect(result.enrichment.type).toBe("detect_question");
      } else {
        throw new Error("Unexpected result type");
      }
    });

    test("should close when user explicitly rejects everything", () => {
      const result = transition({
        phase: basePhase,
        message: "no gracias, no quiero nada",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("closing");
        if (result.nextPhase.phase === "closing") {
          expect(result.nextPhase.purchaseConfirmed).toBe(false);
        }
      }
    });
  });

  describe("UX issue: unclear requests need better handling", () => {
    test("should request enrichment when user input is unclear", () => {
      const result = transition({
        phase: basePhase,
        message: "mmm no sé, algo barato",
        metadata: createMetadata(),
      });

      // Should ask LLM to detect if it's a question or extract intent
      expect(result.type).toBe("need_enrichment");
      if (result.type === "need_enrichment") {
        expect(result.enrichment.type).toBe("detect_question");
      }
    });

    test("should handle questions gracefully in offering phase", () => {
      const enrichment: EnrichmentResult = {
        type: "question_detected",
        isQuestion: true,
      };

      const result = transition({
        phase: basePhase,
        message: "¿Cuánto cuesta la entrega?",
        metadata: createMetadata(),
        enrichment,
      });

      // Should check if should escalate or try to answer
      expect(result.type).toBe("need_enrichment");
      if (result.type === "need_enrichment") {
        expect(result.enrichment.type).toBe("should_escalate");
      }
    });
  });

  describe("UX issue: product matching logic", () => {
    test("should match product by position (el primero, el segundo)", () => {
      const sentProducts = [
        {
          name: "Samsung Galaxy A54",
          position: 1,
          productId: "1",
          price: 1200,
        },
        {
          name: "Xiaomi Redmi Note 12",
          position: 2,
          productId: "2",
          price: 800,
        },
      ];

      const result = transition({
        phase: {
          ...basePhase,
          sentProducts,
          lastShownCategory: "celulares",
        },
        message: "me interesa el primero",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        // Should go to confirmation with the first product
        expect(result.nextPhase.phase).toBe("confirming_selection");
        if (result.nextPhase.phase === "confirming_selection") {
          expect(result.nextPhase.selectedProduct.name).toBe(
            "Samsung Galaxy A54",
          );
        }
      }
    });

    test("should match product by unique name match", () => {
      const sentProducts = [
        {
          name: "Samsung Galaxy A54",
          position: 1,
          productId: "1",
          price: 1200,
        },
        {
          name: "Xiaomi Redmi Note 12",
          position: 2,
          productId: "2",
          price: 800,
        },
      ];

      const result = transition({
        phase: {
          ...basePhase,
          sentProducts,
          lastShownCategory: "celulares",
        },
        message: "quiero el Xiaomi",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("confirming_selection");
        if (result.nextPhase.phase === "confirming_selection") {
          expect(result.nextPhase.selectedProduct.name).toContain("Xiaomi");
        }
      }
    });
  });

  describe("UX issue: category switching", () => {
    test("should show new category when user mentions different category", () => {
      const result = transition({
        phase: {
          ...basePhase,
          lastShownCategory: "celulares",
        },
        message: "mejor muéstrame televisores",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        // Should send images for TV category
        const imgCommand = result.commands.find(
          (c) => c.type === "SEND_IMAGES",
        );
        expect(imgCommand).toBeDefined();
        if (imgCommand?.type === "SEND_IMAGES") {
          expect(imgCommand.category).toBe("tv");
        }
      }
    });

    test("should ask which product when user mentions same category again", () => {
      const result = transition({
        phase: {
          ...basePhase,
          lastShownCategory: "celulares",
        },
        message: "dame celulares",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("offering_products");
        // Should ask which specific product, not show category again
        const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
        expect(msg).toBeDefined();
      }
    });
  });
});

describe("Confirming selection (UX tests)", () => {
  const basePhase = {
    phase: "confirming_selection" as const,
    segment: "fnb" as const,
    credit: 5000,
    name: "Juan",
    selectedProduct: {
      name: "Samsung Galaxy A54",
      price: 1200,
      productId: "1",
    },
  };

  describe("UX issue: user wants to keep exploring", () => {
    test("should let user go back to browsing without friction", () => {
      const result = transition({
        phase: basePhase,
        message: "quiero ver otros",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("offering_products");
        // Should preserve their interest in this product
        if (result.nextPhase.phase === "offering_products") {
          expect(result.nextPhase.interestedProduct).toBeDefined();
          expect(result.nextPhase.interestedProduct?.name).toBe(
            "Samsung Galaxy A54",
          );
        }
      }
    });

    test("should handle 'no estoy seguro' gracefully", () => {
      const result = transition({
        phase: basePhase,
        message: "no estoy seguro, déjame ver otros",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("offering_products");
        // Should be encouraging, not frustrated
        const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
        expect(msg).toBeDefined();
        if (msg?.type === "SEND_MESSAGE") {
          expect(msg.text.toLowerCase()).toMatch(/problem|qu[eé]/);
        }
      }
    });
  });

  describe("UX issue: confirmation clarity", () => {
    test("should confirm purchase when user says 'sí'", () => {
      const result = transition({
        phase: basePhase,
        message: "sí",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("closing");
        if (result.nextPhase.phase === "closing") {
          expect(result.nextPhase.purchaseConfirmed).toBe(true);
        }
      }
    });

    test("should request enrichment for unclear responses", () => {
      const result = transition({
        phase: basePhase,
        message: "mmm",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("need_enrichment");
      if (result.type === "need_enrichment") {
        expect(result.enrichment.type).toBe("recover_unclear_response");
      }
    });

    test("should notify team when purchase is confirmed", () => {
      const result = transition({
        phase: basePhase,
        message: "confirmo",
        metadata: createMetadata(),
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        const notifyCommand = result.commands.find(
          (c) => c.type === "NOTIFY_TEAM",
        );
        expect(notifyCommand).toBeDefined();
        if (notifyCommand?.type === "NOTIFY_TEAM") {
          expect(notifyCommand.channel).toBe("agent");
          expect(notifyCommand.message).toContain("Samsung Galaxy A54");
        }
      }
    });
  });
});
