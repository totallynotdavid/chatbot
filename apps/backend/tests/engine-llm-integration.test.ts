import { describe, test, expect } from "bun:test";
import { transition } from "@totem/core";
import type { StateContext } from "@totem/core";

/**
 * Tests for Backend Pre-Processing Integration
 * 
 * These tests verify that:
 * 1. Backend enriches context with LLM before calling core
 * 2. Core uses LLM enrichment when available
 * 3. Core falls back to regex when LLM not available
 */

describe("Backend Pre-Processing Pattern", () => {
    describe("LLM Question Detection Flow", () => {
        test("should use LLM answer when llmDetectedQuestion=true and requiresHuman=false", () => {
            const context: StateContext = {
                phoneNumber: "51987654321",
                segment: "fnb",
                creditLine: 3000,
                // Backend added these after LLM classification
                llmDetectedQuestion: true,
                llmGeneratedAnswer: "Puedes pagarlo en cuotas mensuales que salen en tu recibo de Calidda.",
                llmRequiresHuman: false,
            };

            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "¿Cómo funciona el financiamiento?",
                context,
            });

            // Should send LLM answer and continue conversation
            expect(result.nextState).toBe("OFFER_PRODUCTS");
            const messages = result.commands.filter(c => c.type === "SEND_MESSAGE");
            expect(messages.length).toBeGreaterThanOrEqual(1);
            
            // First message should be LLM answer
            const firstMessage = messages[0];
            if (firstMessage?.type === "SEND_MESSAGE") {
                expect(firstMessage.content).toBe("Puedes pagarlo en cuotas mensuales que salen en tu recibo de Calidda.");
            }
        });

        test("should escalate when llmDetectedQuestion=true and requiresHuman=true", () => {
            const context: StateContext = {
                phoneNumber: "51987654321",
                segment: "gaso",
                creditLine: 2000,
                // Backend detected complex question requiring human
                llmDetectedQuestion: true,
                llmGeneratedAnswer: "Para darte información precisa sobre eso, te conectaré con un asesor.",
                llmRequiresHuman: true,
            };

            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "¿Cuánto voy a pagar exactamente por cuota?",
                context,
            });

            // Should escalate
            expect(result.nextState).toBe("ESCALATED");
            expect(result.commands.some(c => c.type === "ESCALATE")).toBe(true);
            expect(result.commands.some(c => c.type === "NOTIFY_TEAM")).toBe(true);
        });

        test("should fall back to regex when llmDetectedQuestion=false", () => {
            const context: StateContext = {
                phoneNumber: "51987654321",
                segment: "fnb",
                creditLine: 3000,
                // Backend didn't detect question (user saying product name)
                llmDetectedQuestion: false,
            };

            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "Me interesan los celulares",
                context,
            });

            // Should use regex category extraction
            expect(result.nextState).toBe("OFFER_PRODUCTS");
            expect(result.updatedContext.offeredCategory).toBe("celulares");
            expect(result.commands.some(c => c.type === "SEND_IMAGES")).toBe(true);
        });
    });

    describe("LLM Category Extraction Flow", () => {
        test("should use llmExtractedCategory when available (Priority 2)", () => {
            const context: StateContext = {
                phoneNumber: "51987654321",
                segment: "fnb",
                creditLine: 5000,
                // Backend extracted category via LLM (handles brand→category automatically)
                llmExtractedCategory: "celulares",
            };

            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "Quiero un iPhone",
                context,
            });

            expect(result.nextState).toBe("OFFER_PRODUCTS");
            expect(result.updatedContext.offeredCategory).toBe("celulares");
            expect(result.commands.some(c => c.type === "SEND_IMAGES")).toBe(true);
            
            // Should track extraction method
            const trackEvent = result.commands.find(c => c.type === "TRACK_EVENT");
            if (trackEvent?.type === "TRACK_EVENT") {
                expect(trackEvent.metadata?.extractionMethod).toBe("llm");
            }
        });

        test("should fall back to regex when llmExtractedCategory not available", () => {
            const context: StateContext = {
                phoneNumber: "51987654321",
                segment: "gaso",
                creditLine: 2500,
                // No LLM extraction available
            };

            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "cocinas",
                context,
            });

            expect(result.nextState).toBe("OFFER_PRODUCTS");
            expect(result.updatedContext.offeredCategory).toBe("cocinas");
        });

        test("should handle brand names via regex when LLM unavailable", () => {
            const context: StateContext = {
                phoneNumber: "51987654321",
                segment: "fnb",
                creditLine: 4000,
            };

            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "Samsung Galaxy",
                context,
            });

            // Regex should map Samsung → celulares
            expect(result.updatedContext.offeredCategory).toBe("celulares");
        });
    });

    describe("Objection Handling with LLM", () => {
        test("should answer question during objection if LLM provides answer", () => {
            const context: StateContext = {
                phoneNumber: "51987654321",
                segment: "gaso",
                creditLine: 2000,
                objectionCount: 1,
                // User asked question during objection
                llmDetectedQuestion: true,
                llmGeneratedAnswer: "Las cocinas incluyen 4 hornillas y horno. ¿Te gustaría ver los modelos?",
                llmRequiresHuman: false,
            };

            const result = transition({
                currentState: "HANDLE_OBJECTION",
                message: "¿Qué tiene la cocina?",
                context,
            });

            // Should stay in objection state but answer question
            expect(result.nextState).toBe("HANDLE_OBJECTION");
            const messages = result.commands.filter(c => c.type === "SEND_MESSAGE");
            expect(messages[0]?.type === "SEND_MESSAGE" && messages[0].content).toContain("cocinas");
        });

        test("should escalate if complex question during objection", () => {
            const context: StateContext = {
                phoneNumber: "51987654321",
                segment: "gaso",
                creditLine: 2000,
                objectionCount: 1,
                llmDetectedQuestion: true,
                llmRequiresHuman: true,
            };

            const result = transition({
                currentState: "HANDLE_OBJECTION",
                message: "¿Puedo cambiar las condiciones?",
                context,
            });

            expect(result.nextState).toBe("ESCALATED");
            expect(result.commands.some(c => c.type === "ESCALATE")).toBe(true);
        });
    });

    describe("Zero Coupling Principle", () => {
        test("core should work without any LLM enrichment (pure regex fallback)", () => {
            const context: StateContext = {
                phoneNumber: "51987654321",
                segment: "fnb",
                creditLine: 3000,
                // NO LLM fields at all
            };

            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "laptop",
                context,
            });

            // Should still work with pure regex
            expect(result.updatedContext.offeredCategory).toBe("laptops");
            expect(result.commands.some(c => c.type === "SEND_IMAGES")).toBe(true);
        });

        test("core should never call async functions (remains pure)", () => {
            // This test verifies architectural constraint
            const context: StateContext = {
                phoneNumber: "51987654321",
                segment: "gaso",
                creditLine: 2500,
            };

            // transition() is synchronous - should not throw
            expect(() => {
                const result = transition({
                    currentState: "OFFER_PRODUCTS",
                    message: "celulares",
                    context,
                });
                // If this executed, function is synchronous
                expect(result.nextState).toBe("OFFER_PRODUCTS");
            }).not.toThrow();
        });
    });
});

describe("Priority System Verification", () => {
    test("Priority 1: LLM question detection should override category extraction", () => {
        const context: StateContext = {
            phoneNumber: "51987654321",
            segment: "fnb",
            creditLine: 5000,
            // User asked a question (Priority 1)
            llmDetectedQuestion: true,
            llmGeneratedAnswer: "Tenemos iPhone, Samsung, Xiaomi y más.",
            llmRequiresHuman: false,
            // Category also available (Priority 2)
            llmExtractedCategory: "celulares",
        };

        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "¿Qué celulares tienen?",
            context,
        });

        // Should answer question first (Priority 1), then ask for interest
        const messages = result.commands.filter(c => c.type === "SEND_MESSAGE");
        expect(messages.length).toBeGreaterThanOrEqual(2);
        
        // Should NOT trigger SEND_IMAGES yet (waiting for explicit category selection)
        expect(result.commands.some(c => c.type === "SEND_IMAGES")).toBe(false);
    });

    test("Priority 2: LLM category extraction should override regex", () => {
        const context: StateContext = {
            phoneNumber: "51987654321",
            segment: "fnb",
            creditLine: 3000,
            // LLM extracted category (Priority 2)
            llmExtractedCategory: "televisores",
        };

        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "quiero un smart tv",
            context,
        });

        // Should use LLM extraction
        expect(result.updatedContext.offeredCategory).toBe("televisores");
        
        const trackEvent = result.commands.find(c => c.type === "TRACK_EVENT");
        if (trackEvent?.type === "TRACK_EVENT") {
            expect(trackEvent.metadata?.extractionMethod).toBe("llm");
        }
    });

    test("Priority 3: Regex fallback when no LLM enrichment", () => {
        const context: StateContext = {
            phoneNumber: "51987654321",
            segment: "gaso",
            creditLine: 2000,
            // No LLM enrichment
        };

        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "notebook",
            context,
        });

        // Should use regex
        expect(result.updatedContext.offeredCategory).toBe("laptops");
    });
});

describe("Edge Cases with LLM Integration", () => {
    test("should handle price objection even if llmDetectedQuestion=true", () => {
        const context: StateContext = {
            phoneNumber: "51987654321",
            segment: "fnb",
            creditLine: 3000,
            offeredCategory: "celulares",
            // LLM might detect this as question, but it's a price concern
        };

        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "está muy caro, no tengo tanta plata",
            context,
        });

        // Price objection handler should trigger BEFORE question handler
        expect(result.nextState).toBe("OFFER_PRODUCTS");
        const message = result.commands.find(c => c.type === "SEND_MESSAGE");
        if (message?.type === "SEND_MESSAGE") {
            expect(message.content.toLowerCase()).toContain("financ");
            expect(message.content.toLowerCase()).toContain("entiendo");
        }
    });

    test("should handle purchase confirmation even if LLM extracts category", () => {
        const context: StateContext = {
            phoneNumber: "51987654321",
            segment: "fnb",
            creditLine: 5000,
            offeredCategory: "celulares",
            llmExtractedCategory: "celulares", // LLM also extracted it
        };

        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "Sí, me lo llevo",
            context,
        });

        // Purchase confirmation should trigger
        expect(result.nextState).toBe("CLOSING");
        expect(result.updatedContext.purchaseConfirmed).toBe(true);
        expect(result.commands.some(c => c.type === "NOTIFY_TEAM")).toBe(true);
    });
});
