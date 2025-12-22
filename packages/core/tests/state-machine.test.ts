import { describe, test, expect } from "bun:test";
import { transition } from "../src/state-machine/transitions";
import type { TransitionInput, StateContext } from "../src/state-machine/types";

describe("State Machine - INIT to CONFIRM_CLIENT", () => {
    test("should greet new user and move to CONFIRM_CLIENT", () => {
        const input: TransitionInput = {
            currentState: "INIT",
            message: "",
            context: { phoneNumber: "51987654321" },
        };

        const result = transition(input);

        expect(result.nextState).toBe("CONFIRM_CLIENT");
        expect(result.commands).toHaveLength(2);
        expect(result.commands[0].type).toBe("TRACK_EVENT");
        expect(result.commands[1].type).toBe("SEND_MESSAGE");
        expect(result.updatedContext.sessionStartedAt).toBeDefined();
    });

    test("should greet returning user with their last interest category", () => {
        const input: TransitionInput = {
            currentState: "INIT",
            message: "",
            context: {
                phoneNumber: "51987654321",
                lastInterestCategory: "celulares",
            },
        };

        const result = transition(input);

        expect(result.nextState).toBe("CONFIRM_CLIENT");
        expect(result.commands).toHaveLength(2);
        const messageCommand = result.commands.find(
            (c) => c.type === "SEND_MESSAGE",
        );
        expect(messageCommand?.type).toBe("SEND_MESSAGE");
        if (messageCommand?.type === "SEND_MESSAGE") {
            expect(messageCommand.content).toContain("celulares");
        }
    });
});

describe("State Machine - CONFIRM_CLIENT edge cases", () => {
    const baseContext: StateContext = { phoneNumber: "51987654321" };

    test('should handle clear "sí" affirmation', () => {
        const result = transition({
            currentState: "CONFIRM_CLIENT",
            message: "Sí",
            context: baseContext,
        });

        expect(result.nextState).toBe("COLLECT_DNI");
        expect(result.updatedContext.isCaliddaClient).toBe(true);
    });

    test('should handle clear "no" rejection', () => {
        const result = transition({
            currentState: "CONFIRM_CLIENT",
            message: "No",
            context: baseContext,
        });

        expect(result.nextState).toBe("CLOSING");
        expect(result.updatedContext.isCaliddaClient).toBe(false);
    });

    test('should handle "no tengo" (negative phrase) correctly', () => {
        const result = transition({
            currentState: "CONFIRM_CLIENT",
            message: "no tengo gas",
            context: baseContext,
        });

        expect(result.nextState).toBe("CLOSING");
        expect(result.updatedContext.isCaliddaClient).toBe(false);
    });

    test("should handle affirmations in conversational form", () => {
        const result = transition({
            currentState: "CONFIRM_CLIENT",
            message: "Soy cliente de calidda",
            context: baseContext,
        });

        expect(result.nextState).toBe("COLLECT_DNI");
        expect(result.updatedContext.isCaliddaClient).toBe(true);
    });

    test("should ask for clarification on ambiguous responses", () => {
        const result = transition({
            currentState: "CONFIRM_CLIENT",
            message: "Hola, me interesa",
            context: baseContext,
        });

        expect(result.nextState).toBe("CONFIRM_CLIENT");
        const messageCommand = result.commands.find(
            (c) => c.type === "SEND_MESSAGE",
        );
        expect(messageCommand?.type).toBe("SEND_MESSAGE");
        if (messageCommand?.type === "SEND_MESSAGE") {
            expect(messageCommand.content).toContain("Sí o No");
        }
    });

    test("should handle variations of yes (claro, ok, vale, dale)", () => {
        const variations = ["claro", "ok", "vale", "dale que sí", "sep"];

        for (const msg of variations) {
            const result = transition({
                currentState: "CONFIRM_CLIENT",
                message: msg,
                context: baseContext,
            });

            expect(result.nextState).toBe("COLLECT_DNI");
            expect(result.updatedContext.isCaliddaClient).toBe(true);
        }
    });
});

describe("State Machine - COLLECT_DNI edge cases", () => {
    const baseContext: StateContext = {
        phoneNumber: "51987654321",
        isCaliddaClient: true,
    };

    test("should extract valid 8-digit DNI", () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "72345678",
            context: baseContext,
        });

        expect(result.nextState).toBe("WAITING_PROVIDER");
        expect(result.updatedContext.dni).toBe("72345678");
        expect(result.commands).toContainEqual({
            type: "CHECK_FNB",
            dni: "72345678",
        });
    });

    test("should extract DNI from text with extra characters", () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "Mi DNI es 72345678",
            context: baseContext,
        });

        expect(result.nextState).toBe("WAITING_PROVIDER");
        expect(result.updatedContext.dni).toBe("72345678");
    });

    test('should wait silently when user says "te mando luego"', () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "te mando en un rato",
            context: baseContext,
        });

        expect(result.nextState).toBe("COLLECT_DNI");
        expect(result.commands).toHaveLength(0); // No message sent
    });

    test('should respond once to "no lo tengo a la mano"', () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "no lo tengo a la mano",
            context: baseContext,
        });

        expect(result.nextState).toBe("COLLECT_DNI");
        expect(result.commands).toHaveLength(1);
        expect(result.updatedContext.askedToWait).toBe(true);
    });

    test('should stay silent after already asking user to wait', () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "déjame buscarlo",
            context: { ...baseContext, askedToWait: true },
        });

        expect(result.nextState).toBe("COLLECT_DNI");
        expect(result.commands).toHaveLength(0); // Silent because already asked
    });

    test("should stay silent on acknowledgments (ok, gracias, ya, listo)", () => {
        const acknowledgments = ["gracias", "ok", "vale", "entendido", "listo", "ya"];

        for (const msg of acknowledgments) {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: msg,
                context: baseContext,
            });

            expect(result.nextState).toBe("COLLECT_DNI");
            expect(result.commands).toHaveLength(0);
        }
    });

    test("should stay silent on very short messages (noise)", () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "ah",
            context: baseContext,
        });

        expect(result.nextState).toBe("COLLECT_DNI");
        expect(result.commands).toHaveLength(0);
    });

    test("should reject invalid DNI formats", () => {
        const invalidDNIs = ["1234567", "123456789", "abcd1234"];

        for (const dni of invalidDNIs) {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: dni,
                context: baseContext,
            });

            expect(result.nextState).toBe("COLLECT_DNI");
            const messageCommand = result.commands.find(
                (c) => c.type === "SEND_MESSAGE",
            );
            expect(messageCommand?.type).toBe("SEND_MESSAGE");
            if (messageCommand?.type === "SEND_MESSAGE") {
                expect(messageCommand.content).toContain("8 dígitos");
            }
        }
    });
});

describe("State Machine - WAITING_PROVIDER timeout handling", () => {
    const baseContext: StateContext = {
        phoneNumber: "51987654321",
        dni: "72345678",
    };

    test("should acknowledge first impatient message", () => {
        const result = transition({
            currentState: "WAITING_PROVIDER",
            message: "¿Ya?",
            context: baseContext,
        });

        expect(result.nextState).toBe("WAITING_PROVIDER");
        expect(result.updatedContext.waitingMessageCount).toBe(1);
        const messageCommand = result.commands.find(
            (c) => c.type === "SEND_MESSAGE",
        );
        expect(messageCommand?.type).toBe("SEND_MESSAGE");
        if (messageCommand?.type === "SEND_MESSAGE") {
            expect(messageCommand.content).toContain("consultando");
        }
    });

    test("should reassure on second impatient message", () => {
        const result = transition({
            currentState: "WAITING_PROVIDER",
            message: "Cuánto demora?",
            context: { ...baseContext, waitingMessageCount: 1 },
        });

        expect(result.nextState).toBe("WAITING_PROVIDER");
        expect(result.updatedContext.waitingMessageCount).toBe(2);
        const messageCommand = result.commands.find(
            (c) => c.type === "SEND_MESSAGE",
        );
        expect(messageCommand?.type).toBe("SEND_MESSAGE");
        if (messageCommand?.type === "SEND_MESSAGE") {
            expect(messageCommand.content).toContain("Casi listo");
        }
    });

    test("should escalate after 3 impatient messages", () => {
        const result = transition({
            currentState: "WAITING_PROVIDER",
            message: "Ya pasó mucho tiempo",
            context: { ...baseContext, waitingMessageCount: 2 },
        });

        expect(result.nextState).toBe("ESCALATED");
        expect(result.commands).toContainEqual({
            type: "ESCALATE",
            reason: "provider_check_timeout_multiple_messages",
        });
    });
});

describe("State Machine - COLLECT_AGE validation", () => {
    test("should accept valid age", () => {
        const result = transition({
            currentState: "COLLECT_AGE",
            message: "35",
            context: {
                phoneNumber: "51987654321",
                segment: "fnb",
                creditLine: 3000,
            },
        });

        expect(result.nextState).toBe("OFFER_PRODUCTS");
        expect(result.updatedContext.age).toBe(35);
    });

    test("should reject age below 18", () => {
        const result = transition({
            currentState: "COLLECT_AGE",
            message: "17",
            context: { phoneNumber: "51987654321" },
        });

        expect(result.nextState).toBe("COLLECT_AGE");
        const messageCommand = result.commands.find(
            (c) => c.type === "SEND_MESSAGE",
        );
        expect(messageCommand?.type).toBe("SEND_MESSAGE");
    });

    test("should reject age above 120", () => {
        const result = transition({
            currentState: "COLLECT_AGE",
            message: "150",
            context: { phoneNumber: "51987654321" },
        });

        expect(result.nextState).toBe("COLLECT_AGE");
    });

    test("should reject GASO NSE 1-2 clients under 40", () => {
        const result = transition({
            currentState: "COLLECT_AGE",
            message: "35",
            context: {
                phoneNumber: "51987654321",
                segment: "gaso",
                nse: 2,
                creditLine: 5000,
            },
        });

        expect(result.nextState).toBe("CLOSING");
        const messageCommand = result.commands.find(
            (c) => c.type === "SEND_MESSAGE",
        );
        expect(messageCommand?.type).toBe("SEND_MESSAGE");
        if (messageCommand?.type === "SEND_MESSAGE") {
            expect(messageCommand.content).toContain("40 años");
        }
    });

    test("should accept GASO NSE 3 clients aged 30+", () => {
        const result = transition({
            currentState: "COLLECT_AGE",
            message: "30",
            context: {
                phoneNumber: "51987654321",
                segment: "gaso",
                nse: 3,
                creditLine: 5000,
            },
        });

        expect(result.nextState).toBe("OFFER_PRODUCTS");
        expect(result.updatedContext.age).toBe(30);
        expect(result.updatedContext.creditLine).toBe(5000); // Capped at 5000
        expect(result.updatedContext.maxInstallments).toBe(18);
    });

    test("should cap credit for GASO NSE 1-2 at 3000", () => {
        const result = transition({
            currentState: "COLLECT_AGE",
            message: "45",
            context: {
                phoneNumber: "51987654321",
                segment: "gaso",
                nse: 2,
                creditLine: 8000,
            },
        });

        expect(result.nextState).toBe("OFFER_PRODUCTS");
        expect(result.updatedContext.creditLine).toBe(3000); // Capped
        expect(result.updatedContext.maxInstallments).toBe(18);
    });

    test("should give GASO NSE 4+ full 60 installments", () => {
        const result = transition({
            currentState: "COLLECT_AGE",
            message: "25",
            context: {
                phoneNumber: "51987654321",
                segment: "gaso",
                nse: 4,
                creditLine: 5000,
            },
        });

        expect(result.nextState).toBe("OFFER_PRODUCTS");
        expect(result.updatedContext.maxInstallments).toBe(60);
    });
});

describe("State Machine - OFFER_PRODUCTS category extraction", () => {
    const baseContext: StateContext = {
        phoneNumber: "51987654321",
        segment: "fnb",
        creditLine: 3000,
        age: 30,
    };

    test("should extract category from brand names (iPhone -> celulares)", () => {
        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "Me interesa un iPhone",
            context: baseContext,
        });

        expect(result.nextState).toBe("OFFER_PRODUCTS");
        expect(result.updatedContext.offeredCategory).toBe("celulares");
        expect(result.commands).toContainEqual({
            type: "SEND_IMAGES",
            productIds: [],
            category: "celulares",
        });
    });

    test("should extract category from generic names", () => {
        const testCases = [
            { message: "quiero una cocina", category: "cocinas" },
            { message: "laptop", category: "laptops" },
            { message: "refrigeradora", category: "refrigeradoras" },
            { message: "televisor", category: "televisores" },
            { message: "terma", category: "termas" },
        ];

        for (const { message, category } of testCases) {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message,
                context: baseContext,
            });

            expect(result.updatedContext.offeredCategory).toBe(category);
        }
    });

    test("should NOT confirm purchase if no products offered yet", () => {
        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "Sí, lo quiero",
            context: { ...baseContext, offeredCategory: undefined },
        });

        // Should ask for clarification since no products shown
        expect(result.nextState).toBe("OFFER_PRODUCTS");
        expect(result.updatedContext.purchaseConfirmed).toBeUndefined();
    });

    test("should confirm purchase ONLY after products shown", () => {
        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "Sí, me lo llevo",
            context: { ...baseContext, offeredCategory: "celulares" },
        });

        expect(result.nextState).toBe("CLOSING");
        expect(result.updatedContext.purchaseConfirmed).toBe(true);
        expect(result.commands).toContainEqual({
            type: "NOTIFY_TEAM",
            channel: "sales",
            message: expect.stringContaining("confirmó interés"),
        });
    });

    test('should handle price objection (contains "no" but not rejection)', () => {
        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "no tengo mucha plata, cuánto cuesta?",
            context: { ...baseContext, offeredCategory: "cocinas" },
        });

        // Should NOT reject, should handle as price question
        expect(result.nextState).toBe("OFFER_PRODUCTS");
        expect(result.updatedContext.purchaseConfirmed).toBeUndefined();
        const messageCommand = result.commands.find(
            (c) => c.type === "SEND_MESSAGE",
        );
        expect(messageCommand?.type).toBe("SEND_MESSAGE");
        if (messageCommand?.type === "SEND_MESSAGE") {
            expect(messageCommand.content).toContain("financi");
        }
    });

    test("should handle rejection for GASO segment (go to objection)", () => {
        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "no gracias",
            context: { ...baseContext, segment: "gaso" },
        });

        expect(result.nextState).toBe("HANDLE_OBJECTION");
    });

    test("should handle rejection for FNB segment (go to closing)", () => {
        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "no me interesa",
            context: { ...baseContext, segment: "fnb" },
        });

        expect(result.nextState).toBe("CLOSING");
    });
});

describe("State Machine - HANDLE_OBJECTION escalation", () => {
    const baseContext: StateContext = {
        phoneNumber: "51987654321",
        segment: "gaso",
        creditLine: 3000,
    };

    test("should handle first objection", () => {
        const result = transition({
            currentState: "HANDLE_OBJECTION",
            message: "no quiero",
            context: { ...baseContext, objectionCount: 1 },
        });

        expect(result.nextState).toBe("HANDLE_OBJECTION");
        expect(result.updatedContext.objectionCount).toBe(2);
    });

    test("should escalate after 2 objections (3rd rejection total)", () => {
        const result = transition({
            currentState: "HANDLE_OBJECTION",
            message: "no me interesa",
            context: { ...baseContext, objectionCount: 2 },
        });

        expect(result.nextState).toBe("ESCALATED");
        expect(result.commands).toContainEqual({
            type: "ESCALATE",
            reason: "Multiple objections to mandatory kitchen bundle",
        });
        expect(result.commands).toContainEqual({
            type: "NOTIFY_TEAM",
            channel: "agent",
            message: expect.stringContaining("rechazó"),
        });
    });

    test("should accept product after objection", () => {
        const result = transition({
            currentState: "HANDLE_OBJECTION",
            message: "ok, acepto",
            context: { ...baseContext, objectionCount: 1 },
        });

        expect(result.nextState).toBe("OFFER_PRODUCTS");
    });
});

describe("State Machine - Terminal states", () => {
    test("CLOSING should stay in CLOSING", () => {
        const result = transition({
            currentState: "CLOSING",
            message: "gracias",
            context: { phoneNumber: "51987654321" },
        });

        expect(result.nextState).toBe("CLOSING");
        expect(result.commands).toHaveLength(0);
    });

    test("ESCALATED should stay in ESCALATED", () => {
        const result = transition({
            currentState: "ESCALATED",
            message: "hola?",
            context: { phoneNumber: "51987654321" },
        });

        expect(result.nextState).toBe("ESCALATED");
        expect(result.commands).toHaveLength(0);
    });
});
