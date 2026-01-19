import { describe, test, expect } from "bun:test";
import { transition } from "../src/conversation";
import type {
  TransitionInput,
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

describe("Conversation transitions (greeting phase)", () => {
  test("should greet new user and move to confirming_client", () => {
    const input: TransitionInput = {
      phase: { phase: "greeting" },
      message: "",
      metadata: createMetadata(),
    };

    const result = transition(input);

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("confirming_client");
      expect(result.commands).toHaveLength(2);
      expect(result.commands[0].type).toBe("TRACK_EVENT");
      expect(result.commands[1].type).toBe("SEND_MESSAGE");
    }
  });

  test("should greet returning user with their last interest category", () => {
    const input: TransitionInput = {
      phase: { phase: "greeting" },
      message: "",
      metadata: createMetadata({ lastCategory: "celulares" }),
    };

    const result = transition(input);

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("confirming_client");
      const messageCommand = result.commands.find(
        (c) => c.type === "SEND_MESSAGE",
      );
      expect(messageCommand?.type).toBe("SEND_MESSAGE");
      if (messageCommand?.type === "SEND_MESSAGE") {
        expect(messageCommand.text).toContain("celulares");
      }
    }
  });
});

describe("Conversation transitions (confirming client phase)", () => {
  const baseMetadata = createMetadata();

  test('should handle clear "sí" affirmation', () => {
    const result = transition({
      phase: { phase: "confirming_client" },
      message: "Sí",
      metadata: baseMetadata,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("collecting_dni");
    }
  });

  test('should handle clear "no" rejection', () => {
    const result = transition({
      phase: { phase: "confirming_client" },
      message: "No",
      metadata: baseMetadata,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("closing");
      if (result.nextPhase.phase === "closing") {
        expect(result.nextPhase.purchaseConfirmed).toBe(false);
      }
    }
  });

  test('should handle "no tengo gas" as clear rejection', () => {
    const result = transition({
      phase: { phase: "confirming_client" },
      message: "no tengo gas",
      metadata: baseMetadata,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("closing");
      if (result.nextPhase.phase === "closing") {
        expect(result.nextPhase.purchaseConfirmed).toBe(false);
      }
    }
  });

  test("should handle 'soy cliente' as clear affirmation", () => {
    const result = transition({
      phase: { phase: "confirming_client" },
      message: "Soy cliente de calidda",
      metadata: baseMetadata,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("collecting_dni");
    }
  });

  test("should request enrichment for ambiguous responses", () => {
    const result = transition({
      phase: { phase: "confirming_client" },
      message: "Hola, me interesa",
      metadata: baseMetadata,
    });

    expect(result.type).toBe("need_enrichment");
    if (result.type === "need_enrichment") {
      expect(result.enrichment.type).toBe("recover_unclear_response");
      if (result.enrichment.type === "recover_unclear_response") {
        expect(result.enrichment.context.expectedOptions).toContain("Sí");
        expect(result.enrichment.context.expectedOptions).toContain("No");
      }
    }
  });

  test("should handle variations of yes (claro, ok, vale, dale)", () => {
    const variations = ["claro", "ok", "vale", "dale que sí", "sep"];

    for (const msg of variations) {
      const result = transition({
        phase: { phase: "confirming_client" },
        message: msg,
        metadata: baseMetadata,
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("collecting_dni");
      }
    }
  });

  test("should handle enthusiastic affirmations (siii, síííí)", () => {
    const enthusiasticVariations = [
      "siii",
      "siiii",
      "síííí",
      "sí!",
      "si si si",
    ];

    for (const msg of enthusiasticVariations) {
      const result = transition({
        phase: { phase: "confirming_client" },
        message: msg,
        metadata: baseMetadata,
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("collecting_dni");
      }
    }
  });

  test("should handle early DNI volunteer (implicit confirmation)", () => {
    const result = transition({
      phase: { phase: "confirming_client" },
      message: "Sí, mi DNI es 72345678",
      metadata: baseMetadata,
    });

    expect(result.type).toBe("need_enrichment");
    if (result.type === "need_enrichment") {
      expect(result.enrichment.type).toBe("check_eligibility");
      if (result.enrichment.type === "check_eligibility") {
        expect(result.enrichment.dni).toBe("72345678");
      }
    }
  });

  test("should skip to products for returning FNB user with data", () => {
    const returningMetadata = createMetadata({
      dni: "72345678",
      segment: "fnb",
      credit: 8000,
      name: "Juan",
    });

    const result = transition({
      phase: { phase: "confirming_client" },
      message: "sí",
      metadata: returningMetadata,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("offering_products");
    }
  });

  test("should go to age collection for returning GASO user", () => {
    const returningMetadata = createMetadata({
      dni: "72345678",
      segment: "gaso",
      credit: 3000,
      name: "Maria",
    });

    const result = transition({
      phase: { phase: "confirming_client" },
      message: "sí",
      metadata: returningMetadata,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("collecting_age");
    }
  });
});

describe("Conversation transitions (service-related responses)", () => {
  const baseMetadata = createMetadata();

  test("should handle service possession rejections", () => {
    const rejections = [
      "no tengo gas",
      "no tengo servicio",
      "no soy cliente",
      "no soy cliente de calidda",
      "no cuento con gas",
      "no tenemos gas",
      "no somos clientes",
    ];

    for (const msg of rejections) {
      const result = transition({
        phase: { phase: "confirming_client" },
        message: msg,
        metadata: baseMetadata,
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("closing");
        if (result.nextPhase.phase === "closing") {
          expect(result.nextPhase.purchaseConfirmed).toBe(false);
        }
      }
    }
  });

  test("should handle service possession affirmations", () => {
    const affirmations = [
      "soy cliente",
      "soy cliente de calidda",
      "tengo gas",
      "sí tengo gas",
      "cuento con gas",
      "tenemos gas",
      "somos clientes",
    ];

    for (const msg of affirmations) {
      const result = transition({
        phase: { phase: "confirming_client" },
        message: msg,
        metadata: baseMetadata,
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("collecting_dni");
      }
    }
  });

  test("should still require enrichment for truly ambiguous responses", () => {
    const ambiguous = ["me interesa", "no estoy seguro", "tal vez", "depende"];

    for (const msg of ambiguous) {
      const result = transition({
        phase: { phase: "confirming_client" },
        message: msg,
        metadata: baseMetadata,
      });

      expect(result.type).toBe("need_enrichment");
    }
  });
});

describe("Conversation Transitions - Collecting DNI Phase", () => {
  const baseMetadata = createMetadata();

  test("should extract valid 8-digit DNI and request enrichment", () => {
    const result = transition({
      phase: { phase: "collecting_dni" },
      message: "72345678",
      metadata: baseMetadata,
    });

    expect(result.type).toBe("need_enrichment");
    if (result.type === "need_enrichment") {
      expect(result.enrichment.type).toBe("check_eligibility");
      if (result.enrichment.type === "check_eligibility") {
        expect(result.enrichment.dni).toBe("72345678");
      }
    }
  });

  test("should extract DNI from text with extra characters", () => {
    const result = transition({
      phase: { phase: "collecting_dni" },
      message: "Mi DNI es 72345678",
      metadata: baseMetadata,
    });

    expect(result.type).toBe("need_enrichment");
    if (result.type === "need_enrichment") {
      expect(result.enrichment.type).toBe("check_eligibility");
    }
  });

  test('should wait silently when user says "te mando luego"', () => {
    const result = transition({
      phase: { phase: "collecting_dni" },
      message: "te mando en un rato",
      metadata: baseMetadata,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("collecting_dni");
      expect(result.commands).toHaveLength(0); // No message sent
    }
  });

  test('should respond once to "no lo tengo a la mano"', () => {
    const result = transition({
      phase: { phase: "collecting_dni" },
      message: "no lo tengo a la mano",
      metadata: baseMetadata,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("collecting_dni");
      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].type).toBe("SEND_MESSAGE");
    }
  });

  test("should stay silent on acknowledgments (ok, gracias, ya, listo)", () => {
    const acknowledgments = ["ok", "ya", "listo", "dale"];

    for (const msg of acknowledgments) {
      const result = transition({
        phase: { phase: "collecting_dni" },
        message: msg,
        metadata: baseMetadata,
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("collecting_dni");
        expect(result.commands.length).toBe(0);
      }
    }
  });

  test("should stay silent on very short messages (noise)", () => {
    const result = transition({
      phase: { phase: "collecting_dni" },
      message: "ah",
      metadata: baseMetadata,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("collecting_dni");
      expect(result.commands).toHaveLength(0);
    }
  });

  test("should reject invalid DNI formats", () => {
    const invalidDNIs = ["1234567", "123456789", "abcd1234"];

    for (const dni of invalidDNIs) {
      const result = transition({
        phase: { phase: "collecting_dni" },
        message: dni,
        metadata: baseMetadata,
      });

      expect(result.type).toBe("update");
      if (result.type === "update") {
        expect(result.nextPhase.phase).toBe("collecting_dni");
        const messageCommand = result.commands.find(
          (c) => c.type === "SEND_MESSAGE",
        );
        expect(messageCommand?.type).toBe("SEND_MESSAGE");
        if (messageCommand?.type === "SEND_MESSAGE") {
          // Should send an error message (content varies by variant)
          expect(messageCommand.text.length).toBeGreaterThan(10);
        }
      }
    }
  });
});

describe("Conversation transitions (checking eligibility phase)", () => {
  test("should request enrichment when no enrichment provided", () => {
    const result = transition({
      phase: { phase: "checking_eligibility", dni: "72345678" },
      message: "",
      metadata: createMetadata(),
    });

    expect(result.type).toBe("need_enrichment");
    if (result.type === "need_enrichment") {
      expect(result.enrichment.type).toBe("check_eligibility");
    }
  });

  test("should transition to offering_products for FNB eligible client", () => {
    const enrichment: EnrichmentResult = {
      type: "eligibility_result",
      status: "eligible",
      segment: "fnb",
      credit: 5000,
      name: "JUAN PEREZ",
      affordableCategories: ["celulares", "tv"],
      categoryDisplayNames: ["celulares", "televisores"],
    };

    const result = transition({
      phase: { phase: "checking_eligibility", dni: "72345678" },
      message: "",
      metadata: createMetadata(),
      enrichment,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("offering_products");
      if (result.nextPhase.phase === "offering_products") {
        expect(result.nextPhase.segment).toBe("fnb");
        expect(result.nextPhase.credit).toBe(5000);
        expect(result.nextPhase.name).toBe("Juan");
      }
    }
  });

  test("should transition to collecting_age for GASO eligible client", () => {
    const enrichment: EnrichmentResult = {
      type: "eligibility_result",
      status: "eligible",
      segment: "gaso",
      credit: 3000,
      name: "MARIA GOMEZ",
      nse: 2,
      affordableCategories: ["cocinas"],
      categoryDisplayNames: ["cocinas a gas"],
    };

    const result = transition({
      phase: { phase: "checking_eligibility", dni: "72345678" },
      message: "",
      metadata: createMetadata(),
      enrichment,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("collecting_age");
      if (result.nextPhase.phase === "collecting_age") {
        expect(result.nextPhase.dni).toBe("72345678");
        expect(result.nextPhase.name).toBe("Maria");
      }
    }
  });

  test("should offer DNI retry when customer is not eligible (first attempt)", () => {
    const enrichment: EnrichmentResult = {
      type: "eligibility_result",
      status: "not_eligible",
    };

    const result = transition({
      phase: { phase: "checking_eligibility", dni: "72345678" },
      message: "",
      metadata: createMetadata(),
      enrichment,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("offering_dni_retry");
    }
  });

  test("should escalate when both providers are down", () => {
    const enrichment: EnrichmentResult = {
      type: "eligibility_result",
      status: "needs_human",
      handoffReason: "both_providers_down",
    };

    const result = transition({
      phase: { phase: "checking_eligibility", dni: "72345678" },
      message: "",
      metadata: createMetadata(),
      enrichment,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("escalated");
      expect(result.commands).toContainEqual(
        expect.objectContaining({ type: "ESCALATE" }),
      );
    }
  });

  test("should reject FNB client with credit below minimum", () => {
    const enrichment: EnrichmentResult = {
      type: "eligibility_result",
      status: "eligible",
      segment: "fnb",
      credit: 50, // Below 100 minimum
      name: "PEDRO TORRES",
    };

    const result = transition({
      phase: { phase: "checking_eligibility", dni: "72345678" },
      message: "",
      metadata: createMetadata(),
      enrichment,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("closing");
    }
  });
});

describe("Conversation transitions (collecting age phase)", () => {
  test("should accept valid age and proceed to offering_products", () => {
    const result = transition({
      phase: {
        phase: "collecting_age",
        dni: "72345678",
        name: "Juan",
        credit: 3000,
        affordableCategories: ["cocinas"],
        categoryDisplayNames: ["cocinas a gas"],
      },
      message: "35",
      metadata: createMetadata({ segment: "gaso", credit: 3000 }),
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("offering_products");
    }
  });

  test("should reject age below 25", () => {
    const result = transition({
      phase: {
        phase: "collecting_age",
        dni: "72345678",
        name: "Maria",
        credit: 3000,
      },
      message: "22",
      metadata: createMetadata(),
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("closing");
      const messageCommand = result.commands.find(
        (c) => c.type === "SEND_MESSAGE",
      );
      expect(messageCommand?.type).toBe("SEND_MESSAGE");
    }
  });

  test("should reject invalid age format", () => {
    const result = transition({
      phase: {
        phase: "collecting_age",
        dni: "72345678",
        name: "Carlos",
      },
      message: "abc",
      metadata: createMetadata(),
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("collecting_age");
    }
  });
});

describe("Conversation transitions (terminal states)", () => {
  test("CLOSING should stay in CLOSING for short acknowledgments", () => {
    // First transition checks if message is a question
    const firstResult = transition({
      phase: { phase: "closing", purchaseConfirmed: false },
      message: "gracias",
      metadata: createMetadata(),
    });

    // Should request question detection enrichment
    expect(firstResult.type).toBe("need_enrichment");

    // Now provide enrichment saying it's not a question
    const enrichment: EnrichmentResult = {
      type: "question_detected",
      isQuestion: false,
    };

    const result = transition({
      phase: { phase: "closing", purchaseConfirmed: false },
      message: "gracias",
      metadata: createMetadata(),
      enrichment,
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("closing");
    }
  });

  test("ESCALATED should stay in ESCALATED", () => {
    const result = transition({
      phase: { phase: "escalated", reason: "timeout" },
      message: "hola?",
      metadata: createMetadata(),
    });

    expect(result.type).toBe("update");
    if (result.type === "update") {
      expect(result.nextPhase.phase).toBe("escalated");
      expect(result.commands).toHaveLength(0);
    }
  });
});
