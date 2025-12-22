import { describe, test, expect } from "bun:test";
import { transition } from "../src/state-machine/transitions";
import type { StateContext } from "../src/state-machine/types";

/**
 * These tests evaluate the bot's conversational quality and human-like responses.
 * The bot should feel natural, empathetic, and helpful - not robotic.
 */

describe("Human-like Conversational Quality", () => {
    describe("Handling confused users gracefully", () => {
        test("should handle unclear Calidda confirmation without frustration", () => {
            const result = transition({
                currentState: "CONFIRM_CLIENT",
                message: "Que es eso de Calidda?",
                context: { phoneNumber: "51987654321" },
            });

            expect(result.nextState).toBe("CONFIRM_CLIENT");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should clarify without being condescending
                expect(msg.content).toContain("Sí o No");
                // Should not say "Disculpa, no entendí" - that's too robotic
                expect(msg.content.toLowerCase()).not.toContain("error");
            }
        });

        test("should handle off-topic initial response with redirection", () => {
            const result = transition({
                currentState: "CONFIRM_CLIENT",
                message: "Cuánto cuesta un celular?",
                context: { phoneNumber: "51987654321" },
            });

            expect(result.nextState).toBe("CONFIRM_CLIENT");
            // Should ask clarification about Calidda, not give product prices yet
        });
    });

    describe("Natural waiting experiences", () => {
        test("should handle user saying they'll send DNI later without nagging", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "te lo mando más tarde",
                context: {
                    phoneNumber: "51987654321",
                    isCaliddaClient: true,
                },
            });

            expect(result.nextState).toBe("COLLECT_DNI");
            expect(result.commands).toHaveLength(0); // Stay silent - good UX
        });

        test("should handle user stalling with patience", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "espera un momento",
                context: {
                    phoneNumber: "51987654321",
                    isCaliddaClient: true,
                },
            });

            expect(result.nextState).toBe("COLLECT_DNI");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should be empathetic, not demanding
                expect(msg.content.toLowerCase()).toContain("tiempo");
                expect(msg.content.toLowerCase()).not.toContain("rápido");
                expect(msg.content.toLowerCase()).not.toContain("urgente");
            }
        });

        test("should not spam user during search", () => {
            let context: StateContext = {
                phoneNumber: "51987654321",
                isCaliddaClient: true,
            };

            // User says they're looking
            let result = transition({
                currentState: "COLLECT_DNI",
                message: "buscando",
                context,
            });
            expect(result.commands.length).toBeLessThanOrEqual(1);
            context = { ...context, ...result.updatedContext };

            // User sends acknowledgment
            result = transition({
                currentState: "COLLECT_DNI",
                message: "ya casi",
                context,
            });
            // Should stay silent
            expect(result.commands).toHaveLength(0);
        });
    });

    describe("Empathetic rejection handling", () => {
        test("should handle non-Calidda client with warmth, not coldness", () => {
            const result = transition({
                currentState: "CONFIRM_CLIENT",
                message: "No, no soy cliente",
                context: { phoneNumber: "51987654321" },
            });

            expect(result.nextState).toBe("CLOSING");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should thank them, not just reject
                expect(msg.content.toLowerCase()).toContain("gracias");
                // Should not be apologetic - be professional
                expect(msg.content.toLowerCase()).not.toContain(
                    "lamentablemente",
                );
            }
        });

        test("should handle age rejection with policy explanation", () => {
            const result = transition({
                currentState: "COLLECT_AGE",
                message: "25",
                context: {
                    phoneNumber: "51987654321",
                    segment: "gaso",
                    nse: 1,
                    creditLine: 5000,
                },
            });

            expect(result.nextState).toBe("CLOSING");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should explain it's a policy, not personal
                expect(msg.content).toContain("40 años");
                expect(msg.content.toLowerCase()).toContain("política");
                // Should not make them feel bad
                expect(msg.content.toLowerCase()).not.toContain("joven");
            }
        });
    });

    describe("Price sensitivity handling", () => {
        test("should handle price concerns empathetically", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "está muy caro, no tengo tanta plata",
                context: {
                    phoneNumber: "51987654321",
                    segment: "fnb",
                    creditLine: 3000,
                    offeredCategory: "celulares",
                },
            });

            expect(result.nextState).toBe("OFFER_PRODUCTS");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should address concern, not ignore it
                expect(msg.content.toLowerCase()).toContain("financi");
                expect(msg.content.toLowerCase()).toContain("cuota");
                // Should be understanding
                expect(msg.content.toLowerCase()).toContain("entiendo");
            }
        });
    });

    describe("Conversational natural flow", () => {
        test("should not repeat same question robotically", () => {
            const context: StateContext = {
                phoneNumber: "51987654321",
                segment: "fnb",
                creditLine: 3000,
                age: 30,
            };

            // Ask first time
            const result1 = transition({
                currentState: "OFFER_PRODUCTS",
                message: "mmm no se",
                context,
            });

            const msg1 = result1.commands.find(
                (c) => c.type === "SEND_MESSAGE",
            );
            expect(msg1?.type).toBe("SEND_MESSAGE");

            // Should ask for clarification in a human way
            if (msg1?.type === "SEND_MESSAGE") {
                // Should give examples, not just "what do you want?"
                expect(msg1.content.toLowerCase()).toMatch(
                    /celular|cocina|laptop/,
                );
            }
        });

        test("should handle multiple product interest naturally", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "me interesan celulares y también laptops",
                context: {
                    phoneNumber: "51987654321",
                    segment: "fnb",
                    creditLine: 5000,
                    age: 35,
                },
            });

            // Should handle first mentioned product
            expect(result.updatedContext.offeredCategory).toBe("celulares");
            // Should show products, not ask "cual de los dos?"
            expect(
                result.commands.some((c) => c.type === "SEND_IMAGES"),
            ).toBe(true);
        });
    });

    describe("Avoiding robotic language", () => {
        test("greeting should feel warm, not corporate", () => {
            const result = transition({
                currentState: "INIT",
                message: "",
                context: { phoneNumber: "51987654321" },
            });

            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should be friendly
                expect(msg.content).toContain("Hola");
                // Should introduce purpose quickly
                expect(msg.content.toLowerCase()).toContain("cálidda");
                // Should not be too long or formal
                expect(msg.content.length).toBeLessThan(200);
            }
        });

        test("should not use excessive emojis or ALL CAPS", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "cocina",
                context: {
                    phoneNumber: "51987654321",
                    segment: "fnb",
                    creditLine: 3000,
                },
            });

            const msgs = result.commands.filter(
                (c) => c.type === "SEND_MESSAGE",
            );
            for (const msg of msgs) {
                if (msg.type === "SEND_MESSAGE") {
                    // Should not overuse emojis
                    const emojiCount = (
                        msg.content.match(
                            /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/gu,
                        ) || []
                    ).length;
                    expect(emojiCount).toBeLessThanOrEqual(3);

                    // Should not SHOUT
                    const capsWords = msg.content.match(/[A-ZÁÉÍÓÚ]{4,}/g) || [];
                    expect(capsWords.length).toBeLessThanOrEqual(1); // Maybe one brand name
                }
            }
        });

        test("should not over-explain or be verbose", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "72345678",
                context: {
                    phoneNumber: "51987654321",
                    isCaliddaClient: true,
                },
            });

            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should be concise when just acknowledging
                expect(msg.content.length).toBeLessThan(100);
            }
        });
    });

    describe("Handling frustration with grace", () => {
        test("should handle impatient user during provider check calmly", () => {
            const result = transition({
                currentState: "WAITING_PROVIDER",
                message: "YA PUES!!",
                context: {
                    phoneNumber: "51987654321",
                    dni: "72345678",
                    waitingMessageCount: 0,
                },
            });

            expect(result.nextState).toBe("WAITING_PROVIDER");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should acknowledge without being defensive
                expect(msg.content.toLowerCase()).toMatch(
                    /consultando|momento|espera/,
                );
                // Should not apologize excessively
                expect(
                    (msg.content.match(/disculp/gi) || []).length,
                ).toBeLessThanOrEqual(1);
            }
        });

        test("should escalate gracefully after multiple frustrations", () => {
            const result = transition({
                currentState: "WAITING_PROVIDER",
                message: "Esto es una pérdida de tiempo",
                context: {
                    phoneNumber: "51987654321",
                    dni: "72345678",
                    waitingMessageCount: 2,
                },
            });

            expect(result.nextState).toBe("ESCALATED");
            expect(
                result.commands.some((c) => c.type === "ESCALATE"),
            ).toBe(true);

            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should transition to human smoothly
                expect(msg.content.toLowerCase()).toContain("asesor");
                // Should still be polite
                expect(msg.content.toLowerCase()).toContain("gracias");
            }
        });
    });

    describe("Natural objection handling", () => {
        test("should handle GASO kitchen objection with empathy, not pushiness", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "no necesito cocina",
                context: {
                    phoneNumber: "51987654321",
                    segment: "gaso",
                    creditLine: 3000,
                    age: 45,
                },
            });

            expect(result.nextState).toBe("HANDLE_OBJECTION");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should explain reason, not just push
                expect(msg.content.toLowerCase()).toContain("requisito");
                // Should offer value proposition
                expect(msg.content.toLowerCase()).toMatch(
                    /tasa|cuota|financiar/,
                );
                // Should not sound desperate
                expect(msg.content.toLowerCase()).not.toContain("por favor");
            }
        });

        test("should not harass after 2 objections", () => {
            const result = transition({
                currentState: "HANDLE_OBJECTION",
                message: "No quiero",
                context: {
                    phoneNumber: "51987654321",
                    segment: "gaso",
                    creditLine: 3000,
                    objectionCount: 2,
                },
            });

            expect(result.nextState).toBe("ESCALATED");
            // Should respect their decision and escalate
            expect(
                result.commands.some((c) => c.type === "ESCALATE"),
            ).toBe(true);
        });
    });

    describe("Purchase confirmation feels rewarding", () => {
        test("should celebrate purchase confirmation warmly", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "Sí, lo quiero",
                context: {
                    phoneNumber: "51987654321",
                    segment: "fnb",
                    creditLine: 3000,
                    offeredCategory: "celulares",
                },
            });

            expect(result.nextState).toBe("CLOSING");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should be enthusiastic but professional
                expect(msg.content).toMatch(/Excelente|Perfecto|Genial/);
                // Should set expectations
                expect(msg.content.toLowerCase()).toContain("asesor");
                expect(msg.content.toLowerCase()).toMatch(/comunicará|contactará/);
                // Should not be too lengthy
                expect(msg.content.length).toBeLessThan(300);
            }
        });
    });

    describe("Context awareness and personalization", () => {
        test("should greet returning users with context", () => {
            const result = transition({
                currentState: "INIT",
                message: "",
                context: {
                    phoneNumber: "51987654321",
                    lastInterestCategory: "laptops",
                },
            });

            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should reference previous interest
                expect(msg.content.toLowerCase()).toContain("laptop");
                // Should offer to continue
                expect(msg.content.toLowerCase()).toMatch(/continuar|dejamos/);
            }
        });

        test("should use name when available", () => {
            const result = transition({
                currentState: "COLLECT_AGE",
                message: "35",
                context: {
                    phoneNumber: "51987654321",
                    segment: "fnb",
                    creditLine: 3000,
                    clientName: "Juan",
                },
            });

            // In future implementations, could personalize with name
            // For now, just verify it doesn't break
            expect(result.nextState).toBe("OFFER_PRODUCTS");
        });
    });

    describe("Appropriate sales tone", () => {
        test("should be helpful, not pushy", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "no estoy seguro",
                context: {
                    phoneNumber: "51987654321",
                    segment: "fnb",
                    creditLine: 3000,
                },
            });

            expect(result.nextState).toBe("OFFER_PRODUCTS");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should offer help, not pressure
                expect(msg.content).not.toMatch(/debes|tienes que|obligatorio/i);
                // Should provide options/guidance
                expect(msg.content.toLowerCase()).toMatch(/celular|cocina|laptop|producto/);
            }
        });

        test("should build trust before selling", () => {
            // User tries to jump straight to products
            const result = transition({
                currentState: "CONFIRM_CLIENT",
                message: "quiero un celular",
                context: { phoneNumber: "51987654321" },
            });

            // Should still confirm Calidda client first (process compliance)
            expect(result.nextState).toBe("CONFIRM_CLIENT");
        });
    });
});

describe("Edge Cases with Human Touch", () => {
    test("should handle typos gracefully", () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "mi dni es 7234567",
            context: {
                phoneNumber: "51987654321",
                isCaliddaClient: true,
            },
        });

        expect(result.nextState).toBe("COLLECT_DNI");
        const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
        if (msg?.type === "SEND_MESSAGE") {
            // Should politely ask for correction
            expect(msg.content).toContain("8 dígitos");
            // Should not say "error" or "incorrecto"
            expect(msg.content.toLowerCase()).not.toContain("error");
        }
    });

    test("should handle mixed signals (yes and no in same message)", () => {
        const result = transition({
            currentState: "CONFIRM_CLIENT",
            message: "sí bueno, pero no estoy seguro si soy titular",
            context: { phoneNumber: "51987654321" },
        });

        // Should err on side of proceeding (optimistic)
        expect(result.nextState).toBe("COLLECT_DNI");
    });

    test("should handle extra information volunteered early", () => {
        const result = transition({
            currentState: "CONFIRM_CLIENT",
            message: "Sí, mi DNI es 72345678 y me interesan celulares",
            context: { phoneNumber: "51987654321" },
        });

        // Should accept the DNI even though not asked yet
        expect(result.nextState).toBe("WAITING_PROVIDER");
        expect(result.updatedContext.dni).toBe("72345678");
    });

    test("should handle conversational filler without confusion", () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "ah ok, es 72345678",
            context: {
                phoneNumber: "51987654321",
                isCaliddaClient: true,
            },
        });

        // Should extract DNI despite filler words
        expect(result.nextState).toBe("WAITING_PROVIDER");
        expect(result.updatedContext.dni).toBe("72345678");
    });

    test("should handle questions during the flow", () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "Para qué necesitan mi DNI?",
            context: {
                phoneNumber: "51987654321",
                isCaliddaClient: true,
            },
        });

        // Should stay in same state but not send harsh message
        expect(result.nextState).toBe("COLLECT_DNI");
        // In a perfect world, would explain. For now, just don't break
    });

    test("should handle sarcasm/jokes appropriately", () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "12345678",
            context: {
                phoneNumber: "51987654321",
                isCaliddaClient: true,
            },
        });

        // Should proceed (it's valid format even if obviously fake)
        expect(result.nextState).toBe("WAITING_PROVIDER");
        // Provider check will handle validation
    });
});

describe("Message Quality Checks", () => {
    test("no message should have spelling errors in common words", () => {
        const transitions = [
            {
                state: "INIT" as const,
                message: "",
                context: { phoneNumber: "51987654321" },
            },
            {
                state: "CONFIRM_CLIENT" as const,
                message: "sí",
                context: { phoneNumber: "51987654321" },
            },
            {
                state: "COLLECT_DNI" as const,
                message: "abc",
                context: {
                    phoneNumber: "51987654321",
                    isCaliddaClient: true,
                },
            },
        ];

        for (const t of transitions) {
            const result = transition({
                currentState: t.state,
                message: t.message,
                context: t.context,
            });

            const msgs = result.commands.filter(
                (c) => c.type === "SEND_MESSAGE",
            );
            for (const msg of msgs) {
                if (msg.type === "SEND_MESSAGE") {
                    // Check for common typos
                    expect(msg.content.toLowerCase()).not.toContain("graias"); // gracias
                    expect(msg.content.toLowerCase()).not.toContain("porfavor"); // por favor
                    expect(msg.content.toLowerCase()).not.toContain(
                        "asecer",
                    ); // asesor
                }
            }
        }
    });

    test("messages should use consistent Spanish style", () => {
        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "celular",
            context: {
                phoneNumber: "51987654321",
                segment: "fnb",
                creditLine: 3000,
            },
        });

        const msgs = result.commands.filter((c) => c.type === "SEND_MESSAGE");
        for (const msg of msgs) {
            if (msg.type === "SEND_MESSAGE") {
                // Should use Peruvian Spanish style (no Spain-specific terms)
                expect(msg.content.toLowerCase()).not.toContain("vale"); // unless informal
                expect(msg.content.toLowerCase()).not.toContain("tío");
                expect(msg.content.toLowerCase()).not.toContain("ordenador"); // use computadora

                // Should use proper accentuation
                if (msg.content.includes("telefono")) {
                    expect(msg.content).toContain("teléfono");
                }
            }
        }
    });
});
