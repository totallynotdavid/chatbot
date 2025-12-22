import { describe, test, expect, beforeAll } from "bun:test";
import * as LLM from "../src/services/llm.ts";

/**
 * Tests for LLM Service (Gemini 2.0 Flash)
 * 
 * IMPORTANT: These tests require GEMINI_API_KEY in .env file
 * Run with: bun test --env-file=../../.env tests/llm-service.test.ts
 * To skip manually: SKIP_LLM_TESTS=1 bun test --env-file=../../.env
 */

// Only skip if explicitly requested - API key loaded via --env-file
const FORCE_SKIP = process.env.SKIP_LLM_TESTS === "1";

describe("LLM Service - Intent Classification", () => {
    beforeAll(() => {
        if (!process.env.GEMINI_API_KEY && !FORCE_SKIP) {
            console.warn("⚠️  GEMINI_API_KEY not set - tests may fail");
            console.warn("   Run: bun test --env-file=../../.env");
        } else if (process.env.GEMINI_API_KEY) {
            console.log("✓ GEMINI_API_KEY found - running LLM tests");
        }
    });

    test.skipIf(FORCE_SKIP)("should classify simple affirmation as 'yes'", async () => {
        const result = await LLM.classifyIntent("Sí");
        expect(result).toBe("yes");
    });

    test.skipIf(FORCE_SKIP)("should classify negation as 'no'", async () => {
        const result = await LLM.classifyIntent("No gracias");
        expect(result).toBe("no");
    });

    test.skipIf(FORCE_SKIP)("should classify question with '?' as 'question'", async () => {
        const result = await LLM.classifyIntent("¿Cuánto cuesta?");
        expect(result).toBe("question");
    });

    test.skipIf(FORCE_SKIP)("should classify question without '?' as 'question'", async () => {
        const result = await LLM.classifyIntent("cuanto cuesta eso");
        expect(result).toBe("question");
    });

    test.skipIf(FORCE_SKIP)("should classify complex product question as 'question'", async () => {
        const result = await LLM.classifyIntent("Me puedes decir qué productos tienen disponibles");
        expect(result).toBe("question");
    });

    test.skipIf(FORCE_SKIP)("should handle informal Peruvian Spanish questions", async () => {
        const result = await LLM.classifyIntent("pe causa cuánto sale la refri");
        expect(result).toBe("question");
    });

    test.skipIf(FORCE_SKIP)("should classify unclear gibberish as 'unclear'", async () => {
        const result = await LLM.classifyIntent("asdfjkl xyz 123");
        expect(result).toBe("unclear");
    });
});

describe("LLM Service - Entity Extraction", () => {
    // Mock available categories from database
    const mockCategories = ["celulares", "cocinas", "laptops", "refrigeradoras", "televisores", "termas"];

    test.skipIf(FORCE_SKIP)("should extract category from brand name (iPhone → celulares)", async () => {
        const result = await LLM.extractEntity("Quiero un iPhone", "product_category", {
            availableCategories: mockCategories,
        });
        expect(result?.toLowerCase()).toContain("celular");
    });

    test.skipIf(FORCE_SKIP)("should extract category from informal request (refri)", async () => {
        const result = await LLM.extractEntity("una refri pe", "product_category", {
            availableCategories: mockCategories,
        });
        expect(result?.toLowerCase()).toMatch(/refrigerad|refri/);
    });

    test.skipIf(FORCE_SKIP)("should extract category from complex sentence", async () => {
        const result = await LLM.extractEntity(
            "Me interesa ver laptops para trabajar desde casa",
            "product_category",
            { availableCategories: mockCategories }
        );
        expect(result?.toLowerCase()).toContain("laptop");
    });

    test.skipIf(FORCE_SKIP)("should map Samsung to celulares category", async () => {
        const result = await LLM.extractEntity("Un Samsung Galaxy", "product_category", {
            availableCategories: mockCategories,
        });
        expect(result?.toLowerCase()).toContain("celular");
    });

    test.skipIf(FORCE_SKIP)("should return null when no category found", async () => {
        const result = await LLM.extractEntity("Hola, buenos días", "product_category", {
            availableCategories: mockCategories,
        });
        expect(result).toBeNull();
    });

    test.skipIf(FORCE_SKIP)("should handle mixed categories and pick primary intent", async () => {
        const result = await LLM.extractEntity(
            "Quiero un celular o una laptop",
            "product_category",
            { availableCategories: mockCategories }
        );
        // Should extract at least one category
        expect(result).not.toBeNull();
        expect(result?.toLowerCase()).toMatch(/celular|laptop/);
    });

    test.skipIf(FORCE_SKIP)("should work with custom/dynamic categories from database", async () => {
        // Simulate a custom category added by sales people
        const customCategories = ["celulares", "laptops", "aire-acondicionado", "microondas"];
        
        const result = await LLM.extractEntity(
            "Me gustaría un microondas",
            "product_category",
            { availableCategories: customCategories }
        );
        
        expect(result?.toLowerCase()).toBe("microondas");
    });
});

describe("LLM Service - Question Answering", () => {
    test.skipIf(FORCE_SKIP)("should answer financing question WITHOUT escalating", async () => {
        const result = await LLM.answerQuestion(
            "¿Cómo funciona el financiamiento?",
            { segment: "fnb", creditLine: 3000 }
        );

        expect(result.requiresHuman).toBe(false);
        expect(result.answer.toLowerCase()).toContain("cuota");
        expect(result.answer.toLowerCase()).toMatch(/calidda|recibo/);
        // Should be concise (not robotic)
        expect(result.answer.length).toBeLessThan(300);
    });

    test.skipIf(FORCE_SKIP)("should answer product availability question WITHOUT escalating", async () => {
        const result = await LLM.answerQuestion(
            "¿Qué productos tienen?",
            { segment: "gaso", creditLine: 2000 }
        );

        expect(result.requiresHuman).toBe(false);
        expect(result.answer.toLowerCase()).toMatch(/celular|laptop|cocina|tv/);
        // Should mention at least 2 product categories
        const productMentions = (result.answer.toLowerCase().match(/celular|laptop|cocina|tv|refrigerad|terma/g) || []).length;
        expect(productMentions).toBeGreaterThanOrEqual(2);
    });

    test.skipIf(FORCE_SKIP)("should answer zone coverage question WITHOUT escalating", async () => {
        const result = await LLM.answerQuestion(
            "¿Hacen envíos a Arequipa?",
            { segment: "fnb", creditLine: 5000 }
        );

        expect(result.requiresHuman).toBe(false);
        expect(result.answer.toLowerCase()).toMatch(/lima|callao/);
    });

    test.skipIf(FORCE_SKIP)("should ESCALATE on specific cuota amount question", async () => {
        const result = await LLM.answerQuestion(
            "¿Cuánto voy a pagar por cuota exactamente?",
            { segment: "gaso", creditLine: 2500 }
        );

        expect(result.requiresHuman).toBe(true);
        // Answer should still be polite
        expect(result.answer.length).toBeGreaterThan(10);
    });

    test.skipIf(FORCE_SKIP)("should ESCALATE on interest rate question", async () => {
        const result = await LLM.answerQuestion(
            "¿Qué tasa de interés manejan?",
            { segment: "fnb", creditLine: 4000 }
        );

        expect(result.requiresHuman).toBe(true);
    });

    test.skipIf(FORCE_SKIP)("should ESCALATE on approval guarantee request", async () => {
        const result = await LLM.answerQuestion(
            "¿Me van a aprobar seguro?",
            { segment: "gaso", creditLine: 1500 }
        );

        expect(result.requiresHuman).toBe(true);
    });

    test.skipIf(FORCE_SKIP)("should ESCALATE on complaint/claim", async () => {
        const result = await LLM.answerQuestion(
            "Quiero hacer un reclamo por un producto",
            { segment: "fnb", creditLine: 3000 }
        );

        expect(result.requiresHuman).toBe(true);
    });

    test.skipIf(FORCE_SKIP)("should handle informal Peruvian Spanish naturally", async () => {
        const result = await LLM.answerQuestion(
            "pe causa cómo es la movida del pago",
            { segment: "gaso", creditLine: 2000 }
        );

        expect(result.requiresHuman).toBe(false);
        expect(result.answer.toLowerCase()).toMatch(/cuota|pago|calidda|recibo/);
    });

    test.skipIf(FORCE_SKIP)("should NOT use excessive emojis", async () => {
        const result = await LLM.answerQuestion(
            "¿Cómo funciona?",
            { segment: "fnb", creditLine: 3000 }
        );

        // Count emojis using a simpler approach
        const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
        const emojiCount = (result.answer.match(emojiPattern) || []).length;
        expect(emojiCount).toBeLessThanOrEqual(1);
    });

    test.skipIf(FORCE_SKIP)("should close with product interest question", async () => {
        const result = await LLM.answerQuestion(
            "¿Qué zonas cubren?",
            { segment: "fnb", creditLine: 5000 }
        );

        expect(result.requiresHuman).toBe(false);
        // Should naturally lead back to sales conversation
        expect(result.answer.toLowerCase()).toMatch(/product|interesa|gust|quiere/);
    });
});

describe("LLM Service - Error Handling", () => {
    test("should return 'unclear' on classifyIntent failure (no API key)", async () => {
        // Temporarily remove API key
        const originalKey = process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_API_KEY;

        const result = await LLM.classifyIntent("test");
        expect(result).toBe("unclear");

        // Restore
        if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    });

    test("should return null on extractEntity failure (no API key)", async () => {
        const originalKey = process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_API_KEY;

        const result = await LLM.extractEntity("test", "product_category");
        expect(result).toBeNull();

        if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    });
});

describe("LLM Service - Prompt Quality Checks", () => {
    test.skipIf(FORCE_SKIP)("should maintain conversational tone across multiple questions", async () => {
        const questions = [
            "¿Cómo funciona el financiamiento?",
            "¿Qué productos tienen?",
            "¿Cuánto cuesta?",
        ];

        for (const question of questions) {
            const result = await LLM.answerQuestion(question, { 
                segment: "fnb", 
                creditLine: 3000 
            });

            // Should not be robotic
            expect(result.answer.toLowerCase()).not.toContain("como ia");
            expect(result.answer.toLowerCase()).not.toContain("asistente virtual");
            expect(result.answer.toLowerCase()).not.toContain("robot");
            
            // Should be concise
            const wordCount = result.answer.split(/\s+/).length;
            expect(wordCount).toBeLessThan(80); // ~2-3 lines
        }
    });

    test.skipIf(FORCE_SKIP)("should respect sales context boundaries", async () => {
        const result = await LLM.answerQuestion(
            "¿Pueden darme un descuento adicional si pago todo de una vez?",
            { segment: "fnb", creditLine: 5000 }
        );

        // This requires human authorization
        expect(result.requiresHuman).toBe(true);
    });
});
